import { expect } from '@playwright/test';
import { anon, test } from './fixtures';
import { uniq } from './env';

/** Security headers, error envelope and cross-origin protections of the built, FastAPI-served app. */
const ANON = { cookies: [], origins: [] };

function expectSecurityHeaders(headers: Record<string, string>, what: string) {
  const csp = headers['content-security-policy'];
  expect(csp, `${what}: Content-Security-Policy`).toBeTruthy();
  expect(csp).toMatch(/frame-ancestors 'none'/);
  expect(csp).toMatch(/default-src/);
  expect(headers['x-frame-options'], `${what}: X-Frame-Options`).toBe('DENY');
  expect(headers['x-content-type-options'], `${what}: X-Content-Type-Options`).toBe('nosniff');
  expect(headers['referrer-policy'], `${what}: Referrer-Policy`).toBeTruthy();
}

anon.describe('כותרות אבטחה', () => {
  anon('האפליקציה הבנויה (HTML, נתיב עמוק ונכסים) כוללת CSP, X-Frame-Options ו-nosniff', async ({ request, baseURL }) => {
    for (const path of ['/', '/login', '/trips/some-deep-link']) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(200);
      expect(res.headers()['content-type']).toContain('text/html');
      expectSecurityHeaders(res.headers(), path);
      const csp = res.headers()['content-security-policy'];
      // Scripts only from our own origin: no inline/eval/remote script execution.
      const scriptSrc = /script-src ([^;]+)/.exec(csp)?.[1] ?? '';
      expect(scriptSrc).toBe("'self'");
      expect(csp).not.toMatch(/unsafe-eval/);
      expect(csp).toMatch(/connect-src 'self'/);
      expect(csp).toMatch(/base-uri 'self'/);
      expect(csp).toMatch(/form-action 'self'/);
    }
    // A real built asset carries the headers too.
    const html = await (await request.get('/')).text();
    const asset = /src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1];
    expect(asset, 'index.html references a built script').toBeTruthy();
    const js = await request.get(asset!);
    expect(js.status()).toBe(200);
    expect(js.headers()['content-type']).toMatch(/javascript/);
    expectSecurityHeaders(js.headers(), asset!);
    expect(baseURL).toBeTruthy();
  });

  anon('תשובות API כוללות כותרות אבטחה ו-request id', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.status()).toBe(200);
    expectSecurityHeaders(res.headers(), '/api/health');
    expect(res.headers()['x-request-id']).toMatch(/^[0-9a-f-]{16,}$/);
    expect(res.headers()['cache-control']).toContain('no-store');
  });

  anon('הדפדפן לא מדווח על הפרות CSP בדפים מרכזיים, והזרקת סקריפט inline חסומה', async ({ page }) => {
    const violations: string[] = [];
    page.on('console', (m) => {
      if (/content security policy|refused to (load|execute|apply)/i.test(m.text())) violations.push(m.text());
    });
    await page.goto('/login');
    await expect(page.locator('h1')).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(violations, 'unexpected CSP violations from the app itself').toEqual([]);
    const inline = await page.evaluate(
      "new Promise((resolve) => { document.addEventListener('securitypolicyviolation', () => resolve('violation'), { once: true }); const s = document.createElement('script'); s.textContent = 'window.__x = 1'; document.head.appendChild(s); setTimeout(() => resolve(window.__x === 1 ? 'executed' : 'silent'), 500); })",
    );
    expect(inline, 'inline script injection must be blocked by CSP').not.toBe('executed');
  });
});

anon.describe('מעטפת שגיאות API (עברית)', () => {
  function expectEnvelope(body: unknown, status: number, code?: string) {
    const b = body as { error?: { code?: string; message?: string; details?: unknown; request_id?: unknown } };
    expect(b.error, `status ${status}: error envelope`).toBeTruthy();
    expect(typeof b.error!.code).toBe('string');
    expect(b.error!.message, 'Hebrew message').toMatch(/[א-ת]/);
    expect('details' in b.error!).toBe(true);
    expect('request_id' in b.error!).toBe(true);
    if (code) expect(b.error!.code).toBe(code);
    const raw = JSON.stringify(body);
    expect(raw).not.toMatch(/Traceback|sqlalchemy|\.py"|File "|sqlite3|psycopg/i);
  }

  anon('401 ללא התחברות, 404 לנתיב לא קיים, 415 ל-Content-Type שגוי, 422 לגוף לא תקין', async ({ request }) => {
    const unauth = await request.get('/api/trips');
    expect(unauth.status()).toBe(401);
    expectEnvelope(await unauth.json(), 401, 'UNAUTHORIZED');
    expect(unauth.headers()['content-type']).toContain('application/json');

    const missing = await request.get('/api/definitely-not-a-route');
    expect(missing.status()).toBe(404);
    expectEnvelope(await missing.json(), 404, 'NOT_FOUND');

    const wrongType = await request.post('/api/auth/login', { headers: { 'Content-Type': 'text/plain' }, data: 'email=a' });
    expect(wrongType.status()).toBe(415);
    expectEnvelope(await wrongType.json(), 415, 'UNSUPPORTED_MEDIA_TYPE');

    const invalid = await request.post('/api/auth/login', { data: { email: 'not-an-email', password: '' } });
    expect(invalid.status()).toBe(422);
    expectEnvelope(await invalid.json(), 422, 'VALIDATION_ERROR');

    const brokenJson = await request.post('/api/auth/login', { headers: { 'Content-Type': 'application/json' }, data: '{"email":' });
    expect(brokenJson.status()).toBe(422);
    expectEnvelope(await brokenJson.json(), 422);

    const wrongMethod = await request.delete('/api/health');
    expect([404, 405]).toContain(wrongMethod.status());
    expectEnvelope(await wrongMethod.json(), wrongMethod.status());
  });

  anon('אחרי התחברות: 404 לישות לא קיימת ו-422 לחיפוש עם תאריך עבר', async ({ playwright, baseURL }) => {
    // Own authenticated context built from the saved owner session (anon base test has none).
    const { default: fs } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const state = fileURLToPath(new URL('./.auth/owner.json', import.meta.url));
    test.skip(!fs.existsSync(state), 'owner session not prepared yet (run the full suite)');
    const ctx = await playwright.request.newContext({ baseURL, storageState: state });
    const csrf = (await ctx.storageState()).cookies.find((c) => c.name === 'ori_csrf')?.value ?? '';
    const notFound = await ctx.get('/api/trips/does-not-exist');
    expect(notFound.status()).toBe(404);
    expectEnvelope(await notFound.json(), 404);
    const past = await ctx.post('/api/search/flight', {
      headers: { 'X-CSRF-Token': csrf },
      data: { origin: 'TLV', destination: 'ATH', depart_date: '2020-01-01', return_date: null, adults: 1, children_ages: [] },
    });
    expect(past.status()).toBe(422);
    expectEnvelope(await past.json(), 422, 'VALIDATION_ERROR');
    await ctx.dispose();
  });
});

test.describe('הגנות בין-מקורות (CSRF / Origin / CORS)', () => {
  test('בקשת POST עם Origin זר נדחית (403) גם עם עוגיית סשן וטוקן CSRF תקינים, ושום דבר לא נוצר', async ({ api, request }) => {
    const title = uniq('evil-');
    const csrf = await api.csrf();
    const res = await request.post('/api/trips', {
      headers: { Origin: 'https://evil.example', 'X-CSRF-Token': csrf },
      data: { title, traveler_ids: [] },
    });
    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('ORIGIN_REJECTED');
    expect(body.error.message).toMatch(/[א-ת]/);
    const trips = await (await api.get('/api/trips')).json();
    expect(JSON.stringify(trips)).not.toContain(title);

    // The same request from the legitimate origin succeeds (so the 403 above is really about Origin).
    const base = new URL(res.url()).origin;
    const ok = await request.post('/api/trips', { headers: { Origin: base, 'X-CSRF-Token': csrf }, data: { title, traveler_ids: [] } });
    expect(ok.status()).toBe(201);
    const created = await ok.json();
    await api.del(`/api/trips/${created.id}`);
  });

  test('כל שיטה משנה עם Origin זר נדחית, גם בלי התחברות', async ({ playwright, baseURL }) => {
    const ctx = await playwright.request.newContext({ baseURL, storageState: ANON });
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const res = await ctx.fetch('/api/auth/logout', { method, headers: { Origin: 'https://evil.example' }, data: method === 'DELETE' ? undefined : {} });
      expect(res.status(), `${method} with foreign Origin`).toBe(403);
      expect((await res.json()).error.code).toBe('ORIGIN_REJECTED');
    }
    const login = await ctx.post('/api/auth/login', { headers: { Origin: 'https://evil.example' }, data: { email: 'a@b.co', password: 'x' } });
    expect(login.status()).toBe(403);
    await ctx.dispose();
  });

  test('בקשה משנה ללא כותרת CSRF נדחית גם מהמקור הנכון', async ({ request, api }) => {
    const res = await request.post('/api/trips', { data: { title: 'no-csrf', traveler_ids: [] } });
    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(body.error.message).toMatch(/[א-ת]/);
    const trips = await (await api.get('/api/trips')).json();
    expect(JSON.stringify(trips)).not.toContain('no-csrf');
  });

  test('CORS: מקור זר לא מקבל Access-Control-Allow-Origin, ועוגיית הסשן מוגנת', async ({ request, ownerState }) => {
    const pre = await request.fetch('/api/trips', {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' },
    });
    expect(pre.headers()['access-control-allow-origin']).toBeUndefined();
    const get = await request.get('/api/health', { headers: { Origin: 'https://evil.example' } });
    expect(get.headers()['access-control-allow-origin']).toBeUndefined();

    // Session cookie: HttpOnly + SameSite (not None); the CSRF cookie is the readable one.
    const { default: fs } = await import('node:fs');
    const state = JSON.parse(fs.readFileSync(ownerState, 'utf8')) as { cookies: Array<{ name: string; httpOnly: boolean; sameSite: string }> };
    const session = state.cookies.find((c) => c.name === 'ori_session');
    expect(session?.httpOnly, 'session cookie must be HttpOnly').toBe(true);
    expect(['Lax', 'Strict']).toContain(session?.sameSite);
    expect(state.cookies.find((c) => c.name === 'ori_csrf')?.httpOnly).toBe(false);
  });

  test('הסשן אינו נחשף לסקריפטים: document.cookie לא מכיל את ori_session', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toBeVisible();
    const cookie = (await page.evaluate('document.cookie')) as string;
    expect(cookie).not.toContain('ori_session');
  });
});

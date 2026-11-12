import { expect, request as pwRequest } from '@playwright/test';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from './fixtures';
import { BASE_URL, uniq } from './env';

const API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../api');
const PYTHON = path.join(API_DIR, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');

test.describe('V6 פלטפורמה: אבטחת מארח/מקור והפעלה נקייה', () => {
  test('V6-18 כותרת Host לא מורשית ⇒ 400, ו-POST עם Origin זר ⇒ 403 (ללא יצירה)', async ({ playwright, request }) => {
    // --- Host header: the API and the SPA both refuse a host that is not in ORI_ALLOWED_HOSTS.
    for (const host of ['evil.example', 'evil.example:8081', '127.0.0.1.evil.example']) {
      const evil = await playwright.request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { Host: host } });
      for (const [method, url] of [
        ['GET', '/api/ready'],
        ['GET', '/'],
        ['GET', '/api/auth/me'],
        ['POST', '/api/auth/login'],
      ] as const) {
        const res = await evil.fetch(url, { method, data: method === 'POST' ? { email: 'a@b.c', password: 'x' } : undefined });
        expect(res.status(), `${method} ${url} with Host: ${host}`).toBe(400);
      }
      await evil.dispose();
    }
    // A spoofed forwarding header must not turn a bad host into a good one, nor break a good host.
    const fwd = await playwright.request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { 'X-Forwarded-Host': 'evil.example' } });
    expect((await fwd.get('/api/ready')).status()).toBe(200);
    await fwd.dispose();
    // Allowed hosts still work.
    const ok = await playwright.request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { Host: `localhost:${new URL(BASE_URL).port}` } });
    expect((await ok.get('/api/ready')).status()).toBe(200);
    await ok.dispose();

    // --- Foreign Origin: a state-changing request with a valid session AND valid CSRF token is still refused.
    const csrf = (await request.storageState()).cookies.find((c) => c.name === 'ori_csrf')?.value ?? '';
    const title = uniq('origin-');
    for (const origin of ['https://evil.example', 'http://127.0.0.1:9', 'null']) {
      const res = await request.post('/api/trips', { data: { title, traveler_ids: [] }, headers: { 'X-CSRF-Token': csrf, Origin: origin } });
      expect(res.status(), `POST /api/trips with Origin: ${origin}`).toBe(403);
      expect((await res.json()).error.message).toMatch(/[א-ת]/);
    }
    // ... even without a session (no login CSRF).
    const anon = await playwright.request.newContext({ baseURL: BASE_URL, storageState: { cookies: [], origins: [] } });
    const login = await anon.post('/api/auth/login', { data: { email: 'x@y.z', password: 'pw' }, headers: { Origin: 'https://evil.example' } });
    expect(login.status()).toBe(403);
    await anon.dispose();
    // Nothing was created by the refused requests, and the same call from the real origin works.
    const trips = await (await request.get('/api/trips')).json();
    expect((trips as Array<{ title: string }>).some((t) => t.title === title)).toBe(false);
    const good = await request.post('/api/trips', { data: { title, traveler_ids: [] }, headers: { 'X-CSRF-Token': csrf, Origin: BASE_URL } });
    expect(good.status()).toBe(201);
    await request.delete(`/api/trips/${(await good.json()).id}`, { headers: { 'X-CSRF-Token': csrf } });
  });

  /**
   * "Fresh startup and login". The Windows/PowerShell path (setup.ps1 / start.ps1) cannot run on this Linux sandbox;
   * it is covered only by DEVOPS-RELEASE's bash validation of the same steps. What IS executed here is the portable
   * core: an empty database, `migrate`, `create-owner` by CLI, the server starting, `/api/ready` reporting ready,
   * and the owner signing in -- API and browser.
   */
  test('V6-19 הפעלה נקייה והתחברות: DB חדש + בעלים מה-CLI ⇒ התחברות עובדת ו-/api/ready מדווח "ready"', async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'environment-level check, independent of the viewport: runs once (desktop project)');
    test.skip(!fs.existsSync(PYTHON), `no API virtualenv at ${PYTHON}`);
    test.setTimeout(120_000);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ori-fresh-'));
    const port = 18100 + Math.floor(Math.random() * 800);
    const password = 'Fresh-Start-Pass-123';
    const email = 'fresh-owner@e2e.local';
    const key = execFileSync(PYTHON, ['-m', 'app.cli', 'gen-key'], { cwd: API_DIR, encoding: 'utf8' }).trim();
    const env = {
      ...process.env,
      ORI_DATABASE_URL: `sqlite:///${path.join(dir, 'fresh.db').replace(/\\/g, '/')}`,
      ORI_DATA_KEY: key,
      ORI_SERVE_WEB: 'true',
      ORI_OWNER_PASSWORD: password,
    };
    let server: ChildProcess | undefined;
    const log: string[] = [];
    try {
      execFileSync(PYTHON, ['-m', 'app.cli', 'migrate'], { cwd: API_DIR, env, stdio: 'pipe' });
      execFileSync(PYTHON, ['-m', 'app.cli', 'create-owner', '--email', email, '--name', 'בעלים', '--password-env', 'ORI_OWNER_PASSWORD'], { cwd: API_DIR, env, stdio: 'pipe' });
      server = spawn(PYTHON, ['-m', 'uvicorn', 'app.main:app', '--no-proxy-headers', '--host', '127.0.0.1', '--port', String(port)], { cwd: API_DIR, env });
      server.stdout?.on('data', (d) => log.push(String(d)));
      server.stderr?.on('data', (d) => log.push(String(d)));
      const base = `http://127.0.0.1:${port}`;
      const api = await pwRequest.newContext({ baseURL: base });

      let ready: { status?: string; checks?: Record<string, { ok: boolean }>; booking_live_execution?: boolean } = {};
      await expect
        .poll(
          async () => {
            try {
              const res = await api.get('/api/ready');
              ready = await res.json();
              return ready.status;
            } catch {
              return 'down';
            }
          },
          { timeout: 45_000, intervals: [300, 500, 1000] },
        )
        .toBe('ready');
      for (const check of ['database', 'schema', 'encryption']) expect(ready.checks?.[check]?.ok, `ready.checks.${check}`).toBe(true);
      expect(ready.booking_live_execution).toBe(false);

      // Wrong password is refused, the right one signs in.
      const bad = await api.post('/api/auth/login', { data: { email, password: 'Wrong-Password-1' } });
      expect(bad.status()).toBe(401);
      const good = await api.post('/api/auth/login', { data: { email, password } });
      expect(good.status()).toBe(200);
      const me = await (await api.get('/api/auth/me')).json();
      expect(me.user.email).toBe(email);
      expect(me.user.role).toBe('owner');
      await api.dispose();

      // And through the browser against the freshly started server (the SPA is served by the API).
      const ctx = await browser.newContext({ baseURL: base, locale: 'he-IL' });
      const page = await ctx.newPage();
      await page.goto('/');
      await expect(page).toHaveURL(/\/login/);
      await page.getByLabel('אימייל').fill(email);
      await page.locator('input[name="password"]').fill(password);
      await page.getByRole('button', { name: 'כניסה' }).click();
      await expect(page).toHaveURL(/\/$/);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByTestId('data-mode-indicator')).toHaveAttribute('data-mode', 'DEMO');
      await ctx.close();
    } catch (e) {
      throw new Error(`${(e as Error).message}\n--- server log ---\n${log.join('').slice(-1500)}`, { cause: e });
    } finally {
      server?.kill();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

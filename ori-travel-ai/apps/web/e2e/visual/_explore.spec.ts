import { test, request as pw } from '@playwright/test';
test('explore', async ({ browser }) => {
  const api = await pw.newContext({ baseURL: 'http://127.0.0.1:8082' });
  const r = await api.post('/api/auth/login', { data: { email: 'owner@vis.local', password: 'Vis-Owner-Pass-123' } });
  console.log('login', r.status());
  const st = await api.storageState();
  const ctx = await browser.newContext({ baseURL: 'http://127.0.0.1:8082', locale: 'he-IL', viewport: { width: 1440, height: 900 }, storageState: st });
  const page = await ctx.newPage();
  page.on('request', q => { if (q.url().includes('/api/')) console.log('REQ', q.method(), q.url().slice(0,200)); });
  await page.goto('/search/flights');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: '/tmp/claude-0/vis/ex-form.png', fullPage: true });
  console.log(page.url());
  console.log(await page.locator('form').first().innerText());
  console.log((await page.locator('input').evaluateAll(els => els.map((e:any) => e.name+':'+e.type+':'+e.value+':'+e.getAttribute('aria-label')))).join('\n'));
});

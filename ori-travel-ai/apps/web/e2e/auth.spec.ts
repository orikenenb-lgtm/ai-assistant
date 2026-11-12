import { expect } from '@playwright/test';
import { anon as test } from './fixtures';
import { OWNER_EMAIL, OWNER_PASSWORD } from './env';

test.describe('אימות והתחברות', () => {
  test('דף ההתחברות: מבנה בסיסי, ללא קישור הרשמה ציבורי', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { level: 1, name: 'התחברות' })).toBeVisible();
    await expect(page.getByLabel('אימייל')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'כניסה' })).toBeVisible();
    // Invite-only: no signup / register / create-account affordance anywhere on the page.
    await expect(page.getByRole('link', { name: /הרשמ|הירשמ|צור חשבון|יצירת חשבון|sign ?up|register/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /הרשמ|הירשמ|sign ?up|register/i })).toHaveCount(0);
    await expect(page.getByText('ההצטרפות אפשרית רק בהזמנה')).toBeVisible();
  });

  test('אין נתיב הרשמה ציבורי (ממשק וגם API)', async ({ page, request }) => {
    for (const route of ['/signup', '/register', '/sign-up']) {
      await page.goto(route);
      await expect(page).toHaveURL(/\/login/); // unknown routes are behind the auth guard
    }
    for (const apiPath of ['/api/auth/register', '/api/auth/signup', '/api/users']) {
      const res = await request.post(apiPath, { data: { email: 'x@example.com', password: 'Whatever-123456' } });
      expect([401, 403, 404, 405]).toContain(res.status());
    }
  });

  test('ולידציה בצד הלקוח: שדות ריקים ואימייל לא תקין', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'כניסה' }).click();
    await expect(page.getByText('יש להזין כתובת אימייל')).toBeVisible();

    await page.getByLabel('אימייל').fill('not-an-email');
    await page.locator('input[name="password"]').fill('x');
    await page.getByRole('button', { name: 'כניסה' }).click();
    await expect(page.getByText('כתובת האימייל אינה תקינה')).toBeVisible();

    await page.getByLabel('אימייל').fill(OWNER_EMAIL);
    await page.locator('input[name="password"]').fill('');
    await page.getByRole('button', { name: 'כניסה' }).click();
    await expect(page.getByText('יש להזין סיסמה')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('סיסמה שגויה: הודעת שגיאה בעברית ונשארים בדף ההתחברות', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('אימייל').fill(OWNER_EMAIL);
    await page.locator('input[name="password"]').fill('Definitely-Wrong-Password-1');
    await page.getByRole('button', { name: 'כניסה' }).click();
    const alert = page.getByRole('alert').filter({ hasText: 'לא הצלחנו להכניס אותך' });
    await expect(alert).toBeVisible();
    // The error text is Hebrew (not a raw English API message) and must not reveal which field was wrong.
    await expect(alert).toContainText(/[א-ת]/);
    await expect(alert).not.toContainText(/invalid|incorrect|exist/i);
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator('input[name="password"]')).toHaveValue('');
  });

  test('כניסה מוצלחת מובילה ללוח הבקרה, והתנתקות מחזירה להתחברות', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('אימייל').fill(OWNER_EMAIL);
    await page.locator('input[name="password"]').fill(OWNER_PASSWORD);
    await page.getByRole('button', { name: 'כניסה' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/טובים|שלום|ערב|בוקר|צהריים|לילה/);

    await page.getByRole('button', { name: /תפריט משתמש/ }).click();
    await page.getByRole('menuitem', { name: 'התנתקות' }).click();
    await expect(page).toHaveURL(/\/login/);

    // Session really ended server-side: a protected deep link bounces to login again.
    await page.goto('/trips');
    await expect(page).toHaveURL(/\/login/);
    const me = await page.request.get('/api/auth/me');
    expect(me.status()).toBe(401);
  });

  test('קישור עמוק ללא התחברות: הפניה להתחברות וחזרה ליעד אחרי כניסה', async ({ page }) => {
    await page.goto('/trips?x=1');
    await expect(page).toHaveURL(/\/login/);
    await page.getByLabel('אימייל').fill(OWNER_EMAIL);
    await page.locator('input[name="password"]').fill(OWNER_PASSWORD);
    await page.getByRole('button', { name: 'כניסה' }).click();
    await expect(page).toHaveURL(/\/trips\?x=1$/);
    await expect(page.getByRole('heading', { level: 1, name: 'טיולים' })).toBeVisible();
  });

  test('אין redirect פתוח: ניסיון הפניה לדומיין חיצוני נחסם', async ({ page }) => {
    await page.goto('/login');
    // Simulate a tampered post-login target (router state) pointing at another origin.
    await page.evaluate(`window.history.pushState({ usr: { from: '//evil.example/x' } }, '', '/login')`);
    await page.getByLabel('אימייל').fill(OWNER_EMAIL);
    await page.locator('input[name="password"]').fill(OWNER_PASSWORD);
    await page.getByRole('button', { name: 'כניסה' }).click();
    await expect(page).toHaveURL(/127\.0\.0\.1|localhost/);
    await expect(page).not.toHaveURL(/evil\.example/);
  });
});

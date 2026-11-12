import { expect } from '@playwright/test';
import { test } from './fixtures';
import { OWNER_PASSWORD } from './env';

test.describe('ספקים', () => {
  test('ספקי הדגמה תקינים ומסומנים "הדגמה"; ספקים אמיתיים "לא מחובר" ולא משתתפים', async ({ page }) => {
    await page.goto('/providers');
    await expect(page.getByRole('heading', { level: 1, name: 'ספקים ואבחון' })).toBeVisible();
    const cards = page.getByTestId('provider-card');
    await expect(cards.first()).toBeVisible();

    const demo = cards.filter({ hasText: 'ספק הדגמה' });
    const live = cards.filter({ hasText: 'ספק אמיתי (חי)' });
    expect(await demo.count()).toBeGreaterThanOrEqual(8);
    expect(await live.count()).toBeGreaterThanOrEqual(3);
    // Every provider is classified as exactly one of the two.
    expect(await demo.count() + (await live.count())).toBe(await cards.count());

    for (let i = 0; i < (await demo.count()); i++) {
      await expect(demo.nth(i), `demo provider #${i}`).toContainText('מצב ספק: תקין');
      await expect(demo.nth(i)).toContainText('הדגמה');
      await expect(demo.nth(i)).not.toContainText('לא מחובר');
    }
    for (let i = 0; i < (await live.count()); i++) {
      await expect(live.nth(i), `live provider #${i}`).toContainText('לא מחובר');
      await expect(live.nth(i)).toContainText('הספק מחכה לפרטי גישה בשרת');
      // Only environment-variable NAMES are shown, never values.
      await expect(live.nth(i).locator('code').first()).toContainText(/^ORI_[A-Z_]+$/);
    }

    // Summary counters agree with the cards.
    await expect(page.getByText('ספקים במערכת')).toBeVisible();
    const api = await (await page.request.get('/api/providers')).json();
    expect(api.length).toBe(await cards.count());
    expect(api.filter((p: { status: string }) => p.status === 'NOT_CONFIGURED').length).toBe(await live.count());
    expect(api.filter((p: { status: string }) => p.status === 'OK').length).toBe(await demo.count());

    // Health check on a demo provider reports success.
    await demo.first().getByRole('button', { name: 'בדיקת תקינות' }).click();
    await expect(page.getByText(/תקין|הבדיקה הושלמה|עבר/).first()).toBeVisible();
  });

  test('כותרת h1 אחת וקישור עזרה לחיבור ספק', async ({ page }) => {
    await page.goto('/providers');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'איך מחברים ספק?' }).first()).toHaveAttribute('href', /help#connect-providers/);
  });
});

test.describe('הגדרות', () => {
  test('משקלות דירוג: הסכום תמיד 100, אי אפשר לשמור סכום לא תקין, ושמירה נשמרת בשרת', async ({ page, api }) => {
    await page.goto('/settings');
    const region = page.getByRole('region', { name: 'משקלות הדירוג' });
    const total = region.getByTestId('weights-total');
    const save = region.getByRole('button', { name: 'שמירת משקלות' });
    const values = () => region.locator('input[type="number"]').evaluateAll((els) => els.map((e) => Number((e as unknown as { value: string }).value)));

    await expect(total).toContainText('100');
    await expect(save).toBeDisabled(); // nothing changed yet

    try {
      // Out-of-range input is clamped and the other weights are redistributed: the sum never leaves 100.
      await region.getByRole('spinbutton', { name: 'עלות' }).fill('150');
      await region.getByRole('spinbutton', { name: 'עלות' }).blur();
      await expect.poll(async () => (await values()).reduce((a, b) => a + b, 0)).toBe(100);
      await expect(total).toContainText('100 / 100');

      await region.getByRole('spinbutton', { name: 'איכות' }).fill('33');
      await region.getByRole('spinbutton', { name: 'איכות' }).blur();
      await expect.poll(async () => (await values()).reduce((a, b) => a + b, 0)).toBe(100);

      const prev = JSON.stringify(await values());
      await region.getByRole('button', { name: 'הכי זול' }).click();
      await expect.poll(async () => JSON.stringify(await values())).not.toBe(prev); // preset applied
      const cheap = await values();
      expect(cheap.reduce((a, b) => a + b, 0)).toBe(100);
      expect(cheap[0]).toBeGreaterThan(cheap[1]); // cost dominates the "cheapest" preset
      await expect(save).toBeEnabled();
      await save.click();
      await expect(page.getByText(/נשמר|עודכנ/).first()).toBeVisible();

      // Persisted server-side and after reload.
      const settings = await (await api.get('/api/settings')).json();
      const w = settings.ranking_weights;
      expect(w.cost + w.convenience + w.flexibility + w.quality).toBe(100);
      expect(w.cost).toBe(cheap[0]);
      await page.reload();
      await expect.poll(async () => (await values())[0]).toBe(cheap[0]);
    } finally {
      // Restore the family defaults so other specs are unaffected.
      await api.put('/api/settings/ranking-weights', { cost: 40, convenience: 25, flexibility: 20, quality: 15 });
    }
  });

  test('השרת דוחה משקלות שסכומם אינו 100', async ({ api }) => {
    const res = await api.put('/api/settings/ranking-weights', { cost: 50, convenience: 25, flexibility: 20, quality: 15 });
    expect(res.status()).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBeTruthy();
    expect(body.error.message).toMatch(/[א-ת]/);
    const settings = await (await api.get('/api/settings')).json();
    const w = settings.ranking_weights;
    expect(w.cost + w.convenience + w.flexibility + w.quality).toBe(100);
  });

  test('סטטוס מערכת לקריאה בלבד: הזמנות אמיתיות כבויות, ספקים חיים כבויים', async ({ page }) => {
    await page.goto('/settings');
    const safety = page.getByRole('region', { name: 'בטיחות הזמנות ואבטחה' });
    await expect(safety).toContainText('ביצוע הזמנות אמיתיות');
    await expect(safety).toContainText('כבוי');
    await expect(safety).toContainText('המערכת לא מבצעת הזמנות ולא מחייבת כרטיס אשראי');
    await expect(safety).toContainText('כבויים (הדגמה בלבד)');
  });

  test('שינוי סיסמה: ולידציה בצד הלקוח ושגיאת שרת לסיסמה נוכחית שגויה (הסיסמה לא משתנה)', async ({ page }) => {
    await page.goto('/settings');
    const form = page.getByRole('region', { name: 'החשבון שלי — שינוי סיסמה' });
    const submit = form.getByRole('button', { name: 'שינוי סיסמה' });
    await submit.click();
    await expect(form.getByText('יש להזין את הסיסמה הנוכחית')).toBeVisible();
    await expect(form.getByText('יש להזין סיסמה')).toBeVisible();

    await form.getByRole('textbox', { name: 'סיסמה נוכחית' }).fill('Wrong-Current-Pass-1');
    await form.getByRole('textbox', { name: 'סיסמה חדשה', exact: true }).fill('short');
    await form.getByRole('textbox', { name: 'אימות סיסמה חדשה' }).fill('different');
    await submit.click();
    await expect(form.getByText('הסיסמה חייבת להכיל לפחות 10 תווים')).toBeVisible();
    await expect(form.getByText('האימות אינו תואם לסיסמה החדשה')).toBeVisible();
    await expect(form.getByTestId('strength')).toContainText('חלשה');

    await form.getByRole('textbox', { name: 'סיסמה חדשה', exact: true }).fill('Str0ng-New-Passw0rd!');
    await form.getByRole('textbox', { name: 'אימות סיסמה חדשה' }).fill('Str0ng-New-Passw0rd!');
    await expect(form.getByTestId('strength')).toContainText(/טובה|חזקה/);
    await submit.click();
    await expect(form.getByText('הסיסמה הנוכחית שגויה')).toBeVisible();
    await expect(page.getByText('הסיסמה שונתה')).toHaveCount(0);

    // The password really did not change: the session is still valid and the old password still works for step-up.
    expect((await page.request.get('/api/auth/me')).status()).toBe(200);
    const csrf = (await page.context().cookies()).find((c) => c.name === 'ori_csrf')?.value ?? '';
    const reauth = await page.request.post('/api/auth/reauth', { data: { password: OWNER_PASSWORD }, headers: { 'X-CSRF-Token': csrf } });
    expect(reauth.status()).toBe(200);
  });
});

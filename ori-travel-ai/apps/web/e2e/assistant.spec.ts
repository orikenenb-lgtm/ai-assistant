import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';
import { futureDate } from './env';

const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

async function send(page: Page, text: string) {
  const box = page.getByRole('textbox', { name: 'הודעה לעוזר' });
  await box.fill(text);
  await page.getByRole('button', { name: 'שליחה', exact: true }).click();
}

test.describe('עוזר AI (מצב בסיסי, ללא מודל)', () => {
  test('באנר מצב בסיסי וההבהרה שהעוזר לא מזמין', async ({ page }) => {
    await page.goto('/assistant');
    await expect(page.getByRole('heading', { level: 1, name: 'עוזר AI' })).toBeVisible();
    const banner = page.getByTestId('ai-status-fallback');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('מצב בסיסי ללא מודל AI');
    await expect(page.getByTestId('cannot-book-note')).toContainText('אינו יכול להזמין');
    await expect(page.getByTestId('ai-status-model')).toHaveCount(0);
    // The status endpoint agrees with the banner.
    const status = await (await page.request.get('/api/ai/status')).json();
    expect(status.available).toBe(false);
    // Send is disabled for an empty message.
    await expect(page.getByRole('button', { name: 'שליחה', exact: true })).toBeDisabled();
  });

  test('בקשת טיסה בעברית מחזירה כרטיסי הצעות (DEMO) והודעת כיסוי', async ({ page }) => {
    await page.goto('/assistant');
    const d = new Date(Date.now() + 75 * 86_400_000);
    await send(page, `טיסה לאתונה ב-${d.getDate()} ב${MONTHS[d.getMonth()]} לשני מבוגרים`);

    const reply = page.getByTestId('chat-assistant-message').last();
    await expect(reply).toBeVisible({ timeout: 20_000 });
    await expect(reply.getByTestId('reply-mode')).toContainText('מצב בסיסי');
    const cards = reply.getByTestId('chat-cards').locator('[data-testid="offer-card"]');
    await expect(cards.first()).toBeVisible();
    expect(await cards.count()).toBeGreaterThan(0);
    for (let i = 0; i < (await cards.count()); i++) {
      await expect(cards.nth(i).getByTestId('source-line')).toContainText('הדגמה');
    }
    await expect(reply).toContainText('נתוני הדגמה');
    await expect(reply.getByTestId('tool-chip').first()).toContainText('חיפוש');
    await expect(reply).toContainText(/נבדקו \d+ מתוך \d+ ספקים/);
    // The user's message is echoed.
    await expect(page.getByTestId('chat-user-message').last()).toContainText('טיסה לאתונה');
    // The conversation is not stored on the server.
    await expect(page.getByText('אינה נשמרת בשרת')).toBeVisible();
  });

  test('XSS: HTML בהודעה מוצג כטקסט, ללא אלמנט img וללא dialog', async ({ page }) => {
    const dialogs: string[] = [];
    page.on('dialog', async (d) => {
      dialogs.push(d.message());
      await d.dismiss();
    });
    await page.goto('/assistant');
    const payload = '<img src=x onerror=alert(1)>';
    await send(page, payload);
    const mine = page.getByTestId('chat-user-message').last();
    await expect(mine).toContainText(payload); // literal text
    await expect(page.getByTestId('chat-assistant-message').last()).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(500); // give a broken <img onerror> time to fire
    await expect(page.getByTestId('chat-log').locator('img')).toHaveCount(0);
    await expect(page.locator('img[src="x"]')).toHaveCount(0);
    expect(dialogs).toEqual([]);
    // Same for script tags and the assistant echo.
    await send(page, '<script>alert(2)</script><b>bold</b>');
    await expect(page.getByTestId('chat-user-message').last()).toContainText('<script>alert(2)</script>');
    await expect(page.getByTestId('chat-assistant-message').nth(1)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('chat-log').locator('b, script')).toHaveCount(0);
    expect(dialogs).toEqual([]);
  });

  test('בקשה חסרה מקבלת שאלת הבהרה ולא כרטיסים', async ({ page }) => {
    await page.goto('/assistant');
    await send(page, 'אני רוצה מלון');
    const q = page.getByTestId('clarifying-question').first();
    await expect(q).toBeVisible({ timeout: 20_000 });
    await expect(q).toContainText('?');
    await expect(page.getByTestId('chat-cards')).toHaveCount(0);
    await expect(page.locator('[data-testid="offer-card"]')).toHaveCount(0);
  });

  test('תכנון טיול: מוצגים ימים עם פעילויות מתוך תוצאות חיפוש (DEMO)', async ({ page }) => {
    await page.goto('/assistant');
    await page.getByRole('tab', { name: 'תכנון טיול' }).click();
    const panel = page.getByRole('tabpanel', { name: 'תכנון טיול' });
    // Validation first: destination and dates are required.
    await panel.getByRole('button', { name: 'בניית תכנית' }).click();
    await expect(panel.getByText('הזינו יעד (לפחות 2 תווים)')).toBeVisible();
    await expect(panel.getByText('בחרו תאריך התחלה')).toBeVisible();

    await panel.getByRole('textbox', { name: 'יעד' }).fill('Athens');
    await panel.getByRole('textbox', { name: 'מתאריך' }).fill(futureDate(70));
    await panel.getByRole('textbox', { name: 'עד תאריך' }).fill(futureDate(73));
    await panel.getByRole('button', { name: 'בניית תכנית' }).click();

    const result = page.getByTestId('plan-result');
    await expect(result).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('plan-day')).toHaveCount(4);
    expect(await page.getByTestId('plan-activity').count()).toBeGreaterThan(0);
    await expect(result).toContainText('נתוני הדגמה');
    // Each activity is grounded in a real search result: it renders an offer card with the DEMO source.
    const first = page.getByTestId('plan-activity').first();
    await expect(first.locator('[data-testid="offer-card"]')).toBeVisible();
    await expect(first.getByTestId('source-line')).toContainText('הדגמה');
    await expect(result.getByRole('link', { name: 'פתיחת חיפוש האטרקציות המלא' })).toHaveAttribute('href', /\/search\/activities\?search_id=[0-9a-f]+/);
  });
});

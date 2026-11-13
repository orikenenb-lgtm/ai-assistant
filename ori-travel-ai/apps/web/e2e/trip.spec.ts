import { expect } from '@playwright/test';
import { test } from './fixtures';
import { money, sharedFlightSearch } from './data';
import { futureDate, uniq } from './env';

test.describe('טיולים', () => {
  const created: string[] = [];
  test.afterAll(async ({ request }) => {
    // Best-effort cleanup of the trips this spec created.
    const state = await request.storageState();
    const csrf = state.cookies.find((c) => c.name === 'ori_csrf')?.value ?? '';
    for (const id of created) await request.delete(`/api/trips/${id}`, { headers: { 'X-CSRF-Token': csrf } });
  });

  test('יצירת טיול, הוספת הצעה, ציר זמן עם DEMO ועלות, תקציב, ייצוא ICS ו-PDF', async ({ page, api }) => {
    const title = uniq('טיול-');
    const search = await sharedFlightSearch(api);
    const offer = search.offers[0];

    // --- create the trip through the UI
    await page.goto('/trips');
    await page.getByRole('button', { name: 'טיול חדש' }).first().click();
    const dlg = page.getByRole('dialog', { name: 'טיול חדש' });
    await dlg.getByLabel('שם הטיול').fill(title);
    await dlg.getByRole('textbox', { name: /^יעד/ }).fill('Athens');
    await dlg.getByLabel(/^תאריך התחלה/).fill(futureDate(40));
    await dlg.getByLabel(/^תאריך סיום/).fill(futureDate(47));
    await dlg.getByLabel(/^תקציב/).fill('50000');
    await dlg.getByRole('button', { name: 'יצירת טיול' }).click();
    await expect(page).toHaveURL(/\/trips\/[0-9a-f]+$/);
    const tripId = page.url().split('/').pop()!;
    created.push(tripId);
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();

    // --- add an offer from the search results
    await page.goto(`/search/flights?search_id=${search.search_id}`);
    const card = page.locator(`[data-testid="offer-card"][data-offer-id="${offer.id}"]`);
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'הוספה לטיול' }).click();
    const pick = page.getByRole('dialog', { name: 'הוספה לטיול' });
    await pick.getByRole('radio', { name: new RegExp(title) }).check();
    await pick.getByRole('button', { name: 'הוספה', exact: true }).click();
    await expect(page.getByText('ההצעה נוספה לטיול').first()).toBeVisible();

    // --- timeline
    await page.goto(`/trips/${tripId}`);
    const items = page.getByTestId('trip-item');
    await expect(items.first()).toBeVisible();
    expect(await items.count()).toBeGreaterThanOrEqual(2); // outbound + return segments
    const first = items.first();
    await expect(first).toContainText('הדגמה');
    await expect(first).toContainText(money(offer.price.total.amount));
    await expect(first).toContainText('₪');
    await expect(page.getByTestId('trip-day').first()).toBeVisible();

    // --- budget panel
    const budget = page.getByRole('complementary', { name: 'תקציב ומפה' });
    await expect(budget).toContainText('תקציב מוגדר');
    await expect(budget).toContainText('50,000.00');
    await expect(budget.getByTestId('budget-currency')).toContainText(money(offer.price.total.amount));
    await expect(budget).toContainText('נשאר בתקציב');
    const remaining = (50000 - Number(offer.price.total.amount)).toLocaleString('en-US', { minimumFractionDigits: 2 });
    await expect(budget.getByTestId('budget-remaining')).toContainText(remaining);
    await expect(budget).toContainText('נתוני הדגמה');

    // --- exports (authenticated session)
    const ics = await api.get(`/api/trips/${tripId}/export.ics`);
    expect(ics.status()).toBe(200);
    expect(ics.headers()['content-type']).toContain('text/calendar');
    const icsBody = await ics.text();
    expect(icsBody).toMatch(/^BEGIN:VCALENDAR/);
    expect(icsBody).toContain('BEGIN:VEVENT');
    expect(icsBody).toContain('END:VCALENDAR');

    const pdf = await api.get(`/api/trips/${tripId}/export.pdf`);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()['content-type']).toContain('application/pdf');
    const pdfBody = await pdf.body();
    expect(pdfBody.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdfBody.length).toBeGreaterThan(1500);

    // The UI links point at the same endpoints.
    await expect(page.getByRole('link', { name: 'ייצוא ליומן (ICS)' })).toHaveAttribute('href', `/api/trips/${tripId}/export.ics`);
    await expect(page.getByRole('link', { name: 'ייצוא ל-PDF' })).toHaveAttribute('href', `/api/trips/${tripId}/export.pdf`);
  });

  test('ייצוא ללא התחברות נדחה (401)', async ({ playwright, baseURL }) => {
    const anon = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    const res = await anon.get('/api/trips/does-not-matter/export.pdf');
    expect(res.status()).toBe(401);
    await anon.dispose();
  });
});

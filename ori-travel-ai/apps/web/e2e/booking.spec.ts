import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';
import { sharedFlightSearch } from './data';
import { OWNER_PASSWORD } from './env';
import { expectNoRealPurchaseWording } from './wording';

type Scenario = 'success' | 'price_change' | 'timeout_unknown';

/** Creates a fresh DEMO offer, then a booking draft through the UI with the given simulation scenario. */
async function startBooking(page: Page, offerId: string, scenario: Scenario) {
  await page.goto(`/bookings?offer_id=${offerId}`);
  const dlg = page.getByRole('dialog', { name: 'הכנת הזמנה' });
  await expect(dlg.getByTestId('selected-offer')).toContainText('הדגמה');
  await dlg.getByRole('group', { name: 'נוסעים' }).getByRole('checkbox').first().check();
  await dlg.getByRole('combobox', { name: 'תרחיש סימולציה' }).selectOption(scenario);
  await dlg.getByRole('button', { name: 'יצירת הזמנה להכנה' }).click();
  await expect(page).toHaveURL(/\/bookings\/[0-9a-f]+$/);
  await expect(page.getByRole('heading', { level: 1, name: 'סקירת הזמנה' })).toBeVisible();
  return page.url().split('/').pop()!;
}

const banner = (page: Page) => page.getByRole('note').filter({ hasText: 'סימולציה — לא תתבצע רכישה אמיתית' });

async function checkPrice(page: Page) {
  await page.getByRole('button', { name: 'בדיקת מחיר מול הספק' }).click();
  await expect(page.getByRole('heading', { name: 'אישור התנאים' })).toBeVisible();
}

async function approve(page: Page, password = OWNER_PASSWORD) {
  await page.getByRole('checkbox', { name: /קראתי ואני מאשר/ }).check();
  await page.getByLabel('סיסמה (אימות נוסף)').fill(password);
  await page.getByRole('button', { name: 'אישור התנאים' }).click();
}

async function bookingState(page: Page, id: string): Promise<string> {
  const res = await page.request.get(`/api/bookings/${id}`);
  expect(res.ok()).toBe(true);
  return (await res.json()).state as string;
}

test.describe('הכנת הזמנה (סימולציה בלבד)', () => {
  test('מסלול מלא: בדיקת מחיר, סיסמה שגויה לא מאשרת, אישור, שליחה -> CONFIRMED עם אסמכתה SIM-', async ({ page, api }) => {
    const search = await sharedFlightSearch(api);
    const id = await startBooking(page, search.offers[0].id, 'success');

    // Simulation banner is visible from the first screen; no real-purchase wording anywhere.
    await expect(banner(page)).toBeVisible();
    await expect(banner(page)).toContainText('ולא יבוצע חיוב');
    await expectNoRealPurchaseWording(page);
    expect(await bookingState(page, id)).toBe('QUOTE_SELECTED');

    await checkPrice(page);
    await expect(page.getByRole('list', { name: 'שלבי ההזמנה' })).toContainText('מוכן לאישור — השלב הנוכחי');
    await expect(page.getByText('סכום כולל לאישור')).toBeVisible();

    // Wrong password -> Hebrew error, nothing is approved, no submit button appears.
    await approve(page, 'Wrong-Password-123');
    await expect(page.getByRole('alert').filter({ hasText: 'הסיסמה שגויה' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'שליחה (סימולציה)' })).toHaveCount(0);
    await expect(page.getByText('מאושר', { exact: true })).toHaveCount(0);
    expect(await bookingState(page, id)).toBe('READY_FOR_APPROVAL');

    // Correct password approves the exact terms.
    await approve(page);
    await expect(page.getByText('התנאים אושרו. האישור תקף לזמן מוגבל.')).toBeVisible();
    expect(await bookingState(page, id)).toBe('APPROVED');
    await expect(page.getByRole('heading', { name: 'שליחה לספק המדומה' })).toBeVisible();
    await expectNoRealPurchaseWording(page);

    await page.getByRole('button', { name: 'שליחה (סימולציה)' }).click();
    await expect(page.getByRole('heading', { name: 'ההזמנה אושרה — בסימולציה' })).toBeVisible();
    await expect(page.getByText(/SIM-[A-Z0-9]+/).first()).toBeVisible();
    await expect(page.getByText('אסמכתה מדומה')).toBeVisible();
    await expect(banner(page)).toBeVisible();
    await expectNoRealPurchaseWording(page);

    const booking = await (await page.request.get(`/api/bookings/${id}`)).json();
    expect(booking.state).toBe('CONFIRMED');
    expect(JSON.stringify(booking)).toMatch(/SIM-[A-Z0-9]+/);

    // A confirmed booking is final: no actions are offered any more.
    for (const name of ['שליחה (סימולציה)', 'בדיקת מחיר מול הספק', 'אישור התנאים', 'ביטול ההזמנה', 'בירור מול הספק']) {
      await expect(page.getByRole('button', { name, exact: true }), name).toHaveCount(0);
    }
    // And it is listed.
    await page.goto('/bookings');
    await expect(page.getByRole('link', { name: /תל אביב/ }).first()).toBeVisible();
    await expect(banner(page).or(page.getByText(/סימולציה/).first()).first()).toBeVisible();
    await expectNoRealPurchaseWording(page);
  });

  test('timeout_unknown: מצב "לא ידוע", רק בירור אפשרי, ואז CONFIRMED', async ({ page, api }) => {
    const search = await sharedFlightSearch(api);
    const id = await startBooking(page, search.offers[1].id, 'timeout_unknown');
    await checkPrice(page);
    await approve(page);
    await expect(page.getByRole('button', { name: 'שליחה (סימולציה)' })).toBeVisible();
    await page.getByRole('button', { name: 'שליחה (סימולציה)' }).click();

    await expect(page.getByRole('heading', { name: 'לא ידוע אם ההזמנה נקלטה אצל הספק' })).toBeVisible();
    expect(await bookingState(page, id)).toBe('UNKNOWN');
    await expect(page.getByText('אין לשלוח שוב')).toBeVisible();
    // Only reconciliation is available: no re-submit, cancel, re-check or re-approve.
    await expect(page.getByRole('button', { name: 'בירור מול הספק' })).toBeVisible();
    for (const name of ['שליחה (סימולציה)', 'ביטול ההזמנה', 'בדיקת מחיר מול הספק', 'אישור התנאים']) {
      await expect(page.getByRole('button', { name, exact: true }), name).toHaveCount(0);
    }
    // Server side: submitting again is refused until reconciled.
    const again = await api.post(`/api/bookings/${id}/submit`, { idempotency_key: crypto.randomUUID() });
    expect(again.status()).toBe(409);
    expect((await again.json()).error.code).toBe('RECONCILE_REQUIRED');

    await page.getByRole('button', { name: 'בירור מול הספק' }).click();
    await expect(page.getByRole('heading', { name: 'ההזמנה אושרה — בסימולציה' })).toBeVisible();
    await expect(page.getByText(/SIM-[A-Z0-9]+/).first()).toBeVisible();
    expect(await bookingState(page, id)).toBe('CONFIRMED');
    await expectNoRealPurchaseWording(page);
  });

  test('price_change: המחיר עולה בשליחה, האישור מתבטל ונדרש אישור מחדש', async ({ page, api }) => {
    const search = await sharedFlightSearch(api);
    const id = await startBooking(page, search.offers[2].id, 'price_change');
    await checkPrice(page);
    await approve(page);
    await expect(page.getByRole('button', { name: 'שליחה (סימולציה)' })).toBeVisible();
    await page.getByRole('button', { name: 'שליחה (סימולציה)' }).click();

    const alert = page.getByRole('alert').filter({ hasText: 'המחיר השתנה — האישור בוטל' });
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('שום דבר לא נשלח לספק');
    expect(await bookingState(page, id)).toBe('QUOTE_SELECTED');
    // Nothing was sent, approval is gone: no submit button, price comparison is shown.
    await expect(page.getByRole('button', { name: 'שליחה (סימולציה)' })).toHaveCount(0);
    await expect(page.getByText('המחיר השתנה', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('(עלייה)')).toBeVisible();
    const after = await (await page.request.get(`/api/bookings/${id}`)).json();
    expect(JSON.stringify(after)).not.toMatch(/SIM-[A-Z0-9]+/);

    // Re-check, re-approve with the new terms, and submit again.
    await checkPrice(page);
    await approve(page);
    await expect(page.getByRole('button', { name: 'שליחה (סימולציה)' })).toBeVisible();
    await page.getByRole('button', { name: 'שליחה (סימולציה)' }).click();
    await expect(page.getByRole('heading', { name: 'ההזמנה אושרה — בסימולציה' })).toBeVisible();
    expect(await bookingState(page, id)).toBe('CONFIRMED');
  });

  test('אין ביצוע אמיתי: מצב LIVE ופעולות ללא אישור נדחים בשרת', async ({ page, api }) => {
    const search = await sharedFlightSearch(api);
    const id = await startBooking(page, search.offers[3].id, 'success');
    // Submitting without a price check / approval is refused.
    const res = await api.post(`/api/bookings/${id}/submit`, { idempotency_key: crypto.randomUUID() });
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
    expect(await bookingState(page, id)).toBe('QUOTE_SELECTED');
    // Approving with a made-up terms hash is refused too.
    const bad = await api.post(`/api/bookings/${id}/approve`, { terms_hash: 'f'.repeat(64), password: OWNER_PASSWORD, confirm: true });
    expect(bad.status()).toBeGreaterThanOrEqual(400);
    expect(bad.status()).toBeLessThan(500);
    expect(await bookingState(page, id)).toBe('QUOTE_SELECTED');
    // Settings expose that live execution is off.
    const settings = await (await api.get('/api/settings')).json();
    expect(settings.booking.live_execution).toBe(false);
    // Clean up the draft.
    await page.getByRole('button', { name: 'ביטול ההזמנה' }).click();
    const confirm = page.getByRole('alertdialog').or(page.getByRole('dialog'));
    if (await confirm.count()) await confirm.getByRole('button', { name: /ביטול ההזמנה|אישור|כן/ }).last().click();
    await expect.poll(() => bookingState(page, id)).toBe('CANCELLED');
  });
});

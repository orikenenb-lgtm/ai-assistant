import { expect, type Page } from '@playwright/test';
import { OWNER_PASSWORD } from './env';

export type Scenario = 'success' | 'price_change' | 'timeout_unknown' | 'expired' | 'supplier_failure';

/** Creates a fresh DEMO offer, then a booking draft through the UI with the given simulation scenario. */
export async function startBooking(page: Page, offerId: string, scenario: Scenario) {
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

export const banner = (page: Page) => page.getByRole('note').filter({ hasText: 'סימולציה — לא תתבצע רכישה אמיתית' });

export async function checkPrice(page: Page, opts: { expectApproval?: boolean } = {}) {
  await page.getByRole('button', { name: 'בדיקת מחיר מול הספק' }).click();
  if (opts.expectApproval ?? true) await expect(page.getByRole('heading', { name: 'אישור התנאים' })).toBeVisible();
}

export async function approve(page: Page, password = OWNER_PASSWORD) {
  await page.getByRole('checkbox', { name: /קראתי ואני מאשר/ }).check();
  await page.getByLabel('סיסמה (אימות נוסף)').fill(password);
  await page.getByRole('button', { name: 'אישור התנאים' }).click();
}

export async function bookingState(page: Page, id: string): Promise<string> {
  const res = await page.request.get(`/api/bookings/${id}`);
  expect(res.ok()).toBe(true);
  return (await res.json()).state as string;
}


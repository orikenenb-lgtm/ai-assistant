import { expect } from '@playwright/test';
import { test } from './fixtures';
import { approve, banner, bookingState, checkPrice, startBooking } from './booking-helpers';
import { flightSearch, sharedFlightSearch } from './data';
import { expectNoRealPurchaseWording } from './wording';
import { offerCards } from './search-common';

/**
 * Failure scenarios the family would really meet: providers failing (partial / total), offers that expired,
 * and a supplier that rejects the (simulated) booking. DEMO providers expose `simulate_error` for exactly this.
 */
test.describe('תרחישי כשל', () => {
  test.describe.configure({ mode: 'serial' });

  test('ספק אחד נכשל: תוצאות חלקיות, באנר אזהרה, והספק התקול מסומן', async ({ page, api }) => {
    const restore = async () => {
      await api.put('/api/providers/demo_skyline', { enabled: true, settings: { simulate_error: false } });
      // Provider status stays DEGRADED until the next successful run; run one so later specs see healthy providers.
      await flightSearch(api, { adults: 1 });
    };
    try {
      await api.json(await api.put('/api/providers/demo_skyline', { enabled: true, settings: { simulate_error: true } }));
      const search = await flightSearch(api, { adults: 1 });
      expect(search.search_id).toBeTruthy();

      await page.goto(`/search/flights?search_id=${search.search_id}`);
      await expect(offerCards(page).first()).toBeVisible();
      // Honest, non-alarming partial-results banner; results of the healthy provider are still shown.
      await expect(page.getByText('חלק מהספקים לא ענו')).toBeVisible();
      await expect(page.getByText(/התוצאות חלקיות/)).toBeVisible();
      const strip = page.getByTestId('provider-strip');
      await expect(strip).toContainText('דמו סקייליין');
      await expect(strip).toContainText('נכשל');
      await expect(strip).toContainText('1 מתוך 4 ענו');
      await expect(page.getByText(/ספקים שנכשלו או לא הגיבו בזמן: דמו סקייליין/)).toBeVisible();
      // Every offer that is shown still comes from the healthy provider and is marked DEMO.
      const total = await offerCards(page).count();
      for (let i = 0; i < total; i++) {
        await expect(offerCards(page).nth(i).getByTestId('source-line')).toContainText('דמו אורורה');
      }
      // The failure never leaks internals: only the Hebrew simulated-error text is shown.
      await expect(strip).not.toContainText(/Traceback|Exception|SIMULATED_ERROR/);

      const providers = await (await api.get('/api/providers')).json();
      expect(providers.find((p: { provider_id: string }) => p.provider_id === 'demo_skyline').status).toBe('DEGRADED');
    } finally {
      await restore();
    }
  });

  test('כל ספקי הקטגוריה נכשלו: הודעת שגיאה ברורה, אין תוצאות מומצאות', async ({ page, api }) => {
    const set = (id: string, simulate: boolean) => api.put(`/api/providers/${id}`, { enabled: true, settings: { simulate_error: simulate } });
    try {
      await api.json(await set('demo_skyline', true));
      await api.json(await set('demo_aurora', true));
      const search = await flightSearch(api, { adults: 1 });
      expect(search.status).toBe('failed');
      expect(search.offers).toEqual([]);

      await page.goto(`/search/flights?search_id=${search.search_id}`);
      await expect(page.getByRole('alert').filter({ hasText: 'החיפוש לא החזיר תוצאות מאף ספק' })).toBeVisible();
      await expect(page.getByText('לא נמצאו הצעות').first()).toBeVisible();
      await expect(offerCards(page)).toHaveCount(0);
      await expect(page.getByTestId('provider-strip')).toContainText('0 מתוך 4 ענו');
      // The user can edit the search and retry.
      await expect(page.getByRole('button', { name: 'עריכת החיפוש' }).first()).toBeVisible();
      // Price alerts / compare must not be offered a phantom result list.
      await expect(page.getByRole('region', { name: 'הצעות שנבחרו להשוואה' })).toHaveCount(0);
    } finally {
      await set('demo_skyline', false);
      await set('demo_aurora', false);
      await flightSearch(api, { adults: 1 }); // recover the DEGRADED status
    }
  });

  test('אחרי שהספקים חוזרים: חיפוש תקין והספקים מסומנים כתקינים', async ({ page, api }) => {
    const search = await flightSearch(api, { adults: 1 });
    expect(search.status).toBe('completed');
    await page.goto('/providers');
    const card = page.getByTestId('provider-card').filter({ hasText: 'דמו סקייליין' });
    await expect(card).toContainText('מצב ספק: תקין');
  });

  test('הצעה שפג תוקפה (תרחיש expired): מצב "פג תוקף", אין המשך, ויש הפניה לחיפוש חדש', async ({ page, api }) => {
    const search = await sharedFlightSearch(api);
    const id = await startBooking(page, search.offers[4].id, 'expired');
    await checkPrice(page, { expectApproval: false });

    await expect(page.getByText('תוקף ההצעה פג אצל הספק (הדגמה) — יש לבצע חיפוש חדש').first()).toBeVisible();
    await expect(page.getByText('מצב סופי: פג תוקף')).toBeVisible();
    expect(await bookingState(page, id)).toBe('EXPIRED');
    await expect(page.getByRole('link', { name: 'חיפוש חדש' })).toBeVisible();
    for (const name of ['בדיקת מחיר מול הספק', 'אישור התנאים', 'שליחה (סימולציה)', 'ביטול ההזמנה', 'בירור מול הספק']) {
      await expect(page.getByRole('button', { name, exact: true }), name).toHaveCount(0);
    }
    // The server refuses to approve / submit an expired booking.
    const submit = await api.post(`/api/bookings/${id}/submit`, { idempotency_key: crypto.randomUUID() });
    expect(submit.status()).toBeGreaterThanOrEqual(400);
    expect(submit.status()).toBeLessThan(500);
    expect(await bookingState(page, id)).toBe('EXPIRED');
    await expectNoRealPurchaseWording(page);
  });

  test('כשל ספק בהזמנה (תרחיש supplier_failure): מצב "נכשל", ללא אסמכתה וללא חיוב', async ({ page, api }) => {
    const search = await sharedFlightSearch(api);
    const id = await startBooking(page, search.offers[5].id, 'supplier_failure');
    await checkPrice(page);
    await approve(page);
    await page.getByRole('button', { name: 'שליחה (סימולציה)' }).click();

    await expect(page.getByText('ההזמנה נכשלה', { exact: true })).toBeVisible();
    await expect(page.getByText('לא בוצעה הזמנה ולא בוצע חיוב').first()).toBeVisible();
    await expect(page.getByText('מצב סופי: נכשל')).toBeVisible();
    await expect(banner(page)).toBeVisible();
    expect(await bookingState(page, id)).toBe('FAILED');
    const booking = JSON.stringify(await (await page.request.get(`/api/bookings/${id}`)).json());
    expect(booking).not.toMatch(/SIM-[A-Z0-9]+/);
    for (const name of ['שליחה (סימולציה)', 'בירור מול הספק', 'אישור התנאים']) {
      await expect(page.getByRole('button', { name, exact: true }), name).toHaveCount(0);
    }
    await expectNoRealPurchaseWording(page);
  });
});

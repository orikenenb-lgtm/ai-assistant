import { expect, request as pwRequest, type Page } from '@playwright/test';
import { Api, type Json } from './api';
import { test, ADULT_PASSWORD } from './fixtures-v6';
import { BASE_URL, futureDate, uniq } from './env';
import { approve, bookingState, checkPrice, startBooking } from './booking-helpers';
import { apiFlightSearch, rnd } from './v6-helpers';
import { expectNoRealPurchaseWording } from './wording';

/** A fresh booking draft (QUOTE_SELECTED -> READY_FOR_APPROVAL) created through the API as the signed-in adult. */
async function apiBooking(api: Api, offerId: string, memberId: string, scenario?: string): Promise<Json> {
  const draft = await api.json(await api.post('/api/bookings', { offer_id: offerId, traveler_member_ids: [memberId], ...(scenario ? { simulation_scenario: scenario } : {}) }));
  return api.json(await api.post(`/api/bookings/${draft.id}/revalidate`, {}));
}

async function ownMemberId(api: Api): Promise<string> {
  const members = (await (await api.get('/api/family/members')).json()) as Array<{ id: string; age_group: string }>;
  const adult = members.find((m) => m.age_group === 'adult');
  if (!adult) throw new Error('no adult family member to travel');
  return adult.id;
}

const uuid = () => crypto.randomUUID();

test.describe('V6 משפחה והזמנות', () => {
  test('V6-12 תפקידים: צופה לא רואה התחלת הזמנה או אישור, והשרת דוחה פעולת שינוי (403)', async ({ browser, api, ownerApi }, testInfo) => {
    test.setTimeout(90_000);
    const viewport = testInfo.project.use.viewport ?? { width: 1440, height: 900 };
    const search = await apiFlightSearch(api, { destination: 'ATH', depart: rnd(40, 200), nights: 4, adults: 1 });
    const offer = search.offers[0];
    const member = await ownMemberId(api);
    // A booking that is ready for approval: adults see the approval panel, viewers must not.
    const booking = await apiBooking(api, offer.id, member);
    expect(booking.state).toBe('READY_FOR_APPROVAL');
    expect(booking.can.approve).toBe(true);

    // Invite a viewer (owner API) and accept in a clean context.
    const email = `${uniq('viewer')}@e2e.local`;
    const inv = await ownerApi.json(
      await ownerApi.post('/api/family/invitations', { email, display_name: 'צופה V6', role: 'viewer', legal_adult_attested: false }),
    );
    const token = (inv.invite_path as string).split(/[/#]/).pop()!;
    const raw = await pwRequest.newContext({ baseURL: BASE_URL });
    const accepted = await raw.post('/api/auth/invitations/accept', { data: { token, password: ADULT_PASSWORD } });
    expect(accepted.ok()).toBe(true);
    const guest = await browser.newContext({ baseURL: BASE_URL, locale: 'he-IL', viewport, storageState: await raw.storageState() });
    await raw.dispose();
    const gp: Page = await guest.newPage();
    try {
      const me = await (await guest.request.get('/api/auth/me')).json();
      expect(me.user.role).toBe('viewer');
      expect(me.user.can_book).toBe(false);

      // --- UI: the booking is readable, but no start / check / approve / submit / cancel controls exist.
      await gp.goto(`/bookings/${booking.id}`);
      await expect(gp.getByRole('heading', { level: 1, name: 'סקירת הזמנה' })).toBeVisible();
      await expect(gp.getByTestId('read-only-note')).toBeVisible();
      await expect(gp.getByTestId('approval-panel')).toHaveCount(0);
      for (const name of ['בדיקת מחיר מול הספק', 'אישור התנאים', 'שליחה (סימולציה)', 'ביטול ההזמנה', 'בירור מול הספק', 'מעבר לדף הספק לדוגמה (DEMO)']) {
        await expect(gp.getByRole('button', { name, exact: true }), `viewer must not see "${name}"`).toHaveCount(0);
      }
      await expect(gp.getByLabel('סיסמה (אימות נוסף)')).toHaveCount(0);

      await gp.goto('/bookings');
      await expect(gp.getByTestId('read-only-note')).toBeVisible();
      await expect(gp.getByRole('button', { name: 'הכנת הזמנה חדשה' })).toHaveCount(0);
      // Deep link to the start-booking dialog does not give a viewer a way to start one.
      await gp.goto(`/bookings?offer_id=${offer.id}`);
      await expect(gp.getByRole('dialog', { name: 'הכנת הזמנה' })).toHaveCount(0);
      await expect(gp.getByRole('button', { name: 'יצירת הזמנה להכנה' })).toHaveCount(0);

      // Offer details: no "prepare booking" entry point for viewers.
      const viewerSearch = await apiFlightSearch(new Api(guest.request), { destination: 'ATH', depart: rnd(40, 200), nights: 4, adults: 1 });
      await gp.goto(`/search/flights?search_id=${viewerSearch.search_id}`);
      const card = gp.locator('[data-testid="offer-card"]').first();
      await expect(card).toBeVisible();
      await card.getByRole('button', { name: 'פרטים' }).click();
      await expect(gp.getByRole('dialog').getByRole('link', { name: 'הכנת הזמנה' })).toHaveCount(0);
      await gp.keyboard.press('Escape');

      const viewerApi = new Api(guest.request);
      // --- Server: every booking mutation is forbidden for the viewer; reads still work.
      const attempts: Array<[string, string, unknown]> = [
        ['post', '/api/bookings', { offer_id: offer.id, traveler_member_ids: [member] }],
        ['post', `/api/bookings/${booking.id}/revalidate`, {}],
        ['post', `/api/bookings/${booking.id}/approve`, { terms_hash: booking.terms_hash, password: ADULT_PASSWORD, confirm: true }],
        ['post', `/api/bookings/${booking.id}/submit`, { idempotency_key: uuid() }],
        ['post', `/api/bookings/${booking.id}/cancel`, {}],
        ['post', `/api/bookings/${booking.id}/reconcile`, {}],
        ['post', `/api/bookings/${booking.id}/checkout-link`, {}],
      ];
      for (const [method, path, data] of attempts) {
        const res = method === 'post' ? await viewerApi.post(path, data) : await viewerApi.get(path);
        expect(res.status(), `${method.toUpperCase()} ${path} as viewer`).toBe(403);
        expect((await res.json()).error.message).toMatch(/[א-ת]/);
      }
      const read = await viewerApi.get(`/api/bookings/${booking.id}`);
      expect(read.status()).toBe(200);
      const seen = await read.json();
      expect(Object.values(seen.can as Record<string, boolean>).some(Boolean), 'a viewer has no booking capability flags').toBe(false);
      // Nothing changed.
      expect((await api.json(await api.get(`/api/bookings/${booking.id}`))).state).toBe('READY_FOR_APPROVAL');
    } finally {
      await guest.close();
      await api.post(`/api/bookings/${booking.id}/cancel`, {});
    }
  });

  test('V6-13 שינוי מחיר אחרי הצעת מחיר מבטל את האישור (price_change)', async ({ page, api }) => {
    const search = await apiFlightSearch(api, { destination: 'ATH', depart: rnd(40, 200), nights: 4, adults: 1 });
    const id = await startBooking(page, search.offers[1].id, 'price_change');
    await checkPrice(page);
    const before = await api.json(await api.get(`/api/bookings/${id}`));
    expect(before.state).toBe('READY_FOR_APPROVAL');
    await approve(page, ADULT_PASSWORD);
    await expect(page.getByRole('button', { name: 'שליחה (סימולציה)' })).toBeVisible();
    expect(await bookingState(page, id)).toBe('APPROVED');

    await page.getByRole('button', { name: 'שליחה (סימולציה)' }).click();
    const alert = page.getByRole('alert').filter({ hasText: 'המחיר השתנה — האישור בוטל' });
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('שום דבר לא נשלח לספק');

    // The approval is gone: back to the quote stage, nothing was reserved, the new price is shown as an increase.
    const after = await api.json(await api.get(`/api/bookings/${id}`));
    expect(after.state).toBe('QUOTE_SELECTED');
    expect(after.reservation).toBeNull();
    expect(after.supplier_reference).toBeFalsy();
    expect(after.approval?.valid ?? false).toBe(false);
    await expect(page.getByRole('button', { name: 'שליחה (סימולציה)' })).toHaveCount(0);
    await expect(page.getByText('(עלייה)')).toBeVisible();
    expect(Number(after.current_price.amount)).toBeGreaterThan(Number(before.quoted_price.amount));

    // Server side: the OLD approval cannot be reused (stale terms hash) and a submit without approval is refused.
    const stale = await api.post(`/api/bookings/${id}/approve`, { terms_hash: before.terms_hash, password: ADULT_PASSWORD, confirm: true });
    expect(stale.status()).toBeGreaterThanOrEqual(400);
    expect(stale.status()).toBeLessThan(500);
    const noApproval = await api.post(`/api/bookings/${id}/submit`, { idempotency_key: uuid() });
    expect(noApproval.status()).toBeGreaterThanOrEqual(400);
    expect(noApproval.status()).toBeLessThan(500);
    expect((await api.json(await api.get(`/api/bookings/${id}`))).state).toBe('QUOTE_SELECTED');

    // A fresh check + approval at the new price is required, and then it goes through.
    await checkPrice(page);
    await approve(page, ADULT_PASSWORD);
    await page.getByRole('button', { name: 'שליחה (סימולציה)' }).click();
    await expect(page.getByRole('heading', { name: 'ההזמנה אושרה — בסימולציה' })).toBeVisible();
    expect(await bookingState(page, id)).toBe('CONFIRMED');
  });

  test('V6-14 שליחה כפולה / timeout ⇒ UNKNOWN, ובירור ⇒ הזמנה אחת בלבד (אותו מפתח לא יוצר הזמנה שנייה)', async ({ page, api }) => {
    test.setTimeout(90_000);
    const search = await apiFlightSearch(api, { destination: 'ATH', depart: rnd(40, 200), nights: 4, adults: 1 });
    const member = await ownMemberId(api);

    // --- UI: double-click on "send" => a single UNKNOWN outcome, only reconcile is offered, then exactly one confirmation.
    const submits: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && /\/submit$/.test(r.url())) submits.push(r.url());
    });
    const id = await startBooking(page, search.offers[2].id, 'timeout_unknown');
    await checkPrice(page);
    await approve(page, ADULT_PASSWORD);
    await page.getByRole('button', { name: 'שליחה (סימולציה)' }).dblclick();
    await expect(page.getByRole('heading', { name: 'לא ידוע אם ההזמנה נקלטה אצל הספק' })).toBeVisible();
    expect(await bookingState(page, id)).toBe('UNKNOWN');
    expect(submits.length, 'the UI sends at most the (idempotent) double-click, never a retry loop').toBeLessThanOrEqual(2);
    const unknown = await api.json(await api.get(`/api/bookings/${id}`));
    expect(unknown.reservation).toBeNull();
    // A new submit with a NEW key is refused until reconciled.
    const again = await api.post(`/api/bookings/${id}/submit`, { idempotency_key: uuid() });
    expect(again.status()).toBe(409);
    expect((await again.json()).error.code).toBe('RECONCILE_REQUIRED');
    await expect(page.getByRole('button', { name: 'שליחה (סימולציה)', exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: 'בירור מול הספק' }).click();
    await expect(page.getByRole('heading', { name: 'ההזמנה אושרה — בסימולציה' })).toBeVisible();
    const done = await api.json(await api.get(`/api/bookings/${id}`));
    expect(done.state).toBe('CONFIRMED');
    expect(done.reservation.supplier_reference).toMatch(/^SIM-/);
    const reference = done.reservation.supplier_reference;
    const reservationId = done.reservation.id;
    // Reconciling again must not create another reservation.
    const second = await api.post(`/api/bookings/${id}/reconcile`, {});
    if (second.ok()) expect((await second.json()).reservation.id).toBe(reservationId);
    const final = await api.json(await api.get(`/api/bookings/${id}`));
    expect(final.reservation.id).toBe(reservationId);
    expect(final.reservation.supplier_reference).toBe(reference);

    // --- API: the same idempotency key, replayed (before and after reconciling), never creates a second reservation.
    const b2 = await apiBooking(api, search.offers[3].id, member, 'timeout_unknown');
    await api.json(await api.post(`/api/bookings/${b2.id}/approve`, { terms_hash: b2.terms_hash, password: ADULT_PASSWORD, confirm: true }));
    const key = uuid();
    const s1 = await api.json(await api.post(`/api/bookings/${b2.id}/submit`, { idempotency_key: key }));
    expect(s1.state).toBe('UNKNOWN');
    const s2 = await api.json(await api.post(`/api/bookings/${b2.id}/submit`, { idempotency_key: key }));
    expect(s2.state).toBe('UNKNOWN');
    expect(s2.idempotent_replay).toBe(true);
    expect(s2.reservation).toBeNull();
    const rec = await api.json(await api.post(`/api/bookings/${b2.id}/reconcile`, {}));
    expect(rec.state).toBe('CONFIRMED');
    const resId = rec.reservation.id;
    const s3 = await api.json(await api.post(`/api/bookings/${b2.id}/submit`, { idempotency_key: key }));
    expect(s3.state).toBe('CONFIRMED');
    expect(s3.idempotent_replay).toBe(true);
    expect(s3.reservation.id).toBe(resId);
    expect(s3.reservation.supplier_reference).toBe(rec.reservation.supplier_reference);
    // A different key on a confirmed booking is refused rather than booking again.
    const s4 = await api.post(`/api/bookings/${b2.id}/submit`, { idempotency_key: uuid() });
    expect(s4.status()).toBeGreaterThanOrEqual(400);
    expect((await api.json(await api.get(`/api/bookings/${b2.id}`))).reservation.id).toBe(resId);
  });

  test('V6-15 מעבר לספק (דף DEMO): מציג את הספק ולא "מאושר" עד שנרשמת האסמכתה', async ({ page, api, context }, testInfo) => {
    test.setTimeout(90_000);
    const from = rnd(40, 200);
    // A hosted-checkout capable offer: demo_kidventures attractions (one adult => one traveller).
    let offer: Json | undefined;
    for (const dest of ['Rome', 'Athens', 'Paris']) {
      const s = await api.search('activity', { destination: dest, date_from: futureDate(from), date_to: futureDate(from + 4), interests: [], adults: 1, children_ages: [], currency: 'ILS' });
      offer = (s.offers as Json[]).find((o) => o.source.provider_id === 'demo_kidventures');
      if (offer) break;
    }
    expect(offer, 'a demo_kidventures offer is needed for the hosted-checkout scenario').toBeTruthy();

    await page.goto(`/bookings?offer_id=${offer!.id}`);
    const dlg = page.getByRole('dialog', { name: 'הכנת הזמנה' });
    await expect(dlg.getByTestId('selected-offer')).toContainText('הדגמה');
    await dlg.getByRole('group', { name: 'נוסעים' }).getByRole('checkbox').first().check();
    await dlg.getByTestId('execution-mode-choice').getByLabel(/השלמה בדף ספק לדוגמה/).check();
    await dlg.getByRole('button', { name: 'יצירת הזמנה להכנה' }).click();
    await expect(page).toHaveURL(/\/bookings\/[0-9a-f]+$/);
    const id = page.url().split('/').pop()!;

    await checkPrice(page);
    await approve(page, ADULT_PASSWORD);

    // Approved terms, but NOT confirmed: the panel says we are waiting for the supplier, and shows the supplier.
    const waiting = page.getByTestId('awaiting-supplier-panel');
    await expect(waiting).toBeVisible();
    await expect(waiting).toContainText('ממתין להשלמה באתר הספק');
    await expect(page.getByTestId('awaiting-supplier-name')).toContainText("דמו קידוונצ'רס");
    await expect(waiting).toContainText('DEMO');
    await expect(page.getByTestId('confirmed-panel')).toHaveCount(0);
    expect(await page.locator('body').innerText()).not.toMatch(/ההזמנה אושרה/);
    expect(await bookingState(page, id)).toBe('APPROVED');

    // Open the supplier's (demo) page in its new tab.
    await waiting.getByRole('button', { name: 'מעבר לדף הספק לדוגמה (DEMO)' }).click();
    const link = page.getByTestId('checkout-open-link');
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('data-internal', 'true');
    await expect(link).toHaveAttribute('href', /^\/demo-supplier\/checkout\?ref=[A-Za-z0-9_-]{16,64}$/);
    const [supplier] = await Promise.all([context.waitForEvent('page'), link.click()]);
    await supplier.waitForLoadState('domcontentloaded');
    await expect(supplier.getByTestId('demo-supplier-banner')).toContainText('DEMO');
    await expect(supplier.getByTestId('demo-supplier-banner')).toContainText('אין חיוב');
    await expect(supplier.getByTestId('demo-supplier-name')).toContainText("דמו קידוונצ'רס");
    await expect(supplier.getByTestId('demo-supplier-price')).toContainText('₪');
    // The supplier page has no payment inputs at all.
    await expect(supplier.locator('input, textarea, select')).toHaveCount(0);

    await supplier.getByTestId('demo-supplier-complete').click();
    const reference = (await supplier.getByTestId('demo-supplier-reference').innerText()).match(/DEMO-[A-Z0-9]+/)?.[0];
    expect(reference).toBeTruthy();
    // Even after "completing" at the supplier, OUR booking is not confirmed: no reservation, no reference.
    const mid = await api.json(await api.get(`/api/bookings/${id}`));
    expect(mid.state).toBe('APPROVED');
    expect(mid.reservation).toBeNull();
    expect(mid.supplier_reference).toBeFalsy();
    await supplier.close();

    await page.bringToFront();
    await page.reload();
    await expect(page.getByTestId('awaiting-supplier-panel')).toBeVisible();
    await expect(page.getByTestId('confirmed-panel')).toHaveCount(0);
    expect(await page.locator('body').innerText()).not.toMatch(/ההזמנה אושרה/);

    // A wrong reference is rejected and nothing is confirmed.
    const form = page.getByTestId('record-confirmation-form');
    await form.getByLabel('אסמכתת ספק').fill('DEMO-WRONG00000');
    await form.getByRole('button', { name: 'רישום האסמכתה' }).click();
    await expect(page.getByRole('alert').first()).toBeVisible();
    expect(await bookingState(page, id)).toBe('APPROVED');
    await expect(page.getByTestId('confirmed-panel')).toHaveCount(0);

    // The real DEMO reference confirms it -- and only now does the page say so (still marked DEMO / no charge).
    await form.getByLabel('אסמכתת ספק').fill(reference!);
    await form.getByRole('button', { name: 'רישום האסמכתה' }).click();
    const confirmed = page.getByTestId('confirmed-panel');
    await expect(confirmed).toBeVisible();
    await expect(confirmed).toContainText(reference!);
    await expect(page.getByTestId('demo-reference-note')).toContainText('זו הדגמה');
    await expect(page.getByTestId('demo-reference-note')).toContainText(/לא בוצע|אין חיוב|לא בוצעה/);
    const done = await api.json(await api.get(`/api/bookings/${id}`));
    expect(done.state).toBe('CONFIRMED');
    expect(done.reservation.mode).toBe('HOSTED_CHECKOUT');
    expect(done.reservation.supplier_reference).toBe(reference);
    await expectNoRealPurchaseWording(page);
    expect(testInfo.project.name).toBeTruthy();
  });
});

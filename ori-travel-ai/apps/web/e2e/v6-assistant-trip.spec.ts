import { expect, type Page } from '@playwright/test';
import { test } from './fixtures-v6';
import { futureDate, uniq } from './env';
import { amountIn, apiFlightSearch, rnd } from './v6-helpers';
import type { Json } from './api';

const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

async function send(page: Page, text: string) {
  await page.getByRole('textbox', { name: 'הודעה לעוזר' }).fill(text);
  await page.getByRole('button', { name: 'שליחה', exact: true }).click();
}

test.describe('V6 עוזר AI ובונה הטיולים', () => {
  test('V6-10 עוזר AI (מצב בסיסי): מנתח בקשה בעברית, מריץ כלים, מציג כרטיסים מנתוני השרת בלי מחירים מומצאים, ו-XSS נשאר טקסט', async ({ page }) => {
    const dialogs: string[] = [];
    page.on('dialog', async (d) => {
      dialogs.push(d.message());
      await d.dismiss();
    });
    await page.goto('/assistant');
    await expect(page.getByTestId('ai-status-fallback')).toContainText('מצב בסיסי ללא מודל AI');
    const status = await (await page.request.get('/api/ai/status')).json();
    expect(status.available).toBe(false);

    const d = new Date(Date.now() + rnd(40, 200) * 86_400_000);
    await send(page, `אני רוצה טיסה מתל אביב לרומא ב-${d.getDate()} ב${MONTHS[d.getMonth()]} לשני מבוגרים וילד בן 7`);
    const reply = page.getByTestId('chat-assistant-message').last();
    await expect(reply).toBeVisible({ timeout: 25_000 });
    await expect(reply.getByTestId('reply-mode')).toContainText('מצב בסיסי');

    // 1. The Hebrew request was parsed into structured search parameters and a tool actually ran.
    const text = await reply.evaluate((el) => {
      const clone = el.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('[data-testid="chat-cards"]').forEach((n) => n.remove());
      return clone.innerText;
    });
    expect(text).toMatch(/תל אביב/);
    expect(text).toMatch(/רומא/);
    expect(text).toMatch(/2 מבוגרים/);
    expect(text).toMatch(/ילד אחד \(גיל 7\)/);
    await expect(reply.getByTestId('tool-chip').first()).toContainText('חיפוש טיסות');
    await expect(reply.getByTestId('tool-chip').first()).toContainText('הושלם');
    await expect(reply).toContainText(/נבדקו \d+ מתוך \d+ ספקים/);
    await expect(reply).toContainText('נתוני הדגמה');

    // 2. Cards come from the server's search: the "open full search" link resolves and contains every card id.
    const cards = reply.getByTestId('chat-cards').locator('[data-testid="offer-card"]');
    await expect(cards.first()).toBeVisible();
    const n = await cards.count();
    expect(n).toBeGreaterThan(0);
    const href = await reply.getByRole('link', { name: 'פתיחת החיפוש המלא' }).getAttribute('href');
    const searchId = /search_id=([0-9a-f]+)/.exec(href ?? '')?.[1];
    expect(searchId).toBeTruthy();
    const search = await (await page.request.get(`/api/search/${searchId}`)).json();
    expect(search.params.destination).toBe('FCO');
    expect(search.params.adults).toBe(2);
    expect(search.params.children_ages).toEqual([7]);
    const serverIds = new Set((search.offers as Array<{ id: string }>).map((o) => o.id));
    for (let i = 0; i < n; i++) {
      const card = cards.nth(i);
      expect(serverIds.has((await card.getAttribute('data-offer-id')) ?? '')).toBe(true);
      await expect(card.getByTestId('source-line')).toContainText('הדגמה');
    }
    // The card's total equals the server offer's total (no re-computation in the browser).
    for (let i = 0; i < n; i++) {
      const id = (await cards.nth(i).getAttribute('data-offer-id')) as string;
      const offer = search.offers.find((x: { id: string }) => x.id === id);
      expect(await amountIn(cards.nth(i))).toBe(Number(offer.price.total.amount));
    }

    // 3. No fabricated prices: every money amount in the reply text is an amount shown in a card
    //    (or, at the very least, the total of an offer the server returned).
    const priceRe = /(\d[\d,]*(?:\.\d+)?)\s*(?:₪|ש"ח|שקל|ILS|\$|€)/g;
    const serverTotals = (search.offers as Array<{ price: { total: { amount: string } } }>).map((o) => Number(o.price.total.amount));
    const inText = [...text.matchAll(priceRe)].map((m) => Number(m[1].replace(/,/g, '')));
    expect(inText.length, 'the basic-mode summary quotes prices').toBeGreaterThan(0);
    for (const price of inText) {
      expect(serverTotals.some((t) => Math.abs(t - price) < 0.011), `price ${price} in the reply must be an offer total from the server`).toBe(true);
    }
    // (Quoted prices that have no card are covered by V6-10b / BUG-E2E-01 below, deterministically.)

    // 4. XSS: markup in a message stays literal text and never executes.
    const payload = '<img src=x onerror=alert(1)><script>alert(2)</script>';
    await send(page, payload);
    await expect(page.getByTestId('chat-user-message').last()).toContainText(payload);
    await expect(page.getByTestId('chat-assistant-message').nth(1)).toBeVisible({ timeout: 25_000 });
    await page.waitForTimeout(400);
    await expect(page.getByTestId('chat-log').locator('img, script, b')).toHaveCount(0);
    await expect(page.locator('img[src="x"]')).toHaveCount(0);
    expect(dialogs).toEqual([]);
    // A card-less reply must not invent prices either.
    const second = await page.getByTestId('chat-assistant-message').nth(1).innerText();
    expect(second).not.toMatch(/\d\s*(?:₪|ש"ח|שקל)/);
  });

  // BUG-E2E-01 (fixed): the basic (no-model) summary names the cheapest / top-ranked / shortest offer; every offer it
  // names is now sent as a card first (ai/service.py `_summary_cards`). DEMO data is deterministic per date, so the test
  // walks a bounded set of departure dates and requires that NO reply quotes a price without a card.
  test('V6-10b כל מחיר שמופיע בטקסט התשובה מופיע גם בכרטיס (BUG-E2E-01 תוקן)', async ({ scratchApi: api }, testInfo) => {
    test.setTimeout(90_000);
    const violations: { price: number; day: number }[] = [];
    let tried = 0;
    for (let i = 0; i < 12; i++) {
      const d = new Date(Date.now() + (rnd(40, 200) + i) * 86_400_000);
      const res = await api.post('/api/ai/chat', { message: `טיסה מתל אביב לרומא ב-${d.getDate()} ב${MONTHS[d.getMonth()]} לשני מבוגרים`, history: [] });
      if (!res.ok()) break;
      const reply = (await res.json()).reply as Json;
      if (!reply.cards?.length) continue;
      tried++;
      const cardTotals = (reply.cards as Json[]).map((c) => Number(c.price.total.amount));
      const quoted = [...(reply.text as string).matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(?:₪|ILS)/g)].map((m) => Number(m[1].replace(/,/g, '')));
      const missing = quoted.find((p) => !cardTotals.some((t) => Math.abs(t - p) < 0.011));
      if (missing !== undefined) violations.push({ price: missing, day: i });
    }
    testInfo.annotations.push({ type: 'searches-tried', description: String(tried) });
    expect(tried, 'at least a few DEMO searches ran').toBeGreaterThan(2);
    expect(violations, `replies quoted prices that no card shows: ${JSON.stringify(violations)}`).toEqual([]);
  });

  test('V6-11 בונה הטיולים: תקציב מחושב, חפיפה בין טיסות מציגה אישור (ביטול ⇒ לא נוסף, אישור ⇒ נוסף עם תג חפיפה)', async ({ page, api, ownerApi }) => {
    test.setTimeout(90_000);
    const members: string[] = [];
    let tripId = '';
    try {
      for (const name of ['נוסע א׳ (V6)', 'נוסע ב׳ (V6)']) {
        const m = await ownerApi.json(await ownerApi.post('/api/family/members', { display_name: name, age_group: 'adult', is_minor: false }));
        members.push(m.id);
      }
      const depart = rnd(60, 200);
      const trip = await api.json(
        await api.post('/api/trips', {
          title: uniq('טיול-חפיפה-'),
          destination: 'Rome',
          start_date: futureDate(depart),
          end_date: futureDate(depart + 6),
          budget: { amount: '20000.00', currency: 'ILS' },
          traveler_ids: members,
        }),
      );
      tripId = trip.id;
      const search = await apiFlightSearch(api, { destination: 'FCO', depart, nights: 6, adults: 2 });
      const offer = search.offers[0];
      const total = Number(offer.price.total.amount);

      const items = async () => (await api.json(await api.get(`/api/trips/${tripId}`))).items as Array<{ id: string; overlaps: unknown[] }>;
      const openPicker = async () => {
        await page.goto(`/search/flights?search_id=${search.search_id}`);
        const card = page.locator(`[data-testid="offer-card"][data-offer-id="${offer.id}"]`);
        await expect(card).toBeVisible();
        await card.getByRole('button', { name: 'הוספה לטיול' }).click();
        const pick = page.getByRole('dialog', { name: 'הוספה לטיול' });
        await pick.getByRole('radio', { name: new RegExp(trip.title) }).check();
        await pick.getByRole('button', { name: 'הוספה', exact: true }).click();
      };

      // --- first add: no overlap, goes straight in
      await openPicker();
      await expect(page.getByText('ההצעה נוספה לטיול').first()).toBeVisible();
      const first = await items();
      expect(first.length).toBeGreaterThanOrEqual(2); // outbound + return
      expect(first.every((i) => i.overlaps.length === 0)).toBe(true);

      // --- budget computed from the trip's items
      await page.goto(`/trips/${tripId}`);
      const budget = page.getByRole('complementary', { name: 'תקציב ומפה' });
      await expect(budget).toContainText('תקציב מוגדר');
      expect(await amountIn(budget.getByTestId('budget-currency'))).toBe(total);
      expect(await amountIn(budget.getByTestId('budget-remaining'))).toBeCloseTo(20000 - total, 2);
      const perTraveler = budget.getByTestId('budget-per-traveler');
      await expect(perTraveler).toContainText('(2)');
      expect(Math.abs((await amountIn(perTraveler)) - total / 2)).toBeLessThanOrEqual(0.011);
      await expect(page.getByTestId('overlap-badge')).toHaveCount(0);

      // --- same flight again => ITEM_OVERLAP confirm; CANCEL adds nothing
      await openPicker();
      const confirm = page.getByRole('alertdialog').or(page.getByRole('dialog', { name: 'חפיפה עם פריט אחר בטיול' }));
      await expect(confirm).toBeVisible();
      await expect(confirm).toContainText('חפיפה עם פריט אחר בטיול');
      await expect(confirm).toContainText('להוסיף בכל זאת');
      await confirm.getByRole('button', { name: 'ביטול' }).click();
      await expect(confirm).toBeHidden();
      expect((await items()).length).toBe(first.length);
      // The server agrees it refuses without consent.
      const refused = await api.post(`/api/trips/${tripId}/items/from-offer`, { offer_id: offer.id });
      expect(refused.status()).toBe(409);
      expect((await refused.json()).error.code).toBe('ITEM_OVERLAP');
      expect((await items()).length).toBe(first.length);

      // --- confirm => added, flagged with the overlap badge and message
      await openPicker();
      await expect(confirm).toBeVisible();
      await confirm.getByRole('button', { name: 'הוספה בכל זאת' }).click();
      await expect(page.getByText('ההצעה נוספה לטיול').first()).toBeVisible();
      const after = await items();
      expect(after.length).toBe(first.length * 2);
      expect(after.some((i) => i.overlaps.length > 0)).toBe(true);

      await page.goto(`/trips/${tripId}`);
      await expect(page.getByTestId('overlap-badge').first()).toBeVisible();
      await expect(page.getByTestId('overlap-badge').first()).toContainText('חפיפה בזמנים');
      await expect(page.getByTestId('overlap-messages').first()).toBeVisible();
      expect(await page.getByTestId('trip-item').count()).toBe(after.length);
      // The budget now counts both flights.
      expect(await amountIn(page.getByRole('complementary', { name: 'תקציב ומפה' }).getByTestId('budget-currency'))).toBeCloseTo(total * 2, 2);
    } finally {
      if (tripId) await api.del(`/api/trips/${tripId}`);
      for (const id of members) await ownerApi.del(`/api/family/members/${id}`);
    }
  });
});

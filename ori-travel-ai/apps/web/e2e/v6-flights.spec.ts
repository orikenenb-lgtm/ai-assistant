import { expect } from '@playwright/test';
import { test } from './fixtures-v6';
import { futureDate } from './env';
import {
  allAmounts,
  amountIn,
  apiFlightSearch,
  closeFilters,
  currencyIn,
  expectLiveBadgesNotConnected,
  isMobile,
  offerById,
  openFilters,
  rnd,
  searchFlightsInUi,
  searchIdOf,
  visibleCardIds,
} from './v6-helpers';

/**
 * V6 flight experience: dashboard -> Rome round trip, fare calendar (DEMO label, legend, blank cells), choosing a date,
 * filters, featured deal vs. table, supplier failure, and the DEMO provenance labels.
 * Runs as a second adult (own search quota); the calendar endpoint is real here (`calendar: 'real'`, cached per body).
 */
test.describe('V6 טיסות: לוח מחירים, כרטיס מומלץ, טבלה ומסננים', () => {
  test.use({ calendar: 'real' });

  // One fixed future window for the RHO scenarios (V6-02, V6-03) so the calendar request is made once.
  const RHO_DEPART = rnd(45, 200);

  test('V6-01 לוח הבקרה ← חיפוש טיסה הלוך-חזור תל אביב ← רומא: כרטיס מומלץ, מפה, תוצאות ולוח מחירים', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.getByRole('main').getByRole('link', { name: /^טיסות/ }).first().click();
    await expect(page).toHaveURL(/\/search\/flights/);

    await searchFlightsInUi(page, { destination: 'FCO', depart: rnd(40, 200), nights: 6 });

    const results = page.getByTestId('search-results');
    await expect(results).toBeVisible();
    await expect(page.getByTestId('search-summary')).toContainText('TLV');
    await expect(page.getByTestId('search-summary')).toContainText('FCO');

    const featured = page.getByTestId('featured-deal');
    await expect(featured).toBeVisible();
    await expect(featured).toContainText('הזול ביותר מבין ההצעות שנמצאו בחיפוש זה');
    await expect(featured).toContainText('רומא');
    await expect(featured.getByTestId('featured-total')).toContainText('₪');
    // Honest wording: never "the cheapest flight" as a market claim.
    await expect(page.getByTestId('featured-note')).toContainText('לא בהכרח');
    expect(await featured.innerText()).not.toMatch(/הטיסה הזולה ביותר|הזולה בשוק/);

    await expect(page.getByTestId('route-map')).toBeVisible();
    await expect(page.getByTestId('route-legs')).toContainText('TLV');
    await expect(page.getByTestId('route-legs')).toContainText('FCO');

    expect(await page.locator('[data-testid="offer-card"]').count()).toBeGreaterThan(0);

    const calendar = page.getByTestId('fare-calendar');
    await expect(calendar).toHaveAttribute('data-state', 'ready', { timeout: 20_000 });
    expect(await calendar.getByTestId('fare-cell').count()).toBeGreaterThan(20);
    await expect(page.getByTestId('provider-strip')).toContainText('הדגמה');
  });

  test('V6-02 לוח מחירים גמיש מ-DEMO: תווית DEMO, מקרא, ותאים ללא מחיר ריקים (TLV→RHO)', async ({ page, api }) => {
    const search = await apiFlightSearch(api, { destination: 'RHO', depart: RHO_DEPART, nights: 7 });
    await page.goto(`/search/flights?search_id=${search.search_id}`);
    const calendar = page.getByTestId('fare-calendar');
    await expect(calendar).toHaveAttribute('data-state', 'ready', { timeout: 20_000 });

    // DEMO label next to the title, legend with every state, stats and coverage note.
    await expect(calendar.locator('[data-mode="DEMO"]').first()).toBeVisible();
    await expect(calendar.locator('[data-mode="DEMO"]').first()).toContainText('הדגמה');
    // Live-type providers appear only in the (collapsed) sources list, each explicitly "לא מחובר" and not queried.
    await expectLiveBadgesNotConnected(calendar);
    await expect(calendar.getByTestId('fare-cell').locator('[data-mode="LIVE"]')).toHaveCount(0);
    const legend = page.getByTestId('fare-legend');
    for (const t of ['המחיר הנמוך בלוח', 'נמוך', 'בינוני', 'גבוה', 'אין טיסות', 'לא נבדק', 'שגיאה בבדיקה']) {
      await expect(legend).toContainText(t);
    }
    await expect(page.getByTestId('fare-stats')).toContainText(/\d+ עם מחיר/);
    await expect(page.getByTestId('fare-coverage')).toContainText('נתוני הדגמה');
    await expect(page.getByTestId('fare-coverage')).toContainText('ספקים חיים אינם נשאלים');

    // Cells without prices are blank: TLV→RHO has no-service days.
    const noOffers = calendar.locator('[data-testid="fare-cell"][data-status="no_offers"]');
    expect(await noOffers.count(), 'TLV→RHO must have at least one no-service day in the displayed month').toBeGreaterThan(0);
    for (let i = 0; i < Math.min(await noOffers.count(), 6); i++) {
      const cell = noOffers.nth(i);
      const text = (await cell.innerText()).replace(/\s+/g, ' ');
      expect(text, 'a no_offers cell must not show any price').not.toMatch(/[₪$€]|\d{3,}/);
      expect(text).toContain('אין טיסות');
      await expect(cell).toHaveAttribute('aria-label', /אין טיסות/);
      await expect(cell).toHaveAttribute('data-tier', '');
      await expect(cell.locator('[data-amount]')).toHaveCount(0);
    }
    // Priced cells carry a price and a tier; the cheapest is marked `best` (not by colour alone).
    const priced = calendar.locator('[data-testid="fare-cell"][data-status="priced"]');
    expect(await priced.count()).toBeGreaterThan(5);
    await expect(priced.first()).toContainText('₪');
    await expect(priced.first()).toHaveAttribute('aria-label', /₪|ש״ח|\d/);
    expect(await calendar.locator('[data-testid="fare-cell"][data-tier="best"]').count()).toBeGreaterThan(0);
    const tiers = new Set(await priced.evaluateAll((els) => els.map((e) => e.getAttribute('data-tier'))));
    expect(tiers.size, 'more than one price tier is shown').toBeGreaterThan(1);
  });

  test('V6-03 לחיצה על תאריך בלוח מעדכנת את החיפוש (search_id) ואת התוצאות והטבלה', async ({ page, api }, testInfo) => {
    const search = await apiFlightSearch(api, { destination: 'RHO', depart: RHO_DEPART, nights: 7 });
    await page.goto(`/search/flights?search_id=${search.search_id}`);
    const calendar = page.getByTestId('fare-calendar');
    await expect(calendar).toHaveAttribute('data-state', 'ready', { timeout: 20_000 });
    const before = searchIdOf(page.url());
    expect(before).toBe(search.search_id);

    // A priced cell on a different day than the current search.
    const target = calendar.locator(`[data-testid="fare-cell"][data-status="priced"]:not([data-selected]):not([data-date="${futureDate(RHO_DEPART)}"])`).first();
    const date = await target.getAttribute('data-date');
    expect(date).toBeTruthy();
    await target.click();

    await expect(page).not.toHaveURL(new RegExp(`search_id=${before}`), { timeout: 30_000 });
    const after = searchIdOf(page.url());
    expect(after).not.toBe(before);
    // The server-side search is for exactly the chosen date and the same route / 7 nights.
    const fresh = await (await page.request.get(`/api/search/${after}`)).json();
    expect(fresh.params.depart_date).toBe(date);
    expect(fresh.params.origin).toBe('TLV');
    expect(fresh.params.destination).toBe('RHO');
    const nights = Math.round((Date.parse(fresh.params.return_date) - Date.parse(fresh.params.depart_date)) / 86_400_000);
    expect(nights).toBe(7);

    // The results on screen belong to the new search: summary, cards and featured deal all moved to the new date.
    await expect(page.getByTestId('search-results')).toHaveAttribute('data-search-id', after, { timeout: 15_000 });
    await expect(page.getByTestId('featured-deal')).toHaveAttribute('data-offer-id', fresh.highlights.cheapest_offer_id);
    const cardIds = await visibleCardIds(page);
    expect(cardIds.length).toBeGreaterThan(0);
    for (const id of cardIds) expect(fresh.offers.map((o: { id: string }) => o.id)).toContain(id);
    expect(cardIds.some((id) => (search.offers as Array<{ id: string }>).some((o) => o.id === id))).toBe(false);
    // The selected cell is now the clicked day.
    await expect(calendar.locator(`[data-testid="fare-cell"][data-date="${date}"][data-selected]`)).toHaveCount(1);

    // The table (desktop) shows the new search's offers too; phones keep cards.
    if (!isMobile(testInfo)) {
      await page.getByRole('group', { name: 'תצוגת התוצאות' }).getByRole('button', { name: 'טבלה' }).click();
      const table = page.getByTestId('results-table');
      await expect(table).toBeVisible();
      const rowIds = await table.locator('tbody tr').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-offer-id')));
      expect(rowIds.length).toBeGreaterThan(0);
      for (const id of rowIds) expect(fresh.offers.map((o: { id: string }) => o.id)).toContain(id);
      await page.getByRole('group', { name: 'תצוגת התוצאות' }).getByRole('button', { name: 'רשימה' }).click();
    }
  });

  test('V6-04 מסנני עצירות, מזוודה לבטן ומחיר מקסימלי: כל תוצאה שמוצגת עומדת בסינון', async ({ page, api }, testInfo) => {
    const mobile = isMobile(testInfo);
    const search = await apiFlightSearch(api, { destination: 'FCO', depart: rnd(40, 200), nights: 6, adults: 2 });
    const offers = search.offers as Array<{ id: string; price: { total: { amount: string } }; details: { max_stops: number; baggage: { checked_included: number | null } } }>;
    expect(offers.some((o) => o.details.max_stops === 0) && offers.some((o) => o.details.max_stops > 0), 'fixture must mix direct and connecting flights').toBe(true);
    expect(offers.some((o) => (o.details.baggage.checked_included ?? 0) > 0) && offers.some((o) => !(o.details.baggage.checked_included ?? 0)), 'fixture must mix bag / no bag').toBe(true);

    await page.goto(`/search/flights?search_id=${search.search_id}`);
    await expect(page.locator('[data-testid="offer-card"]').first()).toBeVisible();
    const shownCount = async () => {
      const t = await page.getByTestId('search-results').innerText();
      return Number(/מוצגות (\d+) אחרי סינון/.exec(t)?.[1] ?? NaN);
    };
    const assertCards = async (pred: (o: (typeof offers)[number]) => boolean, why: string) => {
      const ids = await visibleCardIds(page);
      expect(ids.length, `${why}: some cards remain`).toBeGreaterThan(0);
      for (const id of ids) expect(pred(offerById(search, id)), `${why}: offer ${id}`).toBe(true);
      const expected = offers.filter(pred).length;
      expect(await shownCount(), `${why}: shown count`).toBe(expected);
      expect(ids.length).toBe(Math.min(expected, 12));
    };

    // --- stops: direct only
    let panel = await openFilters(page, mobile);
    await panel.getByLabel('עצירות').selectOption({ label: 'ישירות בלבד' });
    await closeFilters(page, mobile);
    await assertCards((o) => o.details.max_stops === 0, 'direct only');

    // --- + checked bag included
    panel = await openFilters(page, mobile);
    await panel.getByLabel('כולל מזוודה לבטן').check();
    await closeFilters(page, mobile);
    await assertCards((o) => o.details.max_stops === 0 && (o.details.baggage.checked_included ?? 0) > 0, 'direct + checked bag');
    // The visible cards say so (baggage text), they are not merely "not filtered out".
    const bagTexts = await page.locator('[data-testid="offer-card"]').allInnerTexts();
    for (const t of bagTexts) expect(t).not.toMatch(/ללא מזוודה לבטן/);

    // --- + max price (median of what is left)
    const left = offers.filter((o) => o.details.max_stops === 0 && (o.details.baggage.checked_included ?? 0) > 0).map((o) => Number(o.price.total.amount)).sort((a, b) => a - b);
    expect(left.length).toBeGreaterThan(1);
    const cap = Math.floor(left[Math.floor(left.length / 2) - (left.length > 2 ? 0 : 1)] ?? left[0]);
    panel = await openFilters(page, mobile);
    await panel.getByLabel(/^מחיר מקסימלי/).fill(String(cap));
    await closeFilters(page, mobile);
    await assertCards(
      (o) => o.details.max_stops === 0 && (o.details.baggage.checked_included ?? 0) > 0 && Number(o.price.total.amount) <= cap,
      `direct + bag + max ${cap}`,
    );
    // Totals rendered on the cards never exceed the cap.
    const totals = await allAmounts(page.locator('[data-testid="offer-card"]'));
    expect(totals.length).toBeGreaterThan(0);

    // --- clearing restores everything
    await page.getByRole('button', { name: 'ניקוי מסננים', exact: true }).first().click();
    await expect(page.getByTestId('result-count')).toContainText(`${offers.length} הצעות`);
  });

  test('V6-05 הכרטיס המומלץ תואם למחיר המינימלי בטבלה, עם סה״כ ולנוסע מסומנים נכון', async ({ page, api }, testInfo) => {
    const children = [7];
    const travelers = 3;
    const search = await apiFlightSearch(api, { destination: 'FCO', depart: rnd(40, 200), nights: 6, adults: 2, children });
    const offers = search.offers as Array<{ id: string; price: { total: { amount: string; currency: string }; per_person: { amount: string } | null } }>;
    const cur = search.highlights.currency as string;
    const same = offers.filter((o) => o.price.total.currency === cur);
    const min = Math.min(...same.map((o) => Number(o.price.total.amount)));

    await page.goto(`/search/flights?search_id=${search.search_id}`);
    const featured = page.getByTestId('featured-deal');
    await expect(featured).toBeVisible();
    await expect(featured).toHaveAttribute('data-offer-id', search.highlights.cheapest_offer_id);
    const total = featured.getByTestId('featured-total');
    expect(await amountIn(total)).toBe(min);
    expect(await currencyIn(total)).toBe(cur);

    // Labelling: total for N travellers + per person, per-person = total / travellers.
    await expect(featured).toContainText(`סה״כ ל-${travelers} נוסעים`);
    const perPerson = featured.getByTestId('featured-per-person');
    await expect(perPerson).toContainText('לנוסע');
    expect(Math.abs((await amountIn(perPerson)) - min / travelers)).toBeLessThanOrEqual(0.011);
    await expect(featured.getByTestId('featured-note')).toContainText('הזול ביותר מבין ההצעות שנמצאו בחיפוש זה');

    if (isMobile(testInfo)) {
      // Phones keep the card list (the table is a desktop view).
      await expect(page.getByTestId('results-table')).toHaveCount(0);
      const card = page.locator(`[data-testid="offer-card"][data-offer-id="${search.highlights.cheapest_offer_id}"]`);
      if (await card.count()) expect(await amountIn(card)).toBe(min);
      return;
    }

    await page.getByRole('group', { name: 'תצוגת התוצאות' }).getByRole('button', { name: 'טבלה' }).click();
    const table = page.getByTestId('results-table');
    await expect(table).toBeVisible();
    // Sort by price so the first row is the minimum of the whole result set, not just of page one.
    await page.getByRole('combobox', { name: /מיון/ }).selectOption({ label: 'מחיר: מהזול ליקר' });
    const rows = table.locator('tbody tr');
    const totals = await rows.evaluateAll((trs) => trs.map((r) => Number(r.querySelectorAll('td')[1].querySelector('[data-amount]')?.getAttribute('data-amount'))));
    const curs = await rows.evaluateAll((trs) => trs.map((r) => r.querySelectorAll('td')[1].querySelector('[data-currency]')?.getAttribute('data-currency')));
    expect(totals.length).toBeGreaterThan(5);
    expect(curs.every((c) => c === cur)).toBe(true);
    expect(Math.min(...totals), 'featured total equals the table minimum').toBe(await amountIn(total));
    expect(totals[0]).toBe(min);
    // The featured row is marked in the table, with the same per-person figure.
    const featRow = table.locator('tbody tr[data-featured]');
    await expect(featRow).toHaveCount(1);
    await expect(featRow).toHaveAttribute('data-offer-id', search.highlights.cheapest_offer_id);
    await expect(featRow).toContainText('הזול בחיפוש');
    const rowPerPerson = Number(await featRow.locator('td').nth(2).locator('[data-amount]').first().getAttribute('data-amount'));
    expect(Math.abs(rowPerPerson - (await amountIn(perPerson)))).toBeLessThanOrEqual(0.011);
    // Table columns are the contract's: supplier, itinerary, total, per person, baggage, cancellation, checked, mode.
    const heads = (await table.locator('thead th').allInnerTexts()).join(' | ');
    for (const h of ['חברה וספק', 'מסלול', 'סה״כ', 'לנוסע', 'כבודה', 'ביטול', 'נבדק', 'מקור']) expect(heads).toContain(h);
  });

  test('V6-06 כשל ספק: תוצאות חלקיות ושגיאת ספק מפורשת בפס הספקים', async ({ page, api, ownerApi }) => {
    const restore = async () => {
      await ownerApi.put('/api/providers/demo_aurora', { enabled: true, settings: {} });
      // Provider health stays DEGRADED until the next clean run -- run one so later specs see healthy providers.
      await apiFlightSearch(api, { destination: 'ATH', depart: rnd(40, 200), nights: 4, adults: 1 });
    };
    try {
      await ownerApi.json(await ownerApi.put('/api/providers/demo_aurora', { enabled: true, settings: { simulate_error: true } }));
      const search = await apiFlightSearch(api, { destination: 'FCO', depart: rnd(40, 200), nights: 5, adults: 1 });
      expect(search.status).toBe('partial');
      const run = (search.providers as Array<{ provider_id: string; status: string; error_code: string | null }>).find((p) => p.provider_id === 'demo_aurora');
      expect(run?.status).toBe('FAILED');
      expect(run?.error_code).toBe('SIMULATED_ERROR');

      await page.goto(`/search/flights?search_id=${search.search_id}`);
      await expect(page.locator('[data-testid="offer-card"]').first()).toBeVisible();
      await expect(page.getByText('חלק מהספקים לא ענו')).toBeVisible();
      await expect(page.getByText(/התוצאות חלקיות/)).toBeVisible();
      const strip = page.getByTestId('provider-strip');
      await expect(strip).toContainText('דמו אורורה');
      await expect(strip).toContainText('נכשל');
      await expect(page.getByText(/ספקים שנכשלו או לא הגיבו בזמן: דמו אורורה/)).toBeVisible();
      await expect(strip).not.toContainText(/Traceback|Exception|SIMULATED_ERROR/);
      // Results shown are only the healthy provider's, all still labelled DEMO, featured deal included.
      for (const id of await visibleCardIds(page)) expect(offerById(search, id).source.provider_id).toBe('demo_skyline');
      await expect(page.getByTestId('featured-deal')).toBeVisible();
    } finally {
      await restore();
    }
    const providers = await (await api.get('/api/providers')).json();
    expect(providers.find((p: { provider_id: string }) => p.provider_id === 'demo_aurora').settings?.simulate_error ?? false).toBeFalsy();
  });

  test('V6-20 תוויות הנתונים תואמות למקור: הכול DEMO, ספקים חיים "לא מחובר", ושום רכיב לא טוען LIVE', async ({ page, api }, testInfo) => {
    const search = await apiFlightSearch(api, { destination: 'FCO', depart: rnd(40, 200), nights: 6, adults: 2 });
    // Ground truth: every offer the API returns is DEMO and no live result exists.
    expect((search.offers as Array<{ source: { mode: string } }>).every((o) => o.source.mode === 'DEMO')).toBe(true);
    expect(search.has_live_results).toBe(false);
    expect(search.has_demo_results).toBe(true);

    await page.goto(`/search/flights?search_id=${search.search_id}`);
    const results = page.getByTestId('search-results');
    await expect(page.locator('[data-testid="offer-card"]').first()).toBeVisible();
    await expect(page.getByTestId('fare-calendar')).toHaveAttribute('data-state', /ready|error|loading|idle/);

    const noLive = async (where: string) => {
      await expectLiveBadgesNotConnected(page.locator('main'), 'li');
      await expect(page.locator('[data-testid="offer-card"] [data-mode="LIVE"], [data-testid="featured-deal"] [data-mode="LIVE"], [data-testid="results-table"] [data-mode="LIVE"], [data-testid="fare-cell"] [data-mode="LIVE"]'), `${where}: no LIVE offer badge`).toHaveCount(0);
      await expect(page.locator('[data-testid="source-line"]', { hasText: /מקור נתונים:\s*חי/ }), `${where}: no "חי" source`).toHaveCount(0);
      await expect(page.getByTestId('data-mode-indicator'), `${where}: global indicator`).toHaveAttribute('data-mode', 'DEMO');
    };
    await noLive('results (list)');

    // Every card, the featured deal and the route map subtitle carry DEMO.
    const cards = page.locator('[data-testid="offer-card"]');
    for (let i = 0; i < (await cards.count()); i++) await expect(cards.nth(i).getByTestId('source-line')).toContainText('הדגמה');
    await expect(page.getByTestId('featured-deal').locator('[data-mode="DEMO"]').first()).toContainText('הדגמה');
    await expect(results.getByText('חלק מהתוצאות הן נתוני הדגמה')).toBeVisible();

    // Table rows (desktop): the last-but-one column is the data-mode badge of each row.
    if (!isMobile(testInfo)) {
      await page.getByRole('group', { name: 'תצוגת התוצאות' }).getByRole('button', { name: 'טבלה' }).click();
      const rows = page.getByTestId('results-table').locator('tbody tr');
      const n = await rows.count();
      expect(n).toBeGreaterThan(0);
      for (let i = 0; i < n; i++) await expect(rows.nth(i).locator('[data-mode="DEMO"]')).toHaveCount(1);
      await noLive('results (table)');
      await page.getByRole('group', { name: 'תצוגת התוצאות' }).getByRole('button', { name: 'רשימה' }).click();
    }

    // Provider strip: DEMO providers answered, live providers are "not connected", nobody claims LIVE.
    const strip = page.getByTestId('provider-strip');
    await expect(strip).toContainText('הדגמה');
    await expect(strip).toContainText('לא מחובר');
    expect(await strip.innerText()).not.toMatch(/מקור נתונים:\s*חי|מצב ספק:\s*(חי|פעיל)/);

    // Fare calendar cells: the panel is DEMO-labelled and so is the cell detail line (when the calendar answered).
    const cal = page.getByTestId('fare-calendar');
    if ((await cal.getAttribute('data-state')) === 'ready') {
      await expect(cal.locator('[data-mode="DEMO"]').first()).toBeVisible();
      await expect(page.getByTestId('fare-cell-details')).toContainText('הדגמה');
    }

    // Providers page + dashboard widgets.
    await page.goto('/providers');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const cardsP = page.getByTestId('provider-card');
    await expect(cardsP.first()).toBeVisible();
    const count = await cardsP.count();
    expect(count).toBeGreaterThanOrEqual(6);
    let demo = 0;
    let live = 0;
    for (let i = 0; i < count; i++) {
      const text = (await cardsP.nth(i).innerText()).replace(/\s+/g, ' ');
      if (/הדגמה/.test(text) && /דמו/.test(text)) {
        demo++;
        expect(text, 'DEMO provider card').toMatch(/תקין|הדגמה/);
      } else {
        live++;
        expect(text, `live provider card must read "לא מחובר": ${text.slice(0, 80)}`).toContain('לא מחובר');
        expect(text).not.toMatch(/מקור נתונים:\s*חי|מצב ספק:\s*(חי|פעיל|תקין)/);
      }
    }
    expect(demo).toBeGreaterThanOrEqual(6);
    expect(live).toBeGreaterThanOrEqual(3);
    // The page lists live-TYPE providers with a "חי" type badge, but each must also say they are not connected.
    await expect(page.getByTestId('data-mode-indicator')).toHaveAttribute('data-mode', 'DEMO');
    await expectLiveBadgesNotConnected(cardsP, 'article');

    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await noLive('dashboard');
  });
});

import { expect, type Page } from '@playwright/test';
import { test } from './fixtures-v6';
import { duplicateIds, expectBasicA11y, expectNoHorizontalOverflow, textContrast } from './a11y';
import { futureDate, uniq } from './env';
import { closeTopDialog } from './search-common';
import { apiFlightSearch, rnd, searchIdOf } from './v6-helpers';

/** One window for the calendar scenarios so the (rate-limited) calendar endpoint is asked once per project run. */
const CAL_DEPART = rnd(60, 180);

async function activeDate(page: Page): Promise<string | null> {
  return page.evaluate(() => document.activeElement?.getAttribute('data-date') ?? null);
}

const addDays = (iso: string, n: number) => new Date(Date.parse(iso) + n * 86_400_000).toISOString().slice(0, 10);

test.describe('V6 מובייל (390px): ללא גלישה אופקית ואינטראקציית מגע', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, calendar: 'real' });

  test('V6-16 אין גלישה אופקית בעמודים המרכזיים, ולחיצת מגע על תא בלוח השבוע מעדכנת את החיפוש', async ({ page, api }) => {
    test.setTimeout(120_000);
    const search = await apiFlightSearch(api, { destination: 'FCO', depart: CAL_DEPART, nights: 7, adults: 2 });
    const solo = await apiFlightSearch(api, { destination: 'ATH', depart: rnd(40, 200), nights: 4, adults: 1 });
    const members = await api.json(await api.get('/api/family/members'));
    const trip = await api.json(await api.post('/api/trips', { title: uniq('מובייל-'), destination: 'Athens', start_date: futureDate(CAL_DEPART), end_date: futureDate(CAL_DEPART + 7), traveler_ids: [] }));
    await api.json(await api.post(`/api/trips/${trip.id}/items/from-offer`, { offer_id: solo.offers[0].id }));
    const booking = await api.json(await api.post('/api/bookings', { offer_id: solo.offers[0].id, traveler_member_ids: [members[0].id], simulation_scenario: 'success' }));
    await api.json(await api.post(`/api/bookings/${booking.id}/revalidate`, {}));
    try {
      const pages: Array<[string, string]> = [
        ['dashboard', '/'],
        ['flight form', '/search/flights'],
        ['flight results + calendar strip', `/search/flights?search_id=${search.search_id}`],
        ['hotels form', '/search/hotels'],
        ['cars form', '/search/cars'],
        ['activities form', '/search/activities'],
        ['trip', `/trips/${trip.id}`],
        ['booking review', `/bookings/${booking.id}`],
        ['assistant', '/assistant'],
        ['providers', '/providers'],
        ['family', '/family'],
        ['settings', '/settings'],
      ];
      for (const [label, url] of pages) {
        await page.goto(url);
        await expect(page.locator('h1').first()).toBeVisible();
        await page.waitForLoadState('networkidle');
        await expectNoHorizontalOverflow(page, label);
      }

      // --- the calendar on a phone: a one-row strip with week buttons, touch targets >= 44px, tap selects a day.
      await page.goto(`/search/flights?search_id=${search.search_id}`);
      const calendar = page.getByTestId('fare-calendar');
      await expect(calendar).toHaveAttribute('data-state', 'ready', { timeout: 20_000 });
      const strip = page.getByTestId('fare-strip');
      await expect(strip).toBeVisible();
      await expect(calendar.locator('[role="grid"] [data-testid="fare-cell"]').first()).toBeVisible();
      await expectNoHorizontalOverflow(page, 'calendar strip');
      // The strip scrolls inside itself (not the page).
      const scrollable = await strip.evaluate((el) => el.scrollWidth > el.clientWidth);
      expect(scrollable).toBe(true);

      const nextWeek = calendar.getByRole('button', { name: 'השבוע הבא' });
      const prevWeek = calendar.getByRole('button', { name: 'השבוע הקודם' });
      for (const b of [nextWeek, prevWeek]) {
        const box = (await b.boundingBox())!;
        expect(box.height, 'week button touch height').toBeGreaterThanOrEqual(43.5);
      }
      const before = await strip.evaluate((el) => el.scrollLeft);
      await nextWeek.tap();
      await expect.poll(() => strip.evaluate((el) => el.scrollLeft)).not.toBe(before);

      const cells = calendar.locator('[data-testid="fare-cell"][data-status="priced"]:not([data-selected])');
      const target = cells.first();
      await target.scrollIntoViewIfNeeded();
      const box = (await target.boundingBox())!;
      expect(box.height, 'fare cell touch height').toBeGreaterThanOrEqual(43.5);
      expect(box.width, 'fare cell touch width').toBeGreaterThanOrEqual(43.5);
      const date = await target.getAttribute('data-date');
      const was = searchIdOf(page.url());
      await target.tap();
      await expect(page).not.toHaveURL(new RegExp(`search_id=${was}`), { timeout: 30_000 });
      const fresh = await (await page.request.get(`/api/search/${searchIdOf(page.url())}`)).json();
      expect(fresh.params.depart_date).toBe(date);
      await expect(page.getByTestId('search-results')).toHaveAttribute('data-search-id', searchIdOf(page.url()));
      await expect(page.getByTestId('featured-deal')).toBeVisible();
      // Phones show cards, never the wide table, and the page still does not scroll sideways.
      await expect(page.getByTestId('results-table')).toHaveCount(0);
      expect(await page.locator('[data-testid="offer-card"]').count()).toBeGreaterThan(0);
      await expectNoHorizontalOverflow(page, 'results after tap');

      // Filter drawer opens by touch and closes again.
      await page.getByRole('button', { name: /^דירוג וסינון/ }).tap();
      await expect(page.getByRole('dialog', { name: 'דירוג וסינון' })).toBeVisible();
      await page.getByRole('button', { name: /^הצגת \d+ הצעות/ }).tap();
      await expect(page.getByRole('dialog', { name: 'דירוג וסינון' })).toBeHidden();
    } finally {
      await api.del(`/api/trips/${trip.id}`);
      await api.post(`/api/bookings/${booking.id}/cancel`, {});
    }
  });
});

test.describe('V6 נגישות, מקלדת, ערכות צבעים ותנועה', () => {
  test.use({ viewport: { width: 1440, height: 900 }, calendar: 'real' });

  test('V6-17a מקלדת: ניווט בחצים בלוח המחירים, Enter בוחר, ופוקוס חוזר מדיאלוגים', async ({ page, api }) => {
    const search = await apiFlightSearch(api, { destination: 'FCO', depart: CAL_DEPART, nights: 7, adults: 2 });
    await page.goto(`/search/flights?search_id=${search.search_id}`);
    const calendar = page.getByTestId('fare-calendar');
    await expect(calendar).toHaveAttribute('data-state', 'ready', { timeout: 20_000 });
    await expect(calendar).toHaveAttribute('data-view', 'month');

    // Roving tabindex: exactly one cell is in the tab order.
    expect(await calendar.locator('[data-testid="fare-cell"][tabindex="0"]').count()).toBe(1);

    // Focus a mid-month priced cell, then move around with the arrows (RTL: ArrowLeft = next day).
    const start = calendar.locator('[data-testid="fare-cell"][data-status="priced"]').nth(3);
    await start.focus();
    const d0 = (await start.getAttribute('data-date'))!;
    expect(await activeDate(page)).toBe(d0);
    await page.keyboard.press('ArrowLeft');
    expect(await activeDate(page), 'ArrowLeft goes to the next day in RTL').toBe(addDays(d0, 1));
    await page.keyboard.press('ArrowRight');
    expect(await activeDate(page), 'ArrowRight goes back').toBe(d0);
    await page.keyboard.press('ArrowDown');
    expect(await activeDate(page), 'ArrowDown goes one week later').toBe(addDays(d0, 7));
    await page.keyboard.press('ArrowUp');
    expect(await activeDate(page), 'ArrowUp goes one week earlier').toBe(d0);
    await page.keyboard.press('End');
    const end = (await activeDate(page))!;
    await page.keyboard.press('Home');
    const home = (await activeDate(page))!;
    // Home = first day of the visual week row (Sunday); End = its last day (Saturday) unless the month ends first.
    const monthStarts = (await calendar.locator(`[data-testid="fare-cell"][data-date="${addDays(home, -1)}"]`).count()) === 0;
    expect(new Date(`${home}T00:00:00Z`).getUTCDay() === 0 || monthStarts, 'Home goes to the start of the week row').toBe(true);
    const endDow = new Date(`${end}T00:00:00Z`).getUTCDay();
    const monthEnds = (await calendar.locator(`[data-testid="fare-cell"][data-date="${addDays(end, 1)}"]`).count()) === 0;
    expect(endDow === 6 || monthEnds, 'End goes to the end of the week row').toBe(true);
    expect(Date.parse(end)).toBeGreaterThan(Date.parse(home));
    // Still exactly one tab stop after moving.
    expect(await calendar.locator('[data-testid="fare-cell"][tabindex="0"]').count()).toBe(1);
    // The focused cell announces its details (date, nights, price/state) in its accessible name.
    const label = await calendar.locator('[data-testid="fare-cell"]:focus').getAttribute('aria-label');
    expect(label).toMatch(/יציאה .*חזרה .*\(7 לילות\)/);

    // Enter on a priced cell runs the search for that day.
    const pricedDate = await calendar.locator('[data-testid="fare-cell"][data-status="priced"]:not([data-selected])').first().getAttribute('data-date');
    await calendar.locator(`[data-testid="fare-cell"][data-date="${pricedDate}"]`).focus();
    const was = searchIdOf(page.url());
    await page.keyboard.press('Enter');
    await expect(page).not.toHaveURL(new RegExp(`search_id=${was}`), { timeout: 30_000 });
    const fresh = await (await page.request.get(`/api/search/${searchIdOf(page.url())}`)).json();
    expect(fresh.params.depart_date).toBe(pricedDate);

    // Matrix view (depart x nights): arrows move in two dimensions.
    await calendar.getByRole('radio', { name: 'מטריצת לילות' }).click();
    await expect(calendar).toHaveAttribute('data-view', 'matrix');
    await expect(calendar).toHaveAttribute('data-state', 'ready', { timeout: 20_000 });
    const m0 = calendar.locator('[data-testid="fare-cell"]').nth(8);
    await m0.focus();
    const nights0 = Number(await m0.getAttribute('data-nights'));
    const dep0 = (await m0.getAttribute('data-date'))!;
    await page.keyboard.press('ArrowDown');
    expect(Number(await page.evaluate(() => document.activeElement?.getAttribute('data-nights'))), 'ArrowDown = next row (more nights)').toBeGreaterThan(nights0);
    expect(await activeDate(page)).toBe(dep0);
    await page.keyboard.press('ArrowUp');
    expect(Number(await page.evaluate(() => document.activeElement?.getAttribute('data-nights')))).toBe(nights0);
    await page.keyboard.press('ArrowLeft');
    expect(await activeDate(page), 'RTL: ArrowLeft = next depart date').toBe(addDays(dep0, 1));
    await calendar.getByRole('radio', { name: 'לוח חודשי' }).click();

    // Dialogs return focus to the control that opened them (BUG-QA-01 regression + the new offer-details dialog).
    const details = page.locator('[data-testid="offer-card"]').first().getByRole('button', { name: 'פרטים' });
    await details.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    await closeTopDialog(page); // an open hover tooltip inside the dialog may take the first Escape
    await expect(details).toBeFocused();

    await page.goto('/trips');
    const opener = page.getByRole('button', { name: 'טיול חדש' }).first();
    await opener.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'טיול חדש' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(opener).toBeFocused();

    // The user menu (dropdown) returns focus to its trigger too.
    const menu = page.getByRole('button', { name: /תפריט משתמש/ });
    await menu.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toBeHidden();
    await expect(menu).toBeFocused();
  });

  test('V6-17b נגישות: h1 יחיד, בקרות עם תוויות, ללא מזהים כפולים, ותנועה מופחתת מכובדת', async ({ page, api }) => {
    const search = await apiFlightSearch(api, { destination: 'FCO', depart: CAL_DEPART, nights: 7, adults: 2 });
    const pages: Array<[string, string]> = [
      ['dashboard', '/'],
      ['flight results (calendar, featured deal, map)', `/search/flights?search_id=${search.search_id}`],
      ['hotels form', '/search/hotels'],
      ['cars form', '/search/cars'],
      ['providers', '/providers'],
      ['trips', '/trips'],
    ];
    for (const [label, url] of pages) {
      await page.goto(url);
      await expect(page.locator('h1').first()).toBeVisible();
      await page.waitForLoadState('networkidle');
      await expectBasicA11y(page, label);
      expect(await duplicateIds(page), `${label}: duplicate ids`).toEqual([]);
    }

    // Table view (desktop) has a caption, column headers and row headers.
    await page.goto(`/search/flights?search_id=${search.search_id}`);
    await page.getByRole('group', { name: 'תצוגת התוצאות' }).getByRole('button', { name: 'טבלה' }).click();
    const table = page.getByTestId('results-table');
    await expect(table).toBeVisible();
    await expect(table.locator('caption')).toHaveCount(1);
    expect(await table.locator('thead th[scope="col"]').count()).toBeGreaterThanOrEqual(8);
    expect(await table.locator('tbody th[scope="row"]').count()).toBeGreaterThan(0);
    await expectBasicA11y(page, 'results table');
    // The route map is described (not an unlabeled picture).
    await page.getByRole('group', { name: 'תצוגת התוצאות' }).getByRole('button', { name: 'רשימה' }).click();
    const map = page.getByTestId('route-map');
    await expect(map).toBeVisible();
    await expect(map.locator('svg').first()).toHaveAttribute('role', /img|graphics-document|presentation|figure/);
    await expect(page.getByTestId('route-legs')).toContainText('TLV');

    // prefers-reduced-motion: honoured by the CSS (transitions/animations collapse to ~0) and by the cell hover lift.
    const cell = page.locator('[data-testid="fare-cell"][data-status="priced"]').first();
    const canHover = await page.evaluate(() => matchMedia('(hover: hover)').matches);
    const lift = (el: Element) => {
      const cs = getComputedStyle(el);
      return `${cs.transform}|${cs.translate}`;
    };
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.reload();
    await expect(page.getByTestId('fare-calendar')).toHaveAttribute('data-state', 'ready', { timeout: 20_000 });
    if (canHover) {
      await cell.hover();
      await page.waitForTimeout(350);
      expect(await cell.evaluate(lift), 'with motion allowed the hovered cell lifts').not.toMatch(/^none\|(none|0px)?$/);
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
    await page.mouse.move(0, 0);
    await page.reload();
    await expect(page.getByTestId('fare-calendar')).toHaveAttribute('data-state', 'ready', { timeout: 20_000 });
    if (canHover) {
      await cell.hover();
      await page.waitForTimeout(150);
      expect(await cell.evaluate(lift), 'with reduced motion the hovered cell does not move').toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))\|(none|0px)?$/);
    }
    const durations = await page.evaluate(() => {
      const bad: string[] = [];
      for (const el of Array.from(document.querySelectorAll('body *')).slice(0, 1500)) {
        const cs = getComputedStyle(el);
        for (const prop of [cs.transitionDuration, cs.animationDuration]) {
          for (const d of prop.split(',')) {
            const v = parseFloat(d);
            const ms = d.trim().endsWith('ms') ? v : v * 1000;
            if (ms > 50) bad.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)}: ${d}`);
          }
        }
      }
      return bad.slice(0, 5);
    });
    expect(durations, 'no transition/animation longer than 50ms under reduced motion').toEqual([]);
  });

  // BUG-E2E-02 (a11y, low): ChildAgesEditor builds ids as `child-age-${index}`, so two hotel rooms that each have a child
  // render the same id twice; the visible label's `for` then points at an ambiguous target (the aria-label still names the
  // select, so it is not unlabeled -- but duplicate ids are invalid HTML and break label clicks). Fix: useId() per editor.
  test('V6-17d טופס מלונות עם ילד בכל חדר: אין מזהים כפולים (BUG-E2E-02 תוקן)', async ({ page }) => {
    await page.goto('/search/hotels');
    const room = (n: number) => page.getByRole('listitem').filter({ has: page.getByRole('heading', { level: 3, name: `חדר ${n}` }) });
    await room(1).getByRole('button', { name: 'הוספת ילד' }).click();
    await page.getByRole('button', { name: 'הוספת חדר' }).click();
    await room(2).getByRole('button', { name: 'הוספת ילד' }).click();
    await expect(page.getByLabel('גיל ילד 1')).toHaveCount(2);
    expect(await duplicateIds(page), 'duplicate ids on the hotel form').toEqual([]);
  });

  test('V6-17c מצב כהה: מתג ערכת הצבעים משנה את html, נשמר ברענון, ומנוגדות הטקסט עומדת ב-AA', async ({ page, api }) => {
    const search = await apiFlightSearch(api, { destination: 'FCO', depart: CAL_DEPART, nights: 7, adults: 2 });
    await page.goto(`/search/flights?search_id=${search.search_id}`);
    await expect(page.getByTestId('fare-calendar')).toHaveAttribute('data-state', 'ready', { timeout: 20_000 });
    const html = page.locator('html');
    const bodyBg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

    const pick = async (id: 'theme-light' | 'theme-dark' | 'theme-system') => {
      await page.getByRole('button', { name: /תפריט משתמש/ }).click();
      await page.getByTestId(id).click();
      await page.keyboard.press('Escape');
    };

    await pick('theme-light');
    await expect(html).toHaveAttribute('data-theme', 'light');
    const lightBg = await bodyBg();
    const lightIssues = await textContrast(page, 'h1, h2, [data-testid="fare-cell"][data-status="priced"], [data-testid="fare-legend"] li, [data-testid="featured-total"], [data-testid="offer-card"] h3');
    for (const r of lightIssues) expect(r.ratio, `light: "${r.text}" fg ${r.fg} on ${r.bg}`).toBeGreaterThanOrEqual(4.5);

    await pick('theme-dark');
    await expect(html).toHaveAttribute('data-theme', 'dark');
    expect(await html.evaluate((el) => getComputedStyle(el).colorScheme)).toContain('dark');
    const darkBg = await bodyBg();
    expect(darkBg, 'the page background changes in dark mode').not.toBe(lightBg);
    expect(await page.evaluate(() => localStorage.getItem('ori.theme'))).toBe('dark');
    // Survives a reload, and the fare calendar / featured deal are still rendered with readable text.
    await page.reload();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByTestId('fare-calendar')).toHaveAttribute('data-state', 'ready', { timeout: 20_000 });
    const dark = await textContrast(page, 'h1, h2, [data-testid="fare-cell"][data-status="priced"], [data-testid="fare-cell"][data-status="no_offers"], [data-testid="fare-legend"] li, [data-testid="featured-total"], [data-testid="offer-card"] h3, [data-testid="results-table"] td', 60);
    expect(dark.length).toBeGreaterThan(5);
    expect(Math.max(...dark.map((r) => r.ratio)), 'sanity: the contrast probe measures real colours').toBeGreaterThan(7);
    expect(Math.min(...dark.map((r) => r.ratio))).toBeGreaterThan(1.5);
    const low = dark.filter((r) => r.ratio < 4.5);
    expect(low, `dark mode text below 4.5:1: ${JSON.stringify(low.slice(0, 5))}`).toEqual([]);

    // Follow the system when no manual choice is made.
    await pick('theme-system');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.reload();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await page.reload();
    await expect(html).toHaveAttribute('data-theme', 'light');
    await expect(page.getByRole('button', { name: /תפריט משתמש/ })).toBeVisible();
  });
});

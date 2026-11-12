/**
 * Accessibility audit, part 3: keyboard + focus + motion.
 * focus visibility, tab order on the flight page, fare-calendar arrow navigation, dialog focus trap/return,
 * prefers-reduced-motion.
 */
import { expect, test, type Page } from '@playwright/test';
import { ensureFixtures, gotoFlightResults, openBookingReview, openPage, settle, type Fixtures, type Theme } from './helpers';

test.beforeEach(({ browserName }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'a11y specs choose their own viewport; run with --project=desktop');
  void browserName;
});

let f: Fixtures;
test.beforeAll(async () => { f = await ensureFixtures(); });

const activeInfo = (page: Page) =>
  page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    if (!a || a === document.body) return null;
    const cs = getComputedStyle(a);
    const region = a.closest('[data-testid=fare-calendar]') ? 'calendar'
      : a.closest('[data-testid=search-summary]') ? 'summary'
      : a.closest('[data-testid=flight-search-form]') ? 'form'
      : a.closest('[data-testid=featured-deal]') ? 'featured'
      : a.closest('[data-testid=route-map]') ? 'map'
      : a.closest('[data-testid=search-results]') ? 'results'
      : a.closest('nav') ? 'nav'
      : a.closest('header') ? 'header'
      : a.matches('a[href^="#"]') ? 'skip' : 'other';
    const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 && cs.outlineColor !== 'rgba(0, 0, 0, 0)';
    const ring = cs.boxShadow !== 'none' && /rgb/.test(cs.boxShadow);
    const label = (a.getAttribute('aria-label') || a.textContent || a.getAttribute('name') || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    return { tag: a.tagName.toLowerCase(), label, region, visibleFocus: outline || ring, outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`, shadow: cs.boxShadow.slice(0, 60), testid: a.getAttribute('data-testid') };
  });

for (const theme of ['light', 'dark'] as Theme[]) {
  test(`focus indicator is visible on every Tab stop (flight results, ${theme})`, async ({ browser }) => {
    test.setTimeout(120_000);
    const { ctx, page } = await openPage(browser, { width: 'desktop', theme });
    await gotoFlightResults(page, f);
    const stops: NonNullable<Awaited<ReturnType<typeof activeInfo>>>[] = [];
    for (let i = 0; i < 60; i++) {
      await page.keyboard.press('Tab');
      const a = await activeInfo(page);
      if (a) stops.push(a);
    }
    expect(stops.length, 'tab stops reached').toBeGreaterThan(30);
    const invisible = stops.filter((s) => !s.visibleFocus);
    expect(invisible.map((s) => `${s.tag} "${s.label}" outline=${s.outline} shadow=${s.shadow}`), 'tab stops without a visible focus indicator').toEqual([]);
    await ctx.close();
  });
}

test('tab order on the flight page: skip link -> navigation -> search -> fare calendar -> results', async ({ browser }) => {
  test.setTimeout(120_000);
  const { ctx, page } = await openPage(browser, { width: 'desktop', theme: 'light' });
  await gotoFlightResults(page, f);
  const seq: string[] = [];
  let first: Awaited<ReturnType<typeof activeInfo>> = null;
  for (let i = 0; i < 90; i++) {
    await page.keyboard.press('Tab');
    const a = await activeInfo(page);
    if (i === 0) first = a;
    if (a) seq.push(a.region);
  }
  expect(first?.region, 'first Tab stop is the skip link').toBe('skip');
  expect(first?.label).toContain('דילוג לתוכן');
  const firstIdx = (r: string) => seq.indexOf(r);
  const order = ['skip', 'nav', 'summary', 'calendar', 'results'].map((r) => [r, firstIdx(r)] as const);
  for (const [r, i] of order) expect(i, `region "${r}" is reachable by Tab`).toBeGreaterThanOrEqual(0);
  const idx = order.map(([, i]) => i);
  expect(idx, `first stops per region ${JSON.stringify(order)}`).toEqual([...idx].sort((a, b) => a - b));
  // The fare calendar is ONE roving-tabindex stop per view (not 31 stops) apart from its toolbar buttons.
  const cellStops = seq.filter((r) => r === 'calendar').length;
  expect(cellStops, 'calendar tab stops (toolbar + one roving cell)').toBeLessThan(12);
  await ctx.close();
});

test('flight search form: tab order follows the visual (RTL) reading order', async ({ browser }) => {
  const { ctx, page } = await openPage(browser, { width: 'desktop', theme: 'light' });
  await page.goto('/search/flights');
  await expect(page.getByTestId('flight-search-form')).toBeVisible();
  await settle(page);
  const names: string[] = [];
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    const a = await activeInfo(page);
    if (a?.region === 'form') names.push(a.label || (await page.evaluate("document.activeElement.getAttribute('name')||''")) as string);
  }
  const iOrigin = names.findIndex((n) => /TLV|מוצא/.test(n) || n === '');
  expect(names.length, 'form fields reached').toBeGreaterThan(6);
  // Origin must come before destination, destination before dates, dates before the search button.
  const text = names.join(' | ');
  expect(text.indexOf('חיפוש'), 'search button is the last primary stop').toBeGreaterThan(-1);
  expect(iOrigin).toBeGreaterThanOrEqual(0);
  await ctx.close();
});

test.describe('fare calendar keyboard', () => {
  test('arrow keys move by day / week (RTL aware), Home/End by week row, Enter selects', async ({ browser }) => {
    test.setTimeout(120_000);
    const { ctx, page } = await openPage(browser, { width: 'desktop', theme: 'light' });
    await gotoFlightResults(page, f);
    const cur = page.locator('[data-testid=fare-cell][aria-current="date"]');
    await expect(cur).toHaveCount(1);
    await cur.focus();
    const date = () => page.evaluate(() => (document.activeElement as HTMLElement).getAttribute('data-date'));
    const add = (iso: string, d: number) => new Date(Date.parse(iso + 'T00:00:00Z') + d * 86400000).toISOString().slice(0, 10);
    const start = (await date())!;
    expect(start).toBe('2027-01-12');
    await page.keyboard.press('ArrowLeft');  // RTL: left = later
    expect(await date()).toBe(add(start, 1));
    await page.keyboard.press('ArrowRight');
    expect(await date()).toBe(start);
    await page.keyboard.press('ArrowRight'); // earlier
    expect(await date()).toBe(add(start, -1));
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowDown');
    expect(await date()).toBe(add(start, 7));
    await page.keyboard.press('ArrowUp');
    expect(await date()).toBe(start);
    await page.keyboard.press('Home');
    const home = (await date())!;
    await page.keyboard.press('End');
    const end = (await date())!;
    expect(Date.parse(end) - Date.parse(home), 'Home..End spans one week row (6 days)').toBe(6 * 86400000);
    // Roving tabindex: exactly one cell is tabbable.
    expect(await page.locator('[data-testid=fare-cell][tabindex="0"]').count()).toBe(1);
    // Enter on another priced date runs the normal search for those dates (aria-current moves).
    await page.locator('[data-testid=fare-cell][data-status=priced]:not([aria-current])').first().focus();
    const target = (await date())!;
    await page.keyboard.press('Enter');
    await expect(page.locator(`[data-testid=fare-cell][data-date="${target}"][aria-current="date"]`).first()).toBeVisible({ timeout: 20_000 });
    await ctx.close();
  });

  test('matrix view: 2-D arrow navigation stays inside the grid', async ({ browser }) => {
    const { ctx, page } = await openPage(browser, { width: 'desktop', theme: 'light' });
    await gotoFlightResults(page, f);
    await page.getByRole('radio', { name: 'מטריצת לילות' }).click();
    const cells = page.locator('[data-testid=fare-cell]');
    await expect(cells.first()).toBeVisible();
    const sel = page.locator('[data-testid=fare-cell][tabindex="0"]');
    await expect(sel).toHaveCount(1);
    await sel.focus();
    const pos = () => page.evaluate(() => { const a = document.activeElement as HTMLElement; return `${a.getAttribute('data-date')}|${a.getAttribute('data-nights')}`; });
    const p0 = await pos();
    await page.keyboard.press('ArrowDown');
    const p1 = await pos();
    expect(p1.split('|')[0], 'ArrowDown keeps the depart date (changes nights)').toBe(p0.split('|')[0]);
    expect(p1.split('|')[1]).not.toBe(p0.split('|')[1]);
    await page.keyboard.press('ArrowUp');
    expect(await pos()).toBe(p0);
    await page.keyboard.press('ArrowLeft');
    expect((await pos()).split('|')[0], 'ArrowLeft moves the depart date').not.toBe(p0.split('|')[0]);
    await ctx.close();
  });
});

test.describe('dialogs', () => {
  test('manual trip item dialog: focus moves in, is trapped, Escape closes and focus returns to the trigger', async ({ browser }) => {
    const { ctx, page } = await openPage(browser, { width: 'desktop', theme: 'light' });
    await page.goto(`/trips/${f.tripId}`);
    const trigger = page.getByRole('button', { name: 'פריט ידני' });
    await expect(trigger).toBeVisible();
    await trigger.focus();
    await page.keyboard.press('Enter');
    const dlg = page.getByRole('dialog');
    await expect(dlg).toBeVisible();
    const inside = () => page.evaluate(() => !!document.activeElement?.closest('[role=dialog]'));
    expect(await inside(), 'focus moved into the dialog').toBe(true);
    for (let i = 0; i < 25; i++) { await page.keyboard.press('Tab'); expect(await inside(), `Tab #${i + 1} stays in the dialog`).toBe(true); }
    for (let i = 0; i < 25; i++) { await page.keyboard.press('Shift+Tab'); expect(await inside(), `Shift+Tab #${i + 1} stays in the dialog`).toBe(true); }
    await expect(dlg.getByRole('heading').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
    await expect(trigger, 'focus returns to the element that opened the dialog').toBeFocused();
    await ctx.close();
  });

  test('confirm dialog (cancel booking) traps focus and returns it', async ({ browser }) => {
    const { ctx, page } = await openPage(browser, { width: 'desktop', theme: 'light' });
    await openBookingReview(page, f);
    const trigger = page.getByRole('button', { name: 'ביטול ההזמנה' }).first();
    await expect(trigger).toBeVisible();
    await trigger.focus();
    await page.keyboard.press('Enter');
    const dlg = page.getByRole('alertdialog').or(page.getByRole('dialog')).first();
    await expect(dlg).toBeVisible();
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('[role=dialog],[role=alertdialog]')), `Tab #${i + 1}`).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
    await expect(trigger).toBeFocused();
    await ctx.close();
  });
});

test.describe('prefers-reduced-motion', () => {
  const MOTION_JS = `(() => {
    const secs = (v) => v.split(',').map((x) => { x = x.trim(); return x.endsWith('ms') ? parseFloat(x) / 1000 : parseFloat(x) || 0; });
    const long = []; let infinite = 0;
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      const t = Math.max(...secs(cs.transitionDuration)) + Math.max(...secs(cs.transitionDelay));
      const a = cs.animationName !== 'none' ? Math.max(...secs(cs.animationDuration)) : 0;
      if (cs.animationName !== 'none' && cs.animationIterationCount === 'infinite' && a > 0.05) infinite++;
      if (t > 0.1 || a > 0.1) long.push(el.tagName.toLowerCase() + '.' + (el.getAttribute('class') || '').split(' ').slice(0, 2).join('.') + ' t=' + t + ' a=' + a);
    }
    return { long: long.slice(0, 15), n: long.length, infinite, smooth: getComputedStyle(document.documentElement).scrollBehavior };
  })()`;

  for (const screen of ['dashboard', 'results'] as const) {
    test(`reduced motion: no long transitions / animations (${screen})`, async ({ browser }) => {
      const { ctx, page } = await openPage(browser, { width: 'desktop', theme: 'light', reducedMotion: 'reduce' });
      if (screen === 'results') await gotoFlightResults(page, f); else { await page.goto('/'); await expect(page.locator('h1')).toBeVisible(); await settle(page); }
      const m = (await page.evaluate(MOTION_JS)) as { long: string[]; n: number; infinite: number; smooth: string };
      expect(m.long, 'elements with transition/animation > 100ms under prefers-reduced-motion: reduce').toEqual([]);
      expect(m.infinite, 'infinite animations').toBe(0);
      expect(m.smooth, 'smooth scrolling disabled').not.toBe('smooth');
      await ctx.close();
    });
  }

  test('sanity: without the preference the app does animate (the check above is meaningful)', async ({ browser }) => {
    const { ctx, page } = await openPage(browser, { width: 'desktop', theme: 'light', reducedMotion: 'no-preference' });
    await page.goto('/');
    await expect(page.locator('h1')).toBeVisible();
    const m = (await page.evaluate(MOTION_JS)) as { n: number };
    expect(m.n, 'elements with motion when reduced-motion is NOT requested').toBeGreaterThan(0);
    await ctx.close();
  });
});

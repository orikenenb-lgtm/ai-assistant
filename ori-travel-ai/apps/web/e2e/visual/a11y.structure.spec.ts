/**
 * Accessibility audit, part 1: structure (h1, landmarks, names, labels), RTL, overflow at 390 / 200% zoom / 320.
 * Evidence-based: computed from the DOM (no axe). Known product bugs are encoded with test.fail() + issue id
 * (see docs/release/accessibility-report.md); remove the test.fail once the bug is fixed.
 */
import { expect, test } from '@playwright/test';
import { A11Y_SCREENS } from './a11y-screens';
import { STRUCTURE_JS, type Structure } from './a11y-lib';
import { ensureFixtures, openPage, settle, WIDTHS, type Fixtures, type Theme } from './helpers';

test.beforeEach(({ browserName }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'a11y specs choose their own viewport; run with --project=desktop');
  void browserName;
});

let f: Fixtures;
test.beforeAll(async () => { f = await ensureFixtures(); });

for (const theme of ['light', 'dark'] as Theme[]) {
  for (const width of ['desktop', 'mobile'] as const) {
    test.describe(`structure ${WIDTHS[width]}px ${theme}`, () => {
      for (const s of A11Y_SCREENS) {
        test(`${s.id}: landmarks, names, labels, RTL`, async ({ browser }) => {
          const { ctx, page } = await openPage(browser, { width, theme, anonymous: s.anon });
          try {
            await s.open(page, f);
            const st = (await page.evaluate(STRUCTURE_JS)) as Structure;
            // RTL + language + title.
            expect(st.html, 'html dir/lang').toEqual({ dir: 'rtl', lang: 'he' });
            expect(st.title.trim().length, 'document title').toBeGreaterThan(0);
            // Landmarks: exactly one <main>. (<nav>: not on the bare login / DEMO supplier pages.)
            expect(st.main, 'main landmarks').toBe(1);
            if (!s.anon && s.id !== 'demo-supplier') {
              expect(st.nav, 'nav landmark').toBeGreaterThanOrEqual(1);
              expect(st.header, 'banner/header landmark').toBeGreaterThanOrEqual(1);
            }
            // Exactly one h1 (the DEMO supplier page has none: A11Y-01, asserted separately below).
            if (s.expectH1 !== false) expect(st.h1, 'exactly one h1').toBe(1);
            expect(st.unnamedInteractive, 'interactive elements without an accessible name').toEqual([]);
            expect(st.unlabelledFields, 'form controls without a label').toEqual([]);
            expect(st.imgsWithoutAlt, '<img> without alt').toEqual([]);
            expect(st.duplicateIds, 'duplicate ids').toEqual([]);
            expect(st.headingSkips, 'heading levels skipped (e.g. h1 -> h3)').toBe(0);
            // No horizontal overflow (checked at both widths; DEMO supplier at 390 is A11Y-02).
            if (!(s.id === 'demo-supplier' && width === 'mobile')) {
              expect(st.overflow.sw, `scrollWidth ${st.overflow.sw} <= clientWidth ${st.overflow.cw}`).toBeLessThanOrEqual(st.overflow.cw);
            }
          } finally { await ctx.close(); }
        });
      }
    });
  }
}

test.describe('known product bugs (test.fail = confirmed, reported in docs/release/accessibility-report.md)', () => {
  test('A11Y-01 DEMO supplier page has exactly one h1', async ({ browser }) => {
    test.fail(true, 'A11Y-01: /demo-supplier/checkout renders its title in a <div>, there is no <h1>');
    const { ctx, page } = await openPage(browser, { width: 'desktop', theme: 'light' });
    await page.goto(f.checkoutUrl);
    await expect(page.getByText('דף ספק לדוגמה — DEMO, אין חיוב').first()).toBeVisible();
    await expect(page.locator('h1')).toHaveCount(1);
    await ctx.close();
  });

  test('A11Y-02 DEMO supplier page has no horizontal overflow at 390px', async ({ browser }) => {
    test.fail(true, 'A11Y-02: scrollWidth is 42px wider than the 390px viewport (header text does not wrap)');
    const { ctx, page } = await openPage(browser, { width: 'mobile', theme: 'light' });
    await page.goto(f.checkoutUrl);
    await expect(page.getByText('דף ספק לדוגמה — DEMO, אין חיוב').first()).toBeVisible();
    await settle(page);
    const o = (await page.evaluate('({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })')) as { sw: number; cw: number };
    expect(o.sw).toBeLessThanOrEqual(o.cw);
    await ctx.close();
  });
});

/** Zoom 200% on a 1440 desktop == 720 CSS px viewport; 400% (WCAG 1.4.10 reflow) == 360, and 320 as the narrowest phone. */
for (const vw of [720, 320]) {
  test.describe(`reflow at ${vw}px (${vw === 720 ? '200% zoom' : 'smallest phone'})`, () => {
    for (const s of A11Y_SCREENS) {
      test(`${s.id}: no horizontal scroll, primary action reachable`, async ({ browser }) => {
        test.fail(s.id === 'demo-supplier' && vw === 320, 'A11Y-02: the DEMO supplier header overflows horizontally below ~400px');
        const { ctx, page } = await openPage(browser, { width: vw, theme: 'light', anonymous: s.anon, height: vw === 720 ? 450 : 700 });
        try {
          await s.open(page, f);
          const o = (await page.evaluate('({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })')) as { sw: number; cw: number };
          expect(o.sw, `${s.id} @${vw}: scrollWidth ${o.sw} vs clientWidth ${o.cw}`).toBeLessThanOrEqual(o.cw);
          // Main content visible and non-empty; at least one primary action is reachable by scrolling.
          const main = page.locator('main').first();
          await expect(main).toBeVisible();
          if (s.id === 'flights-form') {
            const btn = page.getByRole('button', { name: 'חיפוש', exact: true });
            await btn.scrollIntoViewIfNeeded();
            await expect(btn).toBeInViewport();
          }
          if (s.id === 'login') {
            const btn = page.getByRole('button', { name: /כניסה/ });
            await btn.scrollIntoViewIfNeeded();
            await expect(btn).toBeInViewport();
          }
        } finally { await ctx.close(); }
      });
    }
  });
}

test.describe('RTL layout', () => {
  test('sidebar on the right, logical alignment, no physical text-align on text', async ({ browser }) => {
    const { ctx, page } = await openPage(browser, { width: 'desktop', theme: 'light' });
    await page.goto('/search/flights');
    await expect(page.getByTestId('flight-search-form')).toBeVisible();
    await settle(page);
    const r = await page.evaluate(() => {
      const nav = document.querySelector('nav')!.getBoundingClientRect();
      const main = document.querySelector('main')!.getBoundingClientRect();
      const physical: string[] = [];
      for (const el of Array.from(document.querySelectorAll('main *'))) {
        if (el.getClientRects().length === 0 || el.closest('svg')) continue;
        const ta = getComputedStyle(el).textAlign;
        if ((ta === 'left' || ta === 'right') && (el.textContent || '').trim()) physical.push(`${el.tagName.toLowerCase()}[${ta}] ${(el.textContent || '').trim().slice(0, 24)}`);
      }
      const h1 = getComputedStyle(document.querySelector('h1')!).textAlign;
      return { navCenter: nav.left + nav.width / 2, mainCenter: main.left + main.width / 2, vw: innerWidth, physical: physical.slice(0, 10), nPhysical: physical.length, h1 };
    });
    expect(r.navCenter, 'primary navigation sits on the right in RTL').toBeGreaterThan(r.vw / 2);
    expect(r.mainCenter).toBeLessThan(r.navCenter);
    expect(['start', 'right'], 'h1 aligned to the start edge (right in RTL)').toContain(r.h1);
    expect(r.physical, 'text elements with a physical left/right text-align (use start/end)').toEqual([]);
    await ctx.close();
  });
});

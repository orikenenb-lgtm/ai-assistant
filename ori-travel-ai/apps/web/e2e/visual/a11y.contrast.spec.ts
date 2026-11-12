/**
 * Accessibility audit, part 2: WCAG text contrast (computed from computed colours of every visible text node,
 * composited over the effective background) and touch-target sizes at 390px.
 * Worst-10 per screen are written to $VIS_WORK_DIR/a11y-contrast/*.json (used for docs/release/accessibility-report.md).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { A11Y_SCREENS } from './a11y-screens';
import { CONTRAST_JS, TOUCH_JS, type ContrastSample, type TouchViolation } from './a11y-lib';
import { ensureFixtures, openPage, WIDTHS, type Fixtures, type Theme } from './helpers';

test.beforeEach(({ browserName }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'a11y specs choose their own viewport; run with --project=desktop');
  void browserName;
});

const OUT = path.join(process.env.VIS_WORK_DIR ?? path.join(os.tmpdir(), 'ori-vis'), 'a11y-contrast');
let f: Fixtures;
test.beforeAll(async () => { f = await ensureFixtures(); fs.mkdirSync(OUT, { recursive: true }); });

/** A11Y-03: dark theme, calendar cells on the "best/low" tangerine fill use text-ink-700 (4.37:1 < 4.5:1). */
// A11Y-03 is fixed (heat-fg tokens): no contrast exceptions remain.
const knownContrast = (_c: ContrastSample, _theme: Theme) => false;

for (const theme of ['light', 'dark'] as Theme[]) {
  for (const width of ['desktop', 'mobile'] as const) {
    test.describe(`contrast ${WIDTHS[width]}px ${theme}`, () => {
      for (const s of A11Y_SCREENS) {
        test(`${s.id}: all visible text meets WCAG AA`, async ({ browser }) => {
          const { ctx, page } = await openPage(browser, { width, theme, anonymous: s.anon });
          try {
            await s.open(page, f);
            const all = (await page.evaluate(CONTRAST_JS)) as ContrastSample[];
            const fails = all.filter((c) => c.ratio < c.required);
            fs.writeFileSync(path.join(OUT, `${s.id}-${WIDTHS[width]}-${theme}.json`), JSON.stringify({ samples: all.length, failures: fails.length, worst10: all.slice(0, 10) }, null, 1));
            expect(all.length, 'text samples').toBeGreaterThan(5);
            const unexpected = fails.filter((c) => !knownContrast(c, theme));
            expect(unexpected, `text below WCAG AA (${s.id} ${theme})`).toEqual([]);
          } finally { await ctx.close(); }
        });
      }
    });
  }
}

test('A11Y-03 dark theme: fare-calendar day numbers on tangerine cells reach 4.5:1', async ({ browser }) => {
  const { ctx, page } = await openPage(browser, { width: 'desktop', theme: 'dark' });
  await A11Y_SCREENS.find((s) => s.id === 'flights-results')!.open(page, f);
  const all = (await page.evaluate(CONTRAST_JS)) as ContrastSample[];
  expect(all.filter((c) => c.ratio < c.required && c.selector.includes('fare-cell'))).toEqual([]);
  await ctx.close();
});

/* ---------------------------------------------------------------- touch targets @390 */

/** A11Y-05 is fixed: no exceptions remain. Any element below 44x44 at 390px (touch) is a regression. */
const KNOWN_TOUCH: Array<RegExp> = [];

const touchResults: Record<string, TouchViolation[]> = {};

for (const theme of ['light', 'dark'] as Theme[]) {
  test.describe(`touch targets 390px ${theme}`, () => {
    for (const s of A11Y_SCREENS) {
      test(`${s.id}: interactive elements >= 44x44 (known exceptions listed)`, async ({ browser }) => {
        const { ctx, page } = await openPage(browser, { width: 'mobile', theme, anonymous: s.anon });
        try {
          await s.open(page, f);
          expect(await page.evaluate("matchMedia('(pointer: coarse)').matches"), 'touch emulation active').toBe(true);
          const v = (await page.evaluate(TOUCH_JS)) as TouchViolation[];
          touchResults[`${s.id}-${theme}`] = v;
          fs.writeFileSync(path.join(OUT, `touch-${s.id}-390-${theme}.json`), JSON.stringify(v, null, 1));
          const unexpected = v.filter((x) => !KNOWN_TOUCH.some((re) => re.test(`${x.text}`) || re.test(x.selector)));
          expect(unexpected, 'NEW touch-target violations (< 44x44 CSS px)').toEqual([]);
        } finally { await ctx.close(); }
      });
    }
  });
}

test('A11Y-05 every interactive element is at least 44x44 CSS px at 390px (settings page sample)', async ({ browser }) => {
  const { ctx, page } = await openPage(browser, { width: 'mobile', theme: 'light' });
  await A11Y_SCREENS.find((s) => s.id === 'settings')!.open(page, f);
  const v = (await page.evaluate(TOUCH_JS)) as TouchViolation[];
  expect(v).toEqual([]);
  await ctx.close();
});

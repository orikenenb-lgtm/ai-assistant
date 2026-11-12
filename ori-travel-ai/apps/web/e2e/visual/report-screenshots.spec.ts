/**
 * Curated screenshots for the owner's report -> docs/release/screenshots/NN-<screen>-<width>-<theme>.png
 * Not part of the regular run (writes files into docs/): VIS_REPORT=1 npx playwright test e2e/visual/report-screenshots.spec.ts --project=desktop
 * Same frozen clock + fixed dates as the baselines, but NO masks (clean images for people).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { ensureFixtures, gotoFlightResults, NO_MOTION_CSS, openBookingReview, openPage, settle, type Fixtures, type Theme, type Width } from './helpers';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../docs/release/screenshots');

test.beforeEach(({ browserName }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop' || !process.env.VIS_REPORT, 'set VIS_REPORT=1 and run with --project=desktop');
  void browserName;
});

interface Shot { n: string; screen: string; width: Width; theme: Theme; run: (p: Page, f: Fixtures) => Promise<Locator | null> }
const px = (w: Width) => (w === 'desktop' ? 1440 : 390);

const shots: Shot[] = [
  { n: '01', screen: 'flights-calendar-month', width: 'desktop', theme: 'light', run: async (p, f) => { await gotoFlightResults(p, f); return p.getByTestId('fare-calendar'); } },
  { n: '02', screen: 'flights-calendar-matrix', width: 'desktop', theme: 'light', run: async (p, f) => { await gotoFlightResults(p, f); await p.getByRole('radio', { name: 'מטריצת לילות' }).click(); await expect(p.getByTestId('fare-cell').first()).toBeVisible(); await settle(p); return p.getByTestId('fare-calendar'); } },
  { n: '03', screen: 'flights-featured-deal', width: 'desktop', theme: 'light', run: async (p, f) => { await gotoFlightResults(p, f); return p.getByTestId('featured-deal'); } },
  { n: '04', screen: 'flights-results-table', width: 'desktop', theme: 'light', run: async (p, f) => { await gotoFlightResults(p, f); await p.getByRole('group', { name: 'תצוגת התוצאות' }).getByRole('button', { name: 'טבלה' }).click(); return p.getByTestId('results-table'); } },
  { n: '05', screen: 'flights-route-map', width: 'desktop', theme: 'light', run: async (p, f) => { await gotoFlightResults(p, f); return p.getByTestId('route-map'); } },
  { n: '06', screen: 'flights-form', width: 'desktop', theme: 'light', run: async (p) => { await p.goto('/search/flights'); await expect(p.getByTestId('flight-search-form')).toBeVisible(); return null; } },
  { n: '07', screen: 'dashboard', width: 'desktop', theme: 'light', run: async (p) => { await p.goto('/'); await expect(p.locator('h1')).toBeVisible(); return null; } },
  { n: '08', screen: 'trip-detail', width: 'desktop', theme: 'light', run: async (p, f) => { await p.goto(`/trips/${f.tripId}`); await expect(p.getByTestId('overlap-badge').first()).toBeVisible(); return null; } },
  { n: '09', screen: 'booking-review', width: 'desktop', theme: 'light', run: async (p, f) => { await openBookingReview(p, f); return null; } },
  { n: '10', screen: 'demo-supplier', width: 'desktop', theme: 'light', run: async (p, f) => { await p.goto(f.checkoutUrl); await expect(p.getByText('דף ספק לדוגמה — DEMO, אין חיוב').first()).toBeVisible(); return null; } },
  { n: '11', screen: 'flights-calendar-month', width: 'mobile', theme: 'light', run: async (p, f) => { await gotoFlightResults(p, f); return p.getByTestId('fare-calendar'); } },
  { n: '12', screen: 'flights-featured-deal', width: 'mobile', theme: 'light', run: async (p, f) => { await gotoFlightResults(p, f); return p.getByTestId('featured-deal'); } },
  { n: '13', screen: 'flights-results-list', width: 'mobile', theme: 'light', run: async (p, f) => { await gotoFlightResults(p, f); return p.getByTestId('offer-card').first(); } },
  { n: '14', screen: 'trip-detail', width: 'mobile', theme: 'light', run: async (p, f) => { await p.goto(`/trips/${f.tripId}`); await expect(p.getByTestId('overlap-badge').first()).toBeVisible(); return null; } },
  { n: '15', screen: 'flights-calendar-month', width: 'desktop', theme: 'dark', run: async (p, f) => { await gotoFlightResults(p, f); return p.getByTestId('fare-calendar'); } },
  { n: '16', screen: 'flights-featured-deal', width: 'mobile', theme: 'dark', run: async (p, f) => { await gotoFlightResults(p, f); return p.getByTestId('featured-deal'); } },
];

test.describe.configure({ mode: 'parallel' });
for (const s of shots) {
  test(`${s.n}-${s.screen}-${px(s.width)}-${s.theme}`, async ({ browser }) => {
    const f = await ensureFixtures();
    const { ctx, page } = await openPage(browser, { width: s.width, theme: s.theme });
    try {
      const target = await s.run(page, f);
      await page.addStyleTag({ content: NO_MOTION_CSS });
      if (target) await page.addStyleTag({ content: 'header, .sticky, .fixed { position: static !important; }' });
      await settle(page);
      fs.mkdirSync(OUT, { recursive: true });
      const file = path.join(OUT, `${s.n}-${s.screen}-${px(s.width)}-${s.theme}.png`);
      if (target) await target.screenshot({ path: file, animations: 'disabled' });
      else await page.screenshot({ path: file, animations: 'disabled', fullPage: s.screen !== 'dashboard' && s.width === 'mobile' ? true : false });
    } finally { await ctx.close(); }
  });
}

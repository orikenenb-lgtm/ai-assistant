/**
 * Visual regression baselines (agent VIS-A11Y). Key screens x {1440, 390} x {light, dark}.
 *
 * Determinism: frozen clock (page.clock.setFixedTime), fixed future search dates (helpers.ts), reduced motion +
 * animation-killing CSS, fonts awaited, dynamic text (freshness / timestamps / refs) masked.
 * Baselines: e2e/visual/visual.spec.ts-snapshots/*.png. Update: see docs/release/visual-qa.md
 *   npx playwright test e2e/visual/visual.spec.ts --project=desktop --update-snapshots
 * The specs drive their own viewport/colour scheme, so only the "desktop" project runs them.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { ensureFixtures, gotoFlightResults, NO_MOTION_CSS, openBookingReview, openPage, settle, WIDTHS, type Fixtures, type Theme, type Width } from './helpers';

test.beforeEach(({ browserName }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'visual specs choose their own viewport; run with --project=desktop');
  void browserName;
});

const MASK_RE = /(לפני\s+\S+(\s+\S+)?|עודכן|נבדק[ה]?\s|נוצר|נוצרה|התחברות אחרונה|תוקף|DEMO-[A-Z0-9]{6,}|\b[0-9a-f]{16,}\b|\d{1,2}:\d{2}:\d{2}|\d{4},?\s+\d{1,2}:\d{2})/;

/** Marks the smallest elements whose own text looks dynamic, so Playwright can mask them. */
async function markDynamic(page: Page) {
  await page.evaluate((src) => {
    const re = new RegExp(src);
    document.querySelectorAll('[data-vis-mask]').forEach((e) => e.removeAttribute('data-vis-mask'));
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = walker.nextNode())) {
      const t = n.textContent ?? '';
      const p = n.parentElement;
      if (p && re.test(t) && !['SCRIPT', 'STYLE'].includes(p.tagName)) p.setAttribute('data-vis-mask', '1');
    }
  }, MASK_RE.source);
}

async function shot(page: Page, name: string, target?: Locator | null, extraMask: Locator[] = []) {
  await page.addStyleTag({ content: NO_MOTION_CSS });
  await settle(page);
  await markDynamic(page);
  const opts = {
    animations: 'disabled' as const,
    caret: 'hide' as const,
    mask: [page.locator('[data-vis-mask]'), ...extraMask],
    maskColor: '#ff00ff',
    maxDiffPixelRatio: 0.002,
    scale: 'css' as const,
  };
  if (target) await expect(target).toHaveScreenshot(name, opts);
  else await expect(page).toHaveScreenshot(name, { ...opts, fullPage: true });
}

interface Screen {
  id: string;
  anon?: boolean;
  /** Navigate + prepare; returns the element to capture (or null for the full page). */
  run: (page: Page, f: Fixtures, ctx: { width: Width }) => Promise<Locator | null>;
  skip?: (w: Width) => boolean;
}

const screens: Screen[] = [
  {
    id: 'login',
    anon: true,
    run: async (page) => {
      await page.goto('/login');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      return null;
    },
  },
  {
    id: 'dashboard',
    run: async (page) => {
      await page.goto('/');
      await expect(page.locator('h1')).toBeVisible();
      return null;
    },
  },
  {
    id: 'flights-form',
    run: async (page) => {
      await page.goto('/search/flights');
      await expect(page.getByTestId('flight-search-form')).toBeVisible();
      return null;
    },
  },
  {
    id: 'flights-calendar-month',
    run: async (page, f) => {
      await gotoFlightResults(page, f);
      return page.getByTestId('fare-calendar');
    },
  },
  {
    id: 'flights-calendar-matrix',
    run: async (page, f) => {
      await gotoFlightResults(page, f);
      await page.getByRole('radio', { name: 'מטריצת לילות' }).click();
      await expect(page.getByTestId('fare-cell').first()).toBeVisible();
      await settle(page);
      return page.getByTestId('fare-calendar');
    },
  },
  {
    id: 'flights-featured-deal',
    run: async (page, f) => {
      await gotoFlightResults(page, f);
      return page.getByTestId('featured-deal');
    },
  },
  {
    id: 'flights-route-map',
    run: async (page, f) => {
      await gotoFlightResults(page, f);
      const map = page.getByTestId('route-map');
      await expect(map).toBeVisible();
      return map;
    },
  },
  {
    id: 'flights-results-list',
    run: async (page, f) => {
      await gotoFlightResults(page, f);
      return page.getByTestId('offer-card').first();
    },
  },
  {
    id: 'flights-results-table',
    skip: (w) => w === 'mobile', // the table toggle is desktop-only (cards on mobile)
    run: async (page, f) => {
      await gotoFlightResults(page, f);
      await page.getByRole('group', { name: 'תצוגת התוצאות' }).getByRole('button', { name: 'טבלה' }).click();
      const table = page.getByTestId('results-table');
      await expect(table).toBeVisible();
      return table;
    },
  },
  {
    id: 'hotels-results',
    run: async (page, f) => {
      await page.goto(`/search/hotels?search_id=${f.hotelSearchId}`);
      await expect(page.getByTestId('search-results')).toBeVisible();
      await expect(page.getByTestId('offer-card').first()).toBeVisible();
      return page.getByTestId('offer-card').first();
    },
  },
  {
    id: 'trip-detail',
    run: async (page, f) => {
      await page.goto(`/trips/${f.tripId}`);
      await expect(page.locator('h1')).toBeVisible();
      await expect(page.getByTestId('overlap-badge').first()).toBeVisible();
      return null;
    },
  },
  {
    id: 'booking-review',
    run: async (page, f) => {
      await openBookingReview(page, f);
      return null;
    },
  },
  {
    id: 'demo-supplier',
    run: async (page, f) => {
      expect(f.checkoutUrl, 'fixture must provide a DEMO supplier checkout url').toBeTruthy();
      await page.goto(f.checkoutUrl);
      // NOTE: this page has no <h1> / <main> (a11y finding A11Y-01), so wait on its visible text.
      await expect(page.getByText('דף ספק לדוגמה — DEMO, אין חיוב').first()).toBeVisible();
      return null;
    },
  },
  {
    id: 'family',
    run: async (page) => {
      await page.goto('/family');
      await expect(page.locator('h1')).toBeVisible();
      return null;
    },
  },
  {
    id: 'settings',
    run: async (page) => {
      await page.goto('/settings');
      await expect(page.locator('h1')).toBeVisible();
      return null;
    },
  },
];

for (const theme of ['light', 'dark'] as Theme[]) {
  for (const width of ['desktop', 'mobile'] as Width[]) {
    test.describe(`${WIDTHS[width]}px ${theme}`, () => {
      let f: Fixtures;
      test.beforeAll(async () => {
        f = await ensureFixtures();
      });
      for (const s of screens) {
        if (s.skip?.(width)) continue;
        test(s.id, async ({ browser }) => {
          const { ctx, page } = await openPage(browser, { width, theme, anonymous: s.anon });
          try {
            const target = await s.run(page, f, { width });
            await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
            await shot(page, `${s.id}-${WIDTHS[width]}-${theme}.png`, target);
          } finally {
            await ctx.close();
          }
        });
      }
    });
  }
}

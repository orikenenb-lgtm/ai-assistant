/**
 * Shared helpers for the visual-regression + accessibility specs (agent VIS-A11Y).
 * Self-contained: own login, own contexts (explicit viewport / colour scheme), deterministic fixtures.
 * Target: VIS_BASE_URL (default http://127.0.0.1:8082 = FastAPI serving a fresh build, see docs/release/visual-qa.md).
 */
import { expect, request as pwRequest, type Browser, type BrowserContext, type Page, type APIRequestContext } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const BASE = process.env.VIS_BASE_URL ?? 'http://127.0.0.1:8082';
export const EMAIL = process.env.VIS_OWNER_EMAIL ?? 'owner@vis.local';
export const PASSWORD = process.env.VIS_OWNER_PASSWORD ?? 'Vis-Owner-Pass-123';
const WORK = process.env.VIS_WORK_DIR ?? path.join(os.tmpdir(), 'ori-vis');

/** Frozen "now" (Asia/Jerusalem) -> default form dates, relative-time labels and month grids are stable. */
export const FROZEN_NOW = '2026-11-12T10:00:00+02:00';
/** Fixed future search dates (far enough from FROZEN_NOW to be valid; DEMO prices are deterministic per query). */
export const DEPART = '2027-01-12';
export const RETURN = '2027-01-17';

export type Theme = 'light' | 'dark';
export const WIDTHS = { desktop: 1440, mobile: 390 } as const;
export type Width = keyof typeof WIDTHS;

/* ------------------------------------------------------------------ session + fixtures */

async function loginState(): Promise<string> {
  fs.mkdirSync(WORK, { recursive: true });
  const file = path.join(WORK, 'state.json');
  if (fs.existsSync(file)) {
    const probe = await pwRequest.newContext({ baseURL: BASE, storageState: file });
    const ok = (await probe.get('/api/auth/me')).ok();
    await probe.dispose();
    if (ok) return file;
  }
  const ctx = await pwRequest.newContext({ baseURL: BASE });
  const res = await ctx.post('/api/auth/login', { data: { email: EMAIL, password: PASSWORD } });
  if (!res.ok()) throw new Error(`VIS login failed (${res.status()}): ${await res.text()}`);
  await ctx.storageState({ path: file });
  await ctx.dispose();
  return file;
}

async function csrf(api: APIRequestContext): Promise<Record<string, string>> {
  const st = await api.storageState();
  return { 'X-CSRF-Token': st.cookies.find((c) => c.name === 'ori_csrf')?.value ?? '' };
}

async function post(api: APIRequestContext, url: string, data: unknown = {}) {
  const res = await api.post(url, { data, headers: await csrf(api) });
  if (!res.ok()) throw new Error(`POST ${url} -> ${res.status()}: ${await res.text()}`);
  return res.json();
}

export interface Fixtures {
  searchId: string;
  hotelSearchId: string;
  tripId: string;
  bookingId: string;
  checkoutUrl: string;
  createdAt: number;
}

/** Created once and reused for 20 minutes (search offers live 30 min) so repeated runs see the same data. */
export async function ensureFixtures(): Promise<Fixtures> {
  const state = await loginState();
  const file = path.join(WORK, 'fixtures.json');
  if (fs.existsSync(file)) {
    const f = JSON.parse(fs.readFileSync(file, 'utf8')) as Fixtures;
    if (Date.now() - f.createdAt < 20 * 60_000) return f;
  }
  const api = await pwRequest.newContext({ baseURL: BASE, storageState: state });
  const flight = await post(api, '/api/search/flight', {
    origin: 'TLV', destination: 'ATH', depart_date: DEPART, return_date: RETURN, flex_days: 0, adults: 2,
    children_ages: [], cabin: 'economy', max_stops: null, checked_bags: 0, preferred_departure_window: 'any', currency: 'ILS', max_price: null,
  });
  const hotel = await post(api, '/api/search/hotel', {
    destination: 'Athens', check_in: DEPART, check_out: '2027-01-15', rooms: [{ adults: 2, children_ages: [] }], currency: 'ILS',
  });
  const activity = await post(api, '/api/search/activity', {
    destination: 'Athens', date_from: DEPART, date_to: '2027-01-15', interests: [], adults: 2, children_ages: [8], currency: 'ILS',
  });
  const members = await (await api.get('/api/family/members')).json();
  const adults = members.filter((m: { age_group: string }) => m.age_group === 'adult').slice(0, 2).map((m: { id: string }) => m.id);
  const child = members.find((m: { age_group: string }) => m.age_group === 'child')?.id as string;

  // Trip: flight (from offer) + overlapping hotel item => timeline, budget and the overlap badge.
  const trip = await post(api, '/api/trips', {
    title: 'אתונה בינואר (בדיקת ויזואל)', destination: 'Athens', start_date: DEPART, end_date: RETURN,
    budget: { amount: '9000', currency: 'ILS' }, traveler_ids: [],
  });
  await post(api, `/api/trips/${trip.id}/items/from-offer`, { offer_id: flight.offers[0].id });
  const mk = (title: string, kind: string, s: string, e: string, amount: string) =>
    post(api, `/api/trips/${trip.id}/items`, {
      kind, title, start_at: s, end_at: e, timezone: 'Europe/Athens', location: 'Athens',
      cost: { amount, currency: 'ILS' }, cost_status: 'estimate', allow_overlap: true,
    });
  await mk('מלון פלאקה', 'hotel', '2027-01-12T15:00:00+02:00', '2027-01-15T11:00:00+02:00', '1800');
  await mk('מלון נוסף (חופף)', 'hotel', '2027-01-13T15:00:00+02:00', '2027-01-16T11:00:00+02:00', '1500');
  await mk('סיור באקרופוליס', 'activity', '2027-01-14T10:00:00+02:00', '2027-01-14T13:00:00+02:00', '400');

  // Booking in "ready for approval" (revalidated).
  const booking = await post(api, '/api/bookings', {
    offer_id: flight.offers[0].id, traveler_member_ids: adults, simulation_scenario: 'success',
  });
  await post(api, `/api/bookings/${booking.id}/revalidate`);

  // Hosted-checkout (DEMO supplier) booking on an activity offer -> approved -> checkout link.
  let checkoutUrl = '';
  for (const offer of activity.offers.filter((o: { source: { provider_id?: string } }) => /kidventures/.test(JSON.stringify(o.source))).slice(0, 3)) {
    try {
      const b = await post(api, '/api/bookings', { offer_id: offer.id, traveler_member_ids: [...adults, child], execution_mode: 'HOSTED_CHECKOUT' });
      const r = await post(api, `/api/bookings/${b.id}/revalidate`);
      await post(api, `/api/bookings/${b.id}/approve`, { terms_hash: r.terms_hash, password: PASSWORD, confirm: true });
      const link = await post(api, `/api/bookings/${b.id}/checkout-link`);
      checkoutUrl = link.url ?? link.checkout_url ?? link.hosted_checkout_url ?? '';
      if (checkoutUrl) break;
    } catch (_e) {
      console.warn("hosted checkout fixture attempt failed:", String(_e).slice(0, 300));
    }
  }
  await api.dispose();
  const f: Fixtures = { searchId: flight.search_id, hotelSearchId: hotel.search_id, tripId: trip.id, bookingId: booking.id, checkoutUrl, createdAt: Date.now() };
  fs.writeFileSync(file, JSON.stringify(f));
  return f;
}

/* ------------------------------------------------------------------ contexts + pages */

export interface OpenOpts {
  width: Width | number;
  theme: Theme;
  anonymous?: boolean;
  height?: number;
  reducedMotion?: 'reduce' | 'no-preference';
  /** 'frozen' (default) = FROZEN_NOW; 'real' = the current time (report screenshots: relative times read naturally). */
  clock?: 'frozen' | 'real';
}

export async function openContext(browser: Browser, o: OpenOpts): Promise<BrowserContext> {
  const w = typeof o.width === 'number' ? o.width : WIDTHS[o.width];
  const mobile = w <= 480;
  const ctx = await browser.newContext({
    baseURL: BASE,
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    viewport: { width: w, height: o.height ?? (mobile ? 844 : 900) },
    deviceScaleFactor: 1,
    isMobile: mobile,
    hasTouch: mobile,
    colorScheme: o.theme,
    reducedMotion: o.reducedMotion ?? 'reduce',
    storageState: o.anonymous ? undefined : await loginState(),
  });
  // Theme pinned explicitly (stored preference) in addition to prefers-color-scheme.
  await ctx.addInitScript((theme) => {
    try { window.localStorage.setItem('ori.theme', theme); } catch { /* storage blocked */ }
  }, o.theme);
  return ctx;
}

/**
 * The fare-calendar endpoint is rate limited (10 / 10 min / user), far below what a screenshot matrix needs.
 * The first request per distinct body goes to the real API; its (successful) response is cached on disk and
 * replayed afterwards. This also freezes the calendar data, which keeps the baselines stable.
 */
async function cacheCalendar(ctx: BrowserContext) {
  const file = path.join(WORK, 'calendar-cache.json');
  await ctx.route('**/api/search/flight/calendar', async (route) => {
    const body = route.request().postData() ?? '';
    let cache: Record<string, string> = {};
    try { cache = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first run */ }
    if (cache[body]) return route.fulfill({ status: 200, contentType: 'application/json', body: cache[body] });
    const res = await route.fetch();
    if (res.ok()) {
      cache[body] = await res.text();
      fs.mkdirSync(WORK, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(cache));
    }
    return route.fulfill({ response: res });
  });
}

export async function openPage(browser: Browser, o: OpenOpts): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await openContext(browser, o);
  await cacheCalendar(ctx);
  const page = await ctx.newPage();
  await page.clock.setFixedTime(o.clock === 'real' ? new Date() : FROZEN_NOW);
  return { ctx, page };
}

/** Wait until fonts are loaded, the network is idle and layout has settled. */
export async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready.then(() => true));
  await page.waitForTimeout(250);
}

/** Opens the results page of the fixed search and waits for calendar + results. */
export async function gotoFlightResults(page: Page, f: Fixtures) {
  await page.goto(`/search/flights?search_id=${f.searchId}`);
  await expect(page.getByTestId('search-results')).toBeVisible();
  await expect(page.getByTestId('fare-calendar')).toBeVisible();
  await expect(page.getByTestId('fare-cell').first()).toBeVisible();
  await expect(page.getByTestId('featured-deal')).toBeVisible();
  await settle(page);
}

/** CSS that disables animation/transition/caret everywhere (belt and braces next to reducedMotion). */
export const NO_MOTION_CSS = `*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}`;

/**
 * The booking review only shows the "אישור התנאים" step while the last price check is fresh (a few minutes), so the
 * fixture booking is re-validated right before it is opened. Keeps the screen in the same state on every run.
 */
export async function openBookingReview(page: Page, f: Fixtures) {
  const cookies = await page.context().cookies();
  const token = cookies.find((c) => c.name === 'ori_csrf')?.value ?? '';
  const res = await page.request.post(`/api/bookings/${f.bookingId}/revalidate`, { data: {}, headers: { 'X-CSRF-Token': token } });
  expect(res.ok(), `revalidate booking: ${res.status()}`).toBe(true);
  await page.goto(`/bookings/${f.bookingId}`);
  await expect(page.getByRole('heading', { level: 1, name: 'סקירת הזמנה' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'אישור התנאים' })).toBeVisible();
}

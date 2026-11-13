import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import type { Api, Json } from './api';
import { futureDate } from './env';
import { openRankPanel } from './search-common';

export const isMobile = (testInfo: TestInfo) => testInfo.project.name === 'mobile';

/** Random day offset (30..270) so repeated runs never hit identical, cached searches. */
export function rnd(min = 30, spread = 240): number {
  return min + Math.floor(Math.random() * spread);
}

/** `data-amount` of the first MoneyText inside `scope`, as a number (display-free: no locale parsing). */
export async function amountIn(scope: Locator): Promise<number> {
  const raw = await scope.locator('[data-amount]').first().getAttribute('data-amount');
  if (raw === null) throw new Error('no [data-amount] inside the locator');
  return Number(raw);
}

export async function currencyIn(scope: Locator): Promise<string> {
  return (await scope.locator('[data-currency]').first().getAttribute('data-currency')) ?? '';
}

export interface FlightQuery {
  origin?: string;
  destination: string;
  depart: number; // days from today
  nights?: number | null; // null => one way
  adults?: number;
  children?: number[];
}

/** Flight search through the API (fast, deterministic); the UI then opens it by `?search_id=`. */
export function apiFlightSearch(api: Api, q: FlightQuery): Promise<Json> {
  const nights = q.nights === undefined ? 7 : q.nights;
  return api.search('flight', {
    origin: q.origin ?? 'TLV',
    destination: q.destination,
    depart_date: futureDate(q.depart),
    return_date: nights === null ? null : futureDate(q.depart + nights),
    flex_days: 0,
    adults: q.adults ?? 2,
    children_ages: q.children ?? [],
    cabin: 'economy',
    checked_bags: 0,
    preferred_departure_window: 'any',
    currency: 'ILS',
    max_stops: null,
  });
}

/** Fills and submits the flight search form the way a person would. */
export async function searchFlightsInUi(page: Page, opts: { destination: string; depart: number; nights?: number }): Promise<void> {
  await page.getByRole('combobox', { name: 'יעד' }).fill(opts.destination);
  await page.getByRole('option', { name: new RegExp(opts.destination) }).first().click();
  await page.getByLabel('תאריך יציאה').fill(futureDate(opts.depart));
  await page.getByLabel('תאריך חזרה').fill(futureDate(opts.depart + (opts.nights ?? 7)));
  await page.getByRole('button', { name: 'חיפוש', exact: true }).click();
  await expect(page).toHaveURL(/[?&]search_id=[0-9a-f]+/);
}

export const searchIdOf = (url: string): string => /[?&]search_id=([0-9a-f]+)/.exec(url)?.[1] ?? '';

/** Container with the quick filters: the sidebar (desktop list view) or the drawer (mobile). */
export async function openFilters(page: Page, mobile: boolean): Promise<Locator> {
  return openRankPanel(page, mobile);
}

export async function closeFilters(page: Page, mobile: boolean): Promise<void> {
  if (!mobile) return;
  await page.getByRole('button', { name: /^הצגת \d+ הצעות/ }).click();
  await expect(page.getByRole('dialog', { name: 'דירוג וסינון' })).toBeHidden();
}

/** ids of the offer cards currently rendered (list view). */
export async function visibleCardIds(page: Page): Promise<string[]> {
  const cards = page.locator('[data-testid="offer-card"]');
  const n = await cards.count();
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push((await cards.nth(i).getAttribute('data-offer-id')) ?? '');
  return ids;
}

/** Every `Money` string / number the page shows as a price, as `data-amount` numbers. */
export async function allAmounts(scope: Locator): Promise<number[]> {
  const raws = await scope.locator('[data-amount]').evaluateAll((els) => els.map((e) => e.getAttribute('data-amount') ?? ''));
  return raws.filter(Boolean).map(Number);
}

export function offerById(search: Json, id: string): Json {
  const o = (search.offers as Json[]).find((x) => x.id === id);
  if (!o) throw new Error(`offer ${id} is not part of search ${search.search_id}`);
  return o;
}

/**
 * Live-TYPE providers (Duffel, Amadeus ...) carry a "חי" type badge even while they are not connected. That is fine --
 * as long as the same list item / card says "לא מחובר" and never reports a healthy, answering live source.
 */
export async function expectLiveBadgesNotConnected(scope: Locator, container = 'li'): Promise<void> {
  const texts = await scope.locator('[data-mode="LIVE"]').evaluateAll(
    (els, sel) => els.map((e) => (e.closest(sel)?.textContent ?? '').replace(/\s+/g, ' ')),
    container,
  );
  for (const t of texts) {
    expect(t, `a LIVE-labelled provider must read "לא מחובר": ${t.slice(0, 120)}`).toContain('לא מחובר');
    expect(t).not.toMatch(/מצב ספק:\s*(תקין|חי)/);
  }
}

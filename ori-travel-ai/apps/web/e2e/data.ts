import type { Api } from './api';
import { futureDate } from './env';

/** Random day offset so repeated runs do not hit identical (cached) searches or already-saved offers. */
export function randomDays(min = 20, spread = 300): number {
  return min + Math.floor(Math.random() * spread);
}

export interface SearchData {
  status: string;
  search_id: string;
  category: string;
  offers: Array<{ id: string; title: string; price: { total: { amount: string; currency: string } }; source: { mode: string } }>;
}

export function flightSearch(api: Api, opts: { depart?: number; nights?: number | null; adults?: number } = {}): Promise<SearchData> {
  const depart = opts.depart ?? randomDays();
  const nights = opts.nights === undefined ? 7 : opts.nights;
  return api.search('flight', {
    origin: 'TLV',
    destination: 'ATH',
    depart_date: futureDate(depart),
    return_date: nights === null ? null : futureDate(depart + nights),
    flex_days: 0,
    adults: opts.adults ?? 1,
    children_ages: [],
    cabin: 'economy',
    checked_bags: 0,
    preferred_departure_window: 'any',
    currency: 'ILS',
    max_price: null,
    max_stops: null,
  });
}

export function hotelSearch(api: Api, depart = randomDays(), destination = 'Athens'): Promise<SearchData> {
  return api.search('hotel', {
    destination,
    check_in: futureDate(depart),
    check_out: futureDate(depart + 3),
    rooms: [{ adults: 2, children_ages: [] }],
    currency: 'ILS',
  });
}

export function activitySearch(api: Api, depart = randomDays()): Promise<SearchData> {
  return api.search('activity', {
    destination: 'Athens',
    date_from: futureDate(depart),
    date_to: futureDate(depart + 3),
    interests: [],
    adults: 2,
    children_ages: [],
    currency: 'ILS',
  });
}

/** `1,234.50` formatting used by the UI (he-IL grouping with 2 decimals). */
export function money(amount: string): string {
  return Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

let cached: { at: number; data: SearchData } | undefined;

/**
 * One flight search shared by the specs that only need "some DEMO offers" (compare, trip, saved, a11y, booking ...).
 * Searches are rate limited (30 per 10 min per user), so the suite spends them sparingly. Offers expire after 30 minutes,
 * hence the 12 minute memo. Do not mutate the returned offers; pick distinct offer indexes for state-changing tests.
 */
export async function sharedFlightSearch(api: Api): Promise<SearchData> {
  if (!cached || Date.now() - cached.at > 12 * 60_000) {
    cached = { at: Date.now(), data: await flightSearch(api, { adults: 1, nights: 5 }) };
  }
  return cached.data;
}

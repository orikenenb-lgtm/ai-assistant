/** Pure helpers for the year scan page (colours, month rows, dates, savings, external check link). */
import type { FareCalendarResponse, FareCell } from '@/lib/schemas/calendar';

/**
 * Year heatmap palette by price RANK (quintiles): cheapest fifth = deep sky … most expensive fifth = red. Ranks give an
 * even spread of colours whatever the price distribution; discrete steps avoid muddy blue/yellow blends.
 */
export const HEAT_STEPS = ['#4dabf7', '#a5d8ff', '#ffd43b', '#ffa94d', '#f03e3e'] as const;

/** Colour for a rank fraction `t` in [0, 1] (0 = cheapest). */
export function heatColor(t: number): string {
  const i = Math.min(HEAT_STEPS.length - 1, Math.max(0, Math.floor(t * HEAT_STEPS.length)));
  return HEAT_STEPS[i];
}

/** amount → rank fraction in [0, 1] among the given amounts (equal amounts share the lowest rank). */
export function rankFractions(amounts: readonly number[]): Map<number, number> {
  const sorted = [...new Set(amounts)].sort((a, b) => a - b);
  const out = new Map<number, number>();
  const n = sorted.length;
  sorted.forEach((a, i) => out.set(a, n > 1 ? i / (n - 1) : 0));
  return out;
}

export interface MonthRow {
  /** "2026-12" */
  key: string;
  /** "דצמבר 2026" */
  label: string;
  /** Index = day of month - 1; `undefined` = the date is outside the scanned range or does not exist. */
  days: Array<FareCell | undefined>;
}

const MONTH_LABEL = new Intl.DateTimeFormat('he-IL', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const WEEKDAY = new Intl.DateTimeFormat('he-IL', {
  weekday: 'long',
  timeZone: 'UTC',
});
const LONG_DATE = new Intl.DateTimeFormat('he-IL', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});

function utc(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`);
}

/** Cells grouped into calendar months (rows) × day of month (columns), in date order. */
export function monthRows(cells: readonly FareCell[]): MonthRow[] {
  const rows = new Map<string, MonthRow>();
  for (const cell of cells) {
    const key = cell.depart_date.slice(0, 7);
    let row = rows.get(key);
    if (!row) {
      row = {
        key,
        label: MONTH_LABEL.format(utc(`${key}-01`)),
        days: Array.from({ length: 31 }, () => undefined),
      };
      rows.set(key, row);
    }
    row.days[Number(cell.depart_date.slice(8, 10)) - 1] = cell;
  }
  return [...rows.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** "חמישי 18.2" (weekday without "יום", day.month). */
export function weekdayDayMonth(iso: string): string {
  const d = utc(iso);
  return `${WEEKDAY.format(d).replace(/^יום\s+/, '')} ${d.getUTCDate()}.${d.getUTCMonth() + 1}`;
}

/** "יום חמישי, 18 בפברואר" */
export function longDate(iso: string): string {
  return LONG_DATE.format(utc(iso));
}

export function cellAmount(cell: FareCell | undefined): number | null {
  if (!cell || cell.status !== 'priced' || !cell.min_total) return null;
  const n = Number(cell.min_total.amount);
  return Number.isFinite(n) ? n : null;
}

/** The cheapest priced cell (earliest date on ties), or null. */
export function cheapestCell(scan: FareCalendarResponse): FareCell | null {
  let best: FareCell | null = null;
  for (const cell of scan.cells) {
    const a = cellAmount(cell);
    if (a === null) continue;
    const b = cellAmount(best ?? undefined);
    if (b === null || a < b) best = cell;
  }
  return best;
}

/** The `n` cheapest priced days, cheapest first (earliest date on ties). */
export function cheapestDays(scan: FareCalendarResponse, n: number): FareCell[] {
  return scan.cells
    .filter((c) => cellAmount(c) !== null)
    .sort((a, b) => (cellAmount(a) as number) - (cellAmount(b) as number) || a.depart_date.localeCompare(b.depart_date))
    .slice(0, n);
}

/** Minimum number of priced days before an "average" is meaningful enough to show a saving. */
export const MIN_DAYS_FOR_SAVING = 10;

/** Average minus cheapest, rounded down to whole units — null when not meaningful (too few days / no difference). */
export function savingVsAverage(scan: FareCalendarResponse): number | null {
  const mean = Number(scan.stats.mean?.amount);
  const min = Number(scan.stats.min?.amount);
  if (!Number.isFinite(mean) || !Number.isFinite(min) || scan.stats.priced < MIN_DAYS_FOR_SAVING) return null;
  const saving = Math.floor(mean - min);
  return saving >= 1 ? saving : null;
}

/**
 * Google Flights search for the same route and dates, so the family can see the REAL current price (ours is DEMO).
 * A plain link the user opens — nothing is fetched or scraped by the app.
 */
export function googleFlightsUrl(p: {
  origin: string;
  destination: string;
  depart: string;
  ret?: string | null;
}): string {
  const q = p.ret
    ? `Flights from ${p.origin} to ${p.destination} on ${p.depart} through ${p.ret}`
    : `One way flights from ${p.origin} to ${p.destination} on ${p.depart}`;
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(q)}&curr=ILS&hl=iw`;
}

/**
 * Fare calendar — pure model (unit-tested): request windows, grid layout, labels and keyboard movement.
 * Nothing here invents prices: cells only ever echo what `POST /api/search/flight/calendar` returned.
 */
import { addDaysIso, diffDays, MAX_DAYS_AHEAD } from '@/features/search/forms/common';
import { flightBody, flightFromParams } from '@/features/search/forms/flight';
import { formatDate, LOCALE } from '@/lib/format';
import type { FareCalendarRequest, FareCell, FareCellStatus, FareTier } from '@/lib/schemas/calendar';
import type { Money } from '@/lib/schemas/common';

export type CalendarView = 'month' | 'matrix';

/** The parts of a flight search that define the calendar (route, party, cabin, bags) + the dates it is centred on. */
export interface CalendarBase {
  origin: string;
  destination: string;
  adults: number;
  childrenAges: number[];
  cabin: string;
  maxStops: number | null;
  checkedBags: number;
  currency: string;
  departDate: string;
  /** null = one-way. */
  nights: number | null;
}

export const MIN_NIGHTS = 1;
export const MAX_NIGHTS = 30;
export const MATRIX_SIZE = 7;

export function calendarBaseFromParams(params: Record<string, unknown>): CalendarBase | null {
  const s = flightFromParams(params);
  if (!/^[A-Z]{3}$/.test(s.origin) || !/^[A-Z]{3}$/.test(s.destination) || !s.departDate) return null;
  const round = s.tripType === 'round' && !!s.returnDate;
  return {
    origin: s.origin,
    destination: s.destination,
    adults: s.adults,
    childrenAges: s.childrenAges,
    cabin: s.cabin,
    maxStops: s.maxStops === '' ? null : Number(s.maxStops),
    checkedBags: s.checkedBags,
    currency: s.currency,
    departDate: s.departDate,
    nights: round ? diffDays(s.departDate, s.returnDate) : null,
  };
}

/** Stable identity of a calendar (dates excluded): changing it starts a fresh calendar. */
export function routeKey(b: CalendarBase): string {
  return [b.origin, b.destination, b.adults, b.childrenAges.join('.'), b.cabin, b.maxStops ?? '', b.checkedBags, b.currency, b.nights === null ? 'ow' : 'rt'].join('|');
}

export function nightsSupported(nights: number | null): boolean {
  return nights === null || (nights >= MIN_NIGHTS && nights <= MAX_NIGHTS);
}

// ------------------------------------------------------------------ months --

/** "2026-12" */
export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function monthDays(month: string): string[] {
  const [y, m] = month.split('-').map(Number);
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

/** 0 = Sunday … 6 = Saturday (Israeli weeks start on Sunday). */
export function weekday(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Weeks of a month, Sunday first; `null` pads days outside the month. */
export function monthWeeks(month: string): Array<Array<string | null>> {
  const days = monthDays(month);
  const lead = weekday(days[0]);
  const cells: Array<string | null> = [...Array.from({ length: lead }, () => null), ...days];
  while (cells.length % 7) cells.push(null);
  const weeks: Array<Array<string | null>> = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export function monthLabel(month: string): string {
  return formatDate(`${month}-01`, 'month-year') ?? month;
}

export const WEEKDAY_SHORT = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
export const WEEKDAY_LONG = ['יום ראשון', 'יום שני', 'יום שלישי', 'יום רביעי', 'יום חמישי', 'יום שישי', 'שבת'];

/** First and last searchable day (today … one year ahead, like the search form). */
export function searchableRange(today: string): { from: string; to: string } {
  return { from: today, to: addDaysIso(today, MAX_DAYS_AHEAD) };
}

export function inRange(iso: string, today: string): boolean {
  const r = searchableRange(today);
  return iso >= r.from && iso <= r.to;
}

function baseRequest(b: CalendarBase): Omit<FareCalendarRequest, 'depart_from' | 'depart_to' | 'trip_nights'> {
  return {
    origin: b.origin,
    destination: b.destination,
    adults: b.adults,
    children_ages: b.childrenAges,
    cabin: b.cabin,
    max_stops: b.maxStops,
    checked_bags: b.checkedBags,
    currency: b.currency,
  };
}

/** Month view: every searchable day of the month with the search's own nights. `null` when nothing is searchable. */
export function monthRequest(b: CalendarBase, month: string, today: string): FareCalendarRequest | null {
  if (!nightsSupported(b.nights)) return null;
  const days = monthDays(month);
  const r = searchableRange(today);
  const from = days[0] < r.from ? r.from : days[0];
  const to = days[days.length - 1] > r.to ? r.to : days[days.length - 1];
  if (from > to) return null;
  return { ...baseRequest(b), depart_from: from, depart_to: to, trip_nights: b.nights === null ? [] : [b.nights] };
}

/** Seven consecutive nights values around `center`, inside 1..30. */
export function matrixNights(center: number): number[] {
  const start = Math.min(Math.max(MIN_NIGHTS, center - 3), MAX_NIGHTS - MATRIX_SIZE + 1);
  return Array.from({ length: MATRIX_SIZE }, (_, i) => start + i);
}

/** Matrix start so that `depart` sits in the middle column, never before today. */
export function matrixStartFor(depart: string, today: string): string {
  const start = addDaysIso(depart, -3);
  return start < today ? today : start;
}

/** Matrix view (round trips): 7 depart dates × 7 nights values = 49 cells (≤ 150). */
export function matrixRequest(b: CalendarBase, start: string, nights: number[], today: string): FareCalendarRequest | null {
  if (b.nights === null) return null;
  const r = searchableRange(today);
  const from = start < r.from ? r.from : start;
  let to = addDaysIso(from, MATRIX_SIZE - 1);
  if (to > r.to) to = r.to;
  if (from > to) return null;
  return { ...baseRequest(b), depart_from: from, depart_to: to, trip_nights: nights };
}

// ------------------------------------------------------------------- cells --

export function cellKey(depart: string, nights: number | null | undefined): string {
  return `${depart}|${nights ?? ''}`;
}

export function indexCells(cells: readonly FareCell[]): Map<string, FareCell> {
  return new Map(cells.map((c) => [cellKey(c.depart_date, c.nights), c]));
}

/** Body for the normal `POST /api/search/flight` when a cell is chosen: same search, exact dates. */
export function searchBodyForCell(params: Record<string, unknown>, cell: Pick<FareCell, 'depart_date' | 'return_date' | 'nights'>): Record<string, unknown> {
  const body = flightBody(flightFromParams(params));
  const ret = cell.return_date ?? (cell.nights != null ? addDaysIso(cell.depart_date, cell.nights) : null);
  return { ...body, depart_date: cell.depart_date, return_date: ret, flex_days: 0 };
}

export const STATUS_LABELS: Record<FareCellStatus, string> = {
  priced: 'יש מחיר',
  no_offers: 'אין טיסות',
  not_searched: 'לא נבדק',
  error: 'שגיאה בבדיקה',
};

export const TIER_LABELS: Record<FareTier, string> = {
  best: 'המחיר הנמוך ביותר בלוח',
  low: 'מחיר נמוך',
  mid: 'מחיר בינוני',
  high: 'מחיר גבוה',
};

const wholeFormatters = new Map<string, Intl.NumberFormat>();

/** Cell price rounded to whole currency units for scanning (display only; the exact amount is in the label/details). */
export function cellPriceText(money: Money | null | undefined): string | null {
  if (!money || !/^\d+(\.\d+)?$/.test(money.amount)) return null;
  let f = wholeFormatters.get(money.currency);
  if (!f) {
    try {
      f = new Intl.NumberFormat(LOCALE, {
        style: 'currency',
        currency: money.currency,
        currencyDisplay: 'narrowSymbol',
        maximumFractionDigits: 0,
        minimumFractionDigits: 0,
        roundingMode: 'halfEven',
      });
    } catch {
      return null;
    }
    wholeFormatters.set(money.currency, f);
  }
  return f.format(money.amount as Intl.StringNumericLiteral);
}

function exactMoney(money: Money | null | undefined): string | null {
  if (!money) return null;
  try {
    return new Intl.NumberFormat(LOCALE, { style: 'currency', currency: money.currency, currencyDisplay: 'narrowSymbol', roundingMode: 'halfEven' }).format(
      money.amount as Intl.StringNumericLiteral,
    );
  } catch {
    return null;
  }
}

function dayText(iso: string): string {
  return formatDate(iso, 'weekday-date') ?? iso;
}

export interface CellLabelOptions {
  depart: string;
  nights: number | null;
  cell: FareCell | undefined;
  selected?: boolean;
  outOfRange?: boolean;
}

/**
 * Full accessible name of a cell: dates, status, exact price (total + per person), tier, mode and provider.
 * The visible cell shows a rounded price and icons; this label carries every detail so colour is never the only signal.
 */
export function cellAriaLabel({ depart, nights, cell, selected, outOfRange }: CellLabelOptions): string {
  const parts: string[] = [];
  const ret = cell?.return_date ?? (nights != null ? addDaysIso(depart, nights) : null);
  parts.push(ret ? `יציאה ${dayText(depart)}, חזרה ${dayText(ret)} (${nights === 1 ? 'לילה אחד' : `${nights} לילות`})` : `יציאה ${dayText(depart)}`);
  if (outOfRange) parts.push('מחוץ לטווח החיפוש');
  else if (!cell) parts.push('לא נבדק');
  else if (cell.status === 'priced') {
    const total = exactMoney(cell.min_total);
    const per = exactMoney(cell.per_person);
    const who = cell.travelers ? (cell.travelers === 1 ? 'לנוסע אחד' : `ל-${cell.travelers} נוסעים`) : 'סה״כ';
    if (total) parts.push(`החל מ-${total} ${who}`);
    if (per && (cell.travelers ?? 0) > 1) parts.push(`${per} לנוסע`);
    if (cell.tier) parts.push(TIER_LABELS[cell.tier]);
    if (cell.mode === 'DEMO') parts.push('נתוני הדגמה');
    else if (cell.mode === 'CACHED') parts.push('ממטמון של חיפוש קודם');
    else if (cell.mode === 'LIVE') parts.push('חי');
  } else {
    parts.push(STATUS_LABELS[cell.status]);
    if (cell.message) parts.push(cell.message);
  }
  if (selected) parts.push('התאריכים של החיפוש הנוכחי');
  return parts.join(' · ');
}

// ---------------------------------------------------------------- keyboard --

/**
 * Linear movement over consecutive dates laid out 7 per row (month grid / week strip).
 * In RTL the "next" day is to the left: ArrowLeft = +1, ArrowRight = −1. Up/Down = ∓7. Home/End = week start/end.
 * Returns the new index (clamped to [0, length)), or null when the key is not a navigation key.
 */
export function moveLinear(index: number, key: string, opts: { length: number; rtl: boolean; firstWeekday: number }): number | null {
  const { length, rtl, firstWeekday } = opts;
  const clamp = (i: number) => Math.min(length - 1, Math.max(0, i));
  const dow = (index + firstWeekday) % 7;
  switch (key) {
    case 'ArrowLeft':
      return clamp(index + (rtl ? 1 : -1));
    case 'ArrowRight':
      return clamp(index + (rtl ? -1 : 1));
    case 'ArrowUp':
      return clamp(index - 7);
    case 'ArrowDown':
      return clamp(index + 7);
    case 'Home':
      return clamp(index - dow);
    case 'End':
      return clamp(index + (6 - dow));
    default:
      return null;
  }
}

/** 2-D movement for the depart × nights matrix (columns = depart dates, rows = nights). */
export function moveMatrix(pos: { row: number; col: number }, key: string, opts: { rows: number; cols: number; rtl: boolean }): { row: number; col: number } | null {
  const { rows, cols, rtl } = opts;
  const c = (v: number) => Math.min(cols - 1, Math.max(0, v));
  const r = (v: number) => Math.min(rows - 1, Math.max(0, v));
  switch (key) {
    case 'ArrowLeft':
      return { row: pos.row, col: c(pos.col + (rtl ? 1 : -1)) };
    case 'ArrowRight':
      return { row: pos.row, col: c(pos.col + (rtl ? -1 : 1)) };
    case 'ArrowUp':
      return { row: r(pos.row - 1), col: pos.col };
    case 'ArrowDown':
      return { row: r(pos.row + 1), col: pos.col };
    case 'Home':
      return { row: pos.row, col: 0 };
    case 'End':
      return { row: pos.row, col: cols - 1 };
    default:
      return null;
  }
}

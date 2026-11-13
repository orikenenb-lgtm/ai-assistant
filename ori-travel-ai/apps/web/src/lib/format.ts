/**
 * Hebrew (he-IL) formatting helpers. Display only — never use for arithmetic.
 *
 * Money amounts arrive as decimal strings and are passed to Intl as strings so
 * no float rounding happens (Intl.NumberFormat v3 string support).
 */
import type { Money } from './schemas/common';

export const LOCALE = 'he-IL';

const DECIMAL_RE = /^-?\d+(\.\d+)?$/;
const BIDI_MARKS_RE = /[\u200e\u200f\u061c\u2066-\u2069]/g;

/** Remove bidi control marks (useful for tests and plain-text exports). */
export function stripBidi(s: string): string {
  return s.replace(BIDI_MARKS_RE, '').replace(/\u00a0/g, ' ');
}

const moneyFormatters = new Map<string, Intl.NumberFormat>();

function moneyFormatter(currency: string, compact: boolean): Intl.NumberFormat {
  const key = `${currency}|${compact}`;
  let f = moneyFormatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat(LOCALE, {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
      roundingMode: 'halfEven',
      ...(compact ? { notation: 'compact', maximumFractionDigits: 1 } : {}),
    });
    moneyFormatters.set(key, f);
  }
  return f;
}

export function isDecimalString(value: unknown): value is string {
  return typeof value === 'string' && DECIMAL_RE.test(value.trim());
}

/**
 * Format a decimal-string amount in a currency, e.g. ("1234.5","ILS") → "‏1,234.50 ‏₪".
 * Returns null for invalid input (caller shows a fallback).
 */
export function formatMoney(amount: string, currency: string, opts: { compact?: boolean } = {}): string | null {
  if (!isDecimalString(amount) || !/^[A-Z]{3}$/.test(currency)) return null;
  try {
    // Intl accepts numeric strings and keeps full precision (no float conversion).
    return moneyFormatter(currency, !!opts.compact).format(amount.trim() as Intl.StringNumericLiteral);
  } catch {
    return null;
  }
}

export function formatMoneyValue(money: Money | null | undefined, opts: { compact?: boolean } = {}): string | null {
  if (!money) return null;
  return formatMoney(money.amount, money.currency, opts);
}

const numberFormatter = new Intl.NumberFormat(LOCALE);
export function formatNumber(value: number | string): string {
  return typeof value === 'string' && isDecimalString(value)
    ? numberFormatter.format(value as Intl.StringNumericLiteral)
    : numberFormatter.format(Number(value));
}

/** "2 ש׳ 35 ד׳" style duration. */
export function formatDuration(totalMinutes: number): string {
  if (!Number.isFinite(totalMinutes) || totalMinutes < 0) return '—';
  const h = Math.floor(totalMinutes / 60);
  const m = Math.round(totalMinutes % 60);
  if (h === 0) return `${m} דק׳`;
  if (m === 0) return `${h} ש׳`;
  return `${h} ש׳ ${m} דק׳`;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:?\d{2})?$/i;

export interface ParsedIso {
  /** The absolute instant. */
  instant: Date;
  /**
   * A Date whose UTC fields equal the wall-clock time written in the string
   * (i.e. local time at the source, using its offset). Format with timeZone "UTC".
   */
  wallClock: Date;
  /** Offset in minutes from the string, null when absent (naive/local). */
  offsetMinutes: number | null;
  dateOnly: boolean;
}

export function parseIso(value: string): ParsedIso | null {
  const dateOnly = DATE_ONLY_RE.exec(value);
  if (dateOnly) {
    const wall = new Date(Date.UTC(+dateOnly[1], +dateOnly[2] - 1, +dateOnly[3]));
    return { instant: wall, wallClock: wall, offsetMinutes: null, dateOnly: true };
  }
  const m = ISO_RE.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s = '0', frac = '0', tz] = m;
  const ms = Math.round(Number(`0.${frac}`) * 1000);
  const wallMs = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s, ms);
  let offsetMinutes: number | null = null;
  if (tz) {
    if (tz.toUpperCase() === 'Z') offsetMinutes = 0;
    else {
      const sign = tz.startsWith('-') ? -1 : 1;
      const digits = tz.slice(1).replace(':', '');
      offsetMinutes = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4)));
    }
  }
  const instant = offsetMinutes === null ? new Date(+y, +mo - 1, +d, +h, +mi, +s, ms) : new Date(wallMs - offsetMinutes * 60_000);
  return { instant, wallClock: new Date(wallMs), offsetMinutes, dateOnly: false };
}

export type DatePreset = 'date' | 'date-short' | 'datetime' | 'time' | 'weekday-date' | 'month-year';

const PRESETS: Record<DatePreset, Intl.DateTimeFormatOptions> = {
  date: { day: 'numeric', month: 'short', year: 'numeric' },
  'date-short': { day: 'numeric', month: 'short' },
  datetime: { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' },
  time: { hour: '2-digit', minute: '2-digit' },
  'weekday-date': { weekday: 'long', day: 'numeric', month: 'long' },
  'month-year': { month: 'long', year: 'numeric' },
};

/**
 * Time zone handling:
 * - "source": show the wall-clock time written in the ISO string (flight local
 *   times like 08:15+02:00 stay 08:15 regardless of the viewer's zone).
 * - "viewer": convert the instant to the viewer's zone (system timestamps).
 * - any IANA zone name, e.g. "Asia/Jerusalem".
 * Date-only strings are calendar dates and never shift.
 */
export type TimeZoneMode = 'source' | 'viewer' | (string & {});

function resolve(value: string, tz: TimeZoneMode): { date: Date; timeZone: string | undefined } | null {
  const p = parseIso(value);
  if (!p) return null;
  if (p.dateOnly) return { date: p.wallClock, timeZone: 'UTC' };
  if (tz === 'source') {
    return p.offsetMinutes === null ? { date: p.instant, timeZone: undefined } : { date: p.wallClock, timeZone: 'UTC' };
  }
  if (tz === 'viewer') return { date: p.instant, timeZone: undefined };
  return { date: p.instant, timeZone: tz };
}

export function formatDate(value: string, preset: DatePreset = 'date', tz: TimeZoneMode = 'viewer'): string | null {
  const r = resolve(value, tz);
  if (!r) return null;
  try {
    return new Intl.DateTimeFormat(LOCALE, { ...PRESETS[preset], timeZone: r.timeZone }).format(r.date);
  } catch {
    return null;
  }
}

export function formatDateRange(
  start: string,
  end: string,
  preset: DatePreset = 'date',
  tz: TimeZoneMode = 'viewer',
): string | null {
  const a = resolve(start, tz);
  const b = resolve(end, tz);
  if (!a || !b) return null;
  // formatRange requires one formatter → use the start's zone for both.
  const timeZone = a.timeZone ?? b.timeZone;
  try {
    const f = new Intl.DateTimeFormat(LOCALE, { ...PRESETS[preset], timeZone });
    if (a.date.getTime() > b.date.getTime()) return `${f.format(a.date)} – ${f.format(b.date)}`;
    return f.formatRange(a.date, b.date);
  } catch {
    return null;
  }
}

/** "UTC+02:00" label for an ISO string's offset, or null. */
export function formatOffset(value: string): string | null {
  const p = parseIso(value);
  if (!p || p.offsetMinutes === null) return null;
  const sign = p.offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(p.offsetMinutes);
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

const rtf = new Intl.RelativeTimeFormat('he', { numeric: 'auto', style: 'short' });
const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

/** "לפני 5 דק׳", "אתמול", "עכשיו" (for past and future timestamps). */
export function formatRelative(value: string | Date, now: Date = new Date()): string | null {
  const date = typeof value === 'string' ? parseIso(value)?.instant : value;
  if (!date || Number.isNaN(date.getTime())) return null;
  const diffSec = (date.getTime() - now.getTime()) / 1000;
  const abs = Math.abs(diffSec);
  if (abs < 45) return 'עכשיו';
  for (const [unit, sec] of UNITS) {
    if (abs >= sec) return rtf.format(Math.round(diffSec / sec), unit);
  }
  return rtf.format(Math.round(diffSec / 60), 'minute');
}

/**
 * Time-zone arithmetic with the platform Intl API only (no dependencies), safe
 * on server and client. All CRM times are stored in UTC and shown in the
 * tenant's IANA time zone (Asia/Jerusalem by default), including DST shifts.
 *
 * A "date key" is a calendar day in the tenant zone: "YYYY-MM-DD".
 * A "local input" is a wall-clock time in the tenant zone: "YYYY-MM-DDTHH:mm".
 */

export type ZonedParts = { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number };

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    formatters.set(tz, f);
  }
  return f;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function isValidTimeZone(tz: string): boolean {
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock parts of an instant in `tz`. */
export function zonedParts(date: Date, tz: string): ZonedParts {
  const parts = formatter(tz).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: WEEKDAYS[get("weekday")] ?? 0,
  };
}

/** Offset of `tz` from UTC at `date`, in milliseconds (e.g. +3h → 10800000). */
export function tzOffsetMs(date: Date, tz: string): number {
  const p = zonedParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * Converts a wall-clock time in `tz` to the UTC instant. Times inside a DST
 * "spring forward" gap resolve to the first valid instant after the gap;
 * ambiguous "fall back" times resolve to the earlier (daylight) instant.
 */
export function zonedToUtc(year: number, month: number, day: number, hour: number, minute: number, tz: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const offset1 = tzOffsetMs(new Date(guess), tz);
  let utc = guess - offset1;
  const offset2 = tzOffsetMs(new Date(utc), tz);
  if (offset2 !== offset1) {
    const alt = guess - offset2;
    // Prefer the candidate whose wall clock matches the request.
    const p = zonedParts(new Date(alt), tz);
    utc = p.hour === hour && p.minute === minute ? alt : Math.max(utc, alt);
  }
  // Ambiguous (fall-back) hour: prefer the earlier instant if it also matches.
  const earlier = utc - 3_600_000;
  const pe = zonedParts(new Date(earlier), tz);
  if (pe.year === year && pe.month === month && pe.day === day && pe.hour === hour && pe.minute === minute) utc = earlier;
  return new Date(utc);
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** "YYYY-MM-DD" of an instant in `tz`. */
export function dateKey(date: Date, tz: string): string {
  const p = zonedParts(date, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** "YYYY-MM-DDTHH:mm" of an instant in `tz` (value for <input type="datetime-local">). */
export function toLocalInput(date: Date, tz: string): string {
  const p = zonedParts(date, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** "HH:mm" of an instant in `tz`. */
export function timeKey(date: Date, tz: string): string {
  const p = zonedParts(date, tz);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

export function parseDateKey(key: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return { year, month, day };
}

/** Parses "YYYY-MM-DDTHH:mm" in `tz` to a UTC Date (null when malformed). */
export function parseLocalInput(value: string, tz: string): Date | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const d = parseDateKey(m[1]);
  const hour = Number(m[2]);
  const minute = Number(m[3]);
  if (!d || hour > 23 || minute > 59) return null;
  return zonedToUtc(d.year, d.month, d.day, hour, minute, tz);
}

/** Midnight at the start of the given calendar day in `tz`. */
export function startOfDay(key: string, tz: string): Date {
  const d = parseDateKey(key);
  if (!d) throw new Error(`invalid date key ${key}`);
  return zonedToUtc(d.year, d.month, d.day, 0, 0, tz);
}

/** Calendar-day arithmetic on date keys (independent of DST). */
export function addDays(key: string, days: number): string {
  const d = parseDateKey(key);
  if (!d) throw new Error(`invalid date key ${key}`);
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function addMonths(key: string, months: number): string {
  const d = parseDateKey(key);
  if (!d) throw new Error(`invalid date key ${key}`);
  const first = new Date(Date.UTC(d.year, d.month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return `${first.getUTCFullYear()}-${pad(first.getUTCMonth() + 1)}-${pad(Math.min(d.day, lastDay))}`;
}

/** 0 = Sunday … 6 = Saturday, for a calendar day (zone-independent). */
export function weekdayOf(key: string): number {
  const d = parseDateKey(key);
  if (!d) throw new Error(`invalid date key ${key}`);
  return new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay();
}

export function startOfWeek(key: string, weekStartsOn = 0): string {
  return addDays(key, -((weekdayOf(key) - weekStartsOn + 7) % 7));
}

export function startOfMonthKey(key: string): string {
  return `${key.slice(0, 7)}-01`;
}

/** Number of calendar days between two keys (b - a). */
export function diffDays(a: string, b: string): number {
  const pa = parseDateKey(a)!;
  const pb = parseDateKey(b)!;
  return Math.round((Date.UTC(pb.year, pb.month - 1, pb.day) - Date.UTC(pa.year, pa.month - 1, pa.day)) / 86_400_000);
}

/** Minutes since local midnight of `date` in `tz` (0‥1439). */
export function minutesIntoDay(date: Date, tz: string): number {
  const p = zonedParts(date, tz);
  return p.hour * 60 + p.minute;
}

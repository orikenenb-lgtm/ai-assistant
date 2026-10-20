/**
 * Date ranges and time-zone math for analytics. Pure functions (no DB, no
 * request APIs) so they are unit-testable and safe on server and client.
 *
 * All ranges are half-open UTC instants [from, to) whose boundaries are
 * midnights in the tenant's time zone.
 */

export const RANGE_PRESETS = ["7d", "30d", "90d", "this_month", "last_month", "this_quarter", "this_year", "custom"] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];
export type Bucket = "day" | "week" | "month";

export type DateRange = {
  preset: RangePreset;
  from: Date;
  to: Date;
  /** Local calendar dates (YYYY-MM-DD) of the first and last included day. */
  fromDate: string;
  toDate: string;
  bucket: Bucket;
};

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Wall-clock components of `instant` in `timeZone`. */
export function localParts(instant: Date, timeZone: string): LocalParts {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(instant).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Offset of `timeZone` from UTC at `instant`, in minutes (Israel: +120 / +180). */
export function tzOffsetMinutes(instant: Date, timeZone: string): number {
  const p = localParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000);
}

/** UTC instant of local midnight on the given calendar date in `timeZone`. */
export function zonedMidnight(year: number, month: number, day: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day);
  let instant = guess - tzOffsetMinutes(new Date(guess), timeZone) * 60_000;
  // Re-check once: the offset may differ on the other side of a DST switch.
  const second = guess - tzOffsetMinutes(new Date(instant), timeZone) * 60_000;
  if (second !== instant) instant = second;
  return new Date(instant);
}

export function toDateString(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Local calendar date (YYYY-MM-DD) of `instant` in `timeZone`. */
export function localDate(instant: Date, timeZone: string): string {
  const p = localParts(instant, timeZone);
  return toDateString(p.year, p.month, p.day);
}

function parseDate(s: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return { year, month, day };
}

/** Calendar arithmetic on local dates (no time zone involved). */
export function addDays(date: string, days: number): string {
  const p = parseDate(date)!;
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + days));
  return toDateString(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function addMonths(date: string, months: number): string {
  const p = parseDate(date)!;
  const d = new Date(Date.UTC(p.year, p.month - 1 + months, 1));
  return toDateString(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

export function startOfLocalDay(date: string, timeZone: string): Date {
  const p = parseDate(date)!;
  return zonedMidnight(p.year, p.month, p.day, timeZone);
}

function daysBetween(fromDate: string, toDateInclusive: string): number {
  const a = parseDate(fromDate)!;
  const b = parseDate(toDateInclusive)!;
  return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000) + 1;
}

/** Day buckets up to ~5 weeks, week buckets up to ~4 months, then months. */
export function bucketFor(days: number): Bucket {
  if (days <= 35) return "day";
  if (days <= 120) return "week";
  return "month";
}

const MAX_CUSTOM_DAYS = 3 * 366;

/** Largest number of days each explicit bucket size may cover (keeps series readable). */
const BUCKET_LIMITS: Record<Bucket, number> = { day: 92, week: 400, month: Number.MAX_SAFE_INTEGER };

/** Honors a requested bucket size when the range is short enough for it, else auto. */
export function chooseBucket(days: number, requested?: Bucket | "auto" | null): Bucket {
  if (requested && requested !== "auto" && days <= BUCKET_LIMITS[requested]) return requested;
  return bucketFor(days);
}

/**
 * Resolves a preset (or a custom from/to pair of local dates, inclusive) into a
 * half-open UTC range aligned to local midnights in `timeZone`.
 */
export function resolveRange(
  preset: RangePreset,
  opts: { from?: string | null; to?: string | null; timeZone: string; now?: Date; bucket?: Bucket | "auto" | null },
): DateRange {
  const now = opts.now ?? new Date();
  const today = localDate(now, opts.timeZone);
  const t = parseDate(today)!;
  let fromDate: string;
  let toDate: string;
  switch (preset) {
    case "7d":
    case "30d":
    case "90d": {
      const n = Number(preset.replace("d", ""));
      fromDate = addDays(today, -(n - 1));
      toDate = today;
      break;
    }
    case "this_month":
      fromDate = toDateString(t.year, t.month, 1);
      toDate = today;
      break;
    case "last_month":
      fromDate = addMonths(toDateString(t.year, t.month, 1), -1);
      toDate = addDays(toDateString(t.year, t.month, 1), -1);
      break;
    case "this_quarter": {
      const qStart = Math.floor((t.month - 1) / 3) * 3 + 1;
      fromDate = toDateString(t.year, qStart, 1);
      toDate = today;
      break;
    }
    case "this_year":
      fromDate = toDateString(t.year, 1, 1);
      toDate = today;
      break;
    case "custom": {
      const f = opts.from && parseDate(opts.from) ? opts.from : null;
      const e = opts.to && parseDate(opts.to) ? opts.to : null;
      if (!f || !e) return resolveRange("30d", opts);
      fromDate = f <= e ? f : e;
      toDate = f <= e ? e : f;
      if (daysBetween(fromDate, toDate) > MAX_CUSTOM_DAYS) fromDate = addDays(toDate, -(MAX_CUSTOM_DAYS - 1));
      break;
    }
  }
  return {
    preset,
    from: startOfLocalDay(fromDate, opts.timeZone),
    to: startOfLocalDay(addDays(toDate, 1), opts.timeZone),
    fromDate,
    toDate,
    bucket: chooseBucket(daysBetween(fromDate, toDate), opts.bucket),
  };
}

/** The range of equal length immediately before `range` (for "vs previous period"). */
export function previousRange(range: DateRange, timeZone: string): DateRange {
  const days = daysBetween(range.fromDate, range.toDate);
  const toDate = addDays(range.fromDate, -1);
  const fromDate = addDays(toDate, -(days - 1));
  return {
    preset: "custom",
    from: startOfLocalDay(fromDate, timeZone),
    to: startOfLocalDay(range.fromDate, timeZone),
    fromDate,
    toDate,
    bucket: range.bucket,
  };
}

/** Start date (YYYY-MM-DD, local) of the bucket containing `date`. Weeks start on Sunday. */
export function bucketStart(date: string, bucket: Bucket): string {
  const p = parseDate(date)!;
  if (bucket === "month") return toDateString(p.year, p.month, 1);
  if (bucket === "week") {
    const dow = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay(); // 0 = Sunday
    return addDays(date, -dow);
  }
  return date;
}

/** Every bucket start between the range's first and last day, in order. */
export function bucketKeys(range: Pick<DateRange, "fromDate" | "toDate" | "bucket">): string[] {
  const keys: string[] = [];
  let cursor = bucketStart(range.fromDate, range.bucket);
  const last = bucketStart(range.toDate, range.bucket);
  for (let guard = 0; cursor <= last && guard < 2000; guard++) {
    keys.push(cursor);
    cursor = range.bucket === "month" ? addMonths(cursor, 1) : addDays(cursor, range.bucket === "week" ? 7 : 1);
  }
  return keys;
}

/** Merges sparse SQL rows into a gap-free series (missing buckets → zero). */
export function fillBuckets<T extends { bucket: string }>(keys: string[], rows: T[], empty: (bucket: string) => T): T[] {
  const byKey = new Map(rows.map((r) => [r.bucket, r]));
  return keys.map((k) => byKey.get(k) ?? empty(k));
}

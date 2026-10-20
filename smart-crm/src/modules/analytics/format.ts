import { formatMoney, formatNumber, type AppLocale } from "@/lib/format";
import type { Bucket } from "./range";

/** Serializable description of how to format values (functions can't cross the server/client boundary). */
export type ValueFormat = { kind: "money"; currency: string } | { kind: "count" } | { kind: "percent" } | { kind: "days" };

const intlLocale = (l: AppLocale) => (l === "he" ? "he-IL" : "en-US");

export function formatPercent(v: number | null | undefined, locale: AppLocale, digits = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return new Intl.NumberFormat(intlLocale(locale), { style: "percent", maximumFractionDigits: digits }).format(v);
}

export function formatValue(v: number | null | undefined, fmt: ValueFormat, locale: AppLocale, opts: { compact?: boolean } = {}): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  switch (fmt.kind) {
    case "money":
      return formatMoney(v, fmt.currency, locale, { compact: opts.compact });
    case "percent":
      return formatPercent(v, locale);
    case "days":
      return formatNumber(v, locale, { maximumFractionDigits: 1 });
    default:
      return formatNumber(v, locale, opts.compact ? { notation: "compact", maximumFractionDigits: 1 } : {});
  }
}

/** Axis/tooltip label for a bucket start date (YYYY-MM-DD, already local). */
export function formatBucket(bucket: string, kind: Bucket, locale: AppLocale, opts: { long?: boolean } = {}): string {
  const [y, m, d] = bucket.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const options: Intl.DateTimeFormatOptions =
    kind === "month"
      ? { month: opts.long ? "long" : "short", year: opts.long ? "numeric" : "2-digit", timeZone: "UTC" }
      : { day: "numeric", month: "short", ...(opts.long ? { year: "numeric" } : {}), timeZone: "UTC" };
  return new Intl.DateTimeFormat(intlLocale(locale), options).format(date);
}

/** Untyped view of a next-intl translator for keys built from data (sources, stages…). */
export function looseTranslator(t: unknown): { t: (key: string) => string; has: (key: string) => boolean } {
  const f = t as ((key: string) => string) & { has(key: string): boolean };
  return { t: (key) => f(key), has: (key) => f.has(key) };
}

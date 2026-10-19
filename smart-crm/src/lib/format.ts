/** Locale-aware formatting helpers (pure; safe on server and client). */
export type AppLocale = "he" | "en";

const intlLocale = (l: AppLocale) => (l === "he" ? "he-IL" : "en-US");

export function formatMoney(cents: number, currency: string, locale: AppLocale, opts: { compact?: boolean } = {}): string {
  return new Intl.NumberFormat(intlLocale(locale), {
    style: "currency",
    currency,
    notation: opts.compact ? "compact" : "standard",
    maximumFractionDigits: opts.compact ? 1 : cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

export function formatNumber(n: number, locale: AppLocale, opts: Intl.NumberFormatOptions = {}): string {
  return new Intl.NumberFormat(intlLocale(locale), opts).format(n);
}

export function formatDate(d: Date | string | null | undefined, locale: AppLocale, timeZone = "Asia/Jerusalem"): string {
  if (!d) return "";
  return new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium", timeZone }).format(new Date(d));
}

export function formatDateTime(d: Date | string | null | undefined, locale: AppLocale, timeZone = "Asia/Jerusalem"): string {
  if (!d) return "";
  return new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(d));
}

export function formatTime(d: Date | string | null | undefined, locale: AppLocale, timeZone = "Asia/Jerusalem"): string {
  if (!d) return "";
  return new Intl.DateTimeFormat(intlLocale(locale), { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(new Date(d));
}

export function formatRelative(d: Date | string, locale: AppLocale, now = Date.now()): string {
  const diffSec = Math.round((new Date(d).getTime() - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(intlLocale(locale), { numeric: "auto" });
  const abs = Math.abs(diffSec);
  if (abs < 60) return rtf.format(diffSec, "second");
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diffSec / 86400), "day");
  if (abs < 86400 * 365) return rtf.format(Math.round(diffSec / (86400 * 30)), "month");
  return rtf.format(Math.round(diffSec / (86400 * 365)), "year");
}

export function personName(p: { firstName?: string | null; lastName?: string | null; fullName?: string | null }): string {
  if (p.fullName) return p.fullName;
  return [p.firstName, p.lastName].filter(Boolean).join(" ").trim();
}

/** Shared helpers for the four search forms: dates, Zod primitives, server-error mapping. */
import { z } from 'zod';
import { isApiError } from '@/lib/api';
import type { ApiError } from '@/lib/api';

export type FieldErrors = Record<string, string>;
export type ValidationResult<B> = { ok: true; body: B } | { ok: false; errors: FieldErrors };

export const MAX_DAYS_AHEAD = 365;
export const MAX_TRAVELLERS = 9;

export const CURRENCIES = [
  'ILS', 'USD', 'EUR', 'GBP', 'CHF', 'CAD', 'AUD', 'CZK', 'HUF', 'PLN', 'RON', 'SEK', 'NOK', 'DKK', 'TRY',
  'AED', 'THB', 'GEL', 'CNY', 'INR', 'JPY', 'KRW',
] as const;

const pad = (n: number) => String(n).padStart(2, '0');

/** Local calendar date "YYYY-MM-DD". */
export function todayIso(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function diffDays(fromIso: string, toIso: string): number {
  const [y1, m1, d1] = fromIso.split('-').map(Number);
  const [y2, m2, d2] = toIso.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

/** Local datetime-local value "YYYY-MM-DDTHH:mm" at the given hour, `days` from today. */
export function localDateTime(days: number, hour: number, now: Date = new Date()): string {
  return `${addDaysIso(todayIso(now), days)}T${pad(hour)}:00`;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A required calendar date between today and one year ahead (mirrors `_check_not_past`). */
export function futureDate(today: string, required = true) {
  return z
    .string()
    .trim()
    .superRefine((v, ctx) => {
      if (!v) {
        if (required) ctx.addIssue({ code: 'custom', message: 'יש לבחור תאריך' });
        return;
      }
      if (!DATE_RE.test(v) || Number.isNaN(Date.parse(v))) {
        ctx.addIssue({ code: 'custom', message: 'תאריך לא תקין' });
        return;
      }
      if (v < today) ctx.addIssue({ code: 'custom', message: 'התאריך כבר עבר' });
      else if (diffDays(today, v) > MAX_DAYS_AHEAD) ctx.addIssue({ code: 'custom', message: 'ניתן לחפש עד שנה קדימה' });
    });
}

export const currencySchema = z.enum(CURRENCIES, { error: 'בחרו מטבע מהרשימה' });

/** Optional positive decimal max price, kept as a string (no float). */
export const maxPriceSchema = z
  .string()
  .trim()
  .refine((v) => v === '' || (/^\d{1,9}(\.\d{1,2})?$/.test(v) && /[1-9]/.test(v)), 'הזינו סכום חיובי (עד שתי ספרות אחרי הנקודה)');

export const ageSchema = z.number().int('גיל חייב להיות מספר שלם').min(0, 'גיל בין 0 ל-17').max(17, 'גיל בין 0 ל-17');

export function zodFieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.');
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

/** Exact key match or any nested key ("children_ages" matches "children_ages.1"). */
export function errorFor(errors: FieldErrors, key: string): string | undefined {
  if (errors[key]) return errors[key];
  const nested = Object.keys(errors).find((k) => k.startsWith(`${key}.`));
  return nested ? errors[nested] : undefined;
}

/**
 * Maps a 422 ApiError to field errors keyed by the server field path.
 * Model-level errors arrive with an empty field and a "field: message" text; they are re-attached to the field,
 * everything else becomes a form-level error under the key "".
 */
export function serverFieldErrors(error: unknown): FieldErrors {
  const out: FieldErrors = {};
  if (!isApiError(error)) return out;
  const apiError: ApiError = error;
  const details = Array.isArray(apiError.details) ? apiError.details : [];
  for (const item of details) {
    if (!item || typeof item !== 'object') continue;
    const field = typeof (item as { field?: unknown }).field === 'string' ? (item as { field: string }).field : '';
    const message = typeof (item as { message?: unknown }).message === 'string' ? (item as { message: string }).message : '';
    if (!message) continue;
    if (field) {
      if (!(field in out)) out[field] = message;
      continue;
    }
    const m = /^([a-z_]+): (.+)$/.exec(message);
    if (m) {
      if (!(m[1] in out)) out[m[1]] = m[2];
    } else if (!('' in out)) {
      out[''] = message;
    }
  }
  if (Object.keys(out).length === 0) out[''] = apiError.message;
  return out;
}

export function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}
export function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
export function ages(v: unknown): number[] {
  return Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number' && x >= 0 && x <= 17) : [];
}
export function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}
export function priceStr(v: unknown): string {
  if (typeof v === 'string') return v.replace(/\.0+$/, '');
  if (typeof v === 'number') return String(v);
  return '';
}
export function currencyOf(v: unknown): string {
  return typeof v === 'string' && (CURRENCIES as readonly string[]).includes(v) ? v : 'ILS';
}

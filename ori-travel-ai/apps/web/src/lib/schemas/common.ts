/**
 * Shared primitives mirroring `apps/api/app/schemas/common.py`.
 *
 * Rules:
 * - Money amounts are decimal STRINGS ("123.45"). Never convert to float for math.
 * - Timestamps are ISO-8601 strings with an offset (UTC "Z" or "+02:00").
 * - Unknown keys are stripped (Zod default) so additive backend changes never break parsing.
 */
import { z } from 'zod';

export const CATEGORIES = ['flight', 'hotel', 'car', 'activity'] as const;
export const CategorySchema = z.enum(CATEGORIES);
export type Category = z.infer<typeof CategorySchema>;

export const DATA_MODES = ['DEMO', 'LIVE', 'CACHED'] as const;
export const DataModeSchema = z.enum(DATA_MODES);
export type DataMode = z.infer<typeof DataModeSchema>;

export const PROVIDER_HEALTH_STATUSES = ['OK', 'DEGRADED', 'FAILED', 'NOT_CONFIGURED', 'DISABLED'] as const;
export const ProviderHealthStatusSchema = z.enum(PROVIDER_HEALTH_STATUSES);
export type ProviderHealthStatus = z.infer<typeof ProviderHealthStatusSchema>;

/** Decimal serialized as string, e.g. "123.45", "-5", "0.5". */
export const DecimalStringSchema = z.string().regex(/^-?\d+(\.\d+)?$/, 'Invalid decimal string');
export type DecimalString = z.infer<typeof DecimalStringSchema>;

export const CurrencyCodeSchema = z.string().regex(/^[A-Z]{3}$/, 'Invalid currency code');

export const MoneySchema = z.object({
  amount: DecimalStringSchema,
  currency: CurrencyCodeSchema,
});
export type Money = z.infer<typeof MoneySchema>;

/** ISO datetime; accepts "Z", "+02:00" offsets and (leniently) naive local values. */
export const IsoDateTimeSchema = z.iso.datetime({ offset: true, local: true });
/** ISO calendar date "YYYY-MM-DD". */
export const IsoDateSchema = z.iso.date();

export function pageSchema<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    page_size: z.number().int().positive(),
  });
}
export type Page<T> = { items: T[]; total: number; page: number; page_size: number };

/**
 * Accepts either a bare array or a Page envelope and normalizes to an array.
 * Useful while concurrently-built list endpoints settle on a shape.
 */
export function listOrPageSchema<T extends z.ZodType>(item: T) {
  return z.union([z.array(item), pageSchema(item)]).transform((v) => (Array.isArray(v) ? v : v.items));
}

export const OkResponseSchema = z.object({ ok: z.boolean() });

/** `{"error": {code, message, details, request_id}}` — see app/core/errors.py */
export const ApiErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
    request_id: z.string().nullable().optional(),
  }),
});
export type ApiErrorEnvelope = z.infer<typeof ApiErrorEnvelopeSchema>;

/** Validation error detail item produced for 422 responses. */
export const ValidationDetailSchema = z.object({
  field: z.string(),
  message: z.string(),
  type: z.string().nullable().optional(),
});
export type ValidationDetail = z.infer<typeof ValidationDetailSchema>;

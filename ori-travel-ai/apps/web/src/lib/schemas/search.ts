/** Search contracts — mirrors `apps/api/app/schemas/search.py`. */
import { z } from 'zod';
import { CategorySchema, DataModeSchema, IsoDateTimeSchema, pageSchema } from './common';
import { CanonicalOfferSchema } from './offers';

export const PROVIDER_RUN_STATUSES = [
  'OK',
  'FAILED',
  'TIMEOUT',
  'NOT_CONFIGURED',
  'DISABLED',
  'CACHED',
  'UNSUPPORTED',
] as const;
export const ProviderRunStatusSchema = z.enum(PROVIDER_RUN_STATUSES);
export type ProviderRunStatus = z.infer<typeof ProviderRunStatusSchema>;

export const ProviderRunSchema = z.object({
  provider_id: z.string(),
  provider_name: z.string(),
  mode: DataModeSchema,
  status: ProviderRunStatusSchema,
  result_count: z.number().int().default(0),
  duration_ms: z.number().int().nullable().optional(),
  error_code: z.string().nullable().optional(),
  message: z.string().nullable().optional(), // Hebrew, user safe
  fetched_at: IsoDateTimeSchema.nullable().optional(),
});
export type ProviderRun = z.infer<typeof ProviderRunSchema>;

export const SearchStatusSchema = z.enum(['completed', 'partial', 'failed']);
export type SearchStatus = z.infer<typeof SearchStatusSchema>;

/**
 * Highlights computed server-side over the offers returned by the search (contract V6 §2), only among offers in the
 * dominant currency. `null` when there are no offers. Never "the cheapest in the market".
 */
export const SearchHighlightsSchema = z.object({
  currency: z.string(),
  cheapest_offer_id: z.string().nullable().optional(),
  fastest_offer_id: z.string().nullable().optional(),
  best_score_offer_id: z.string().nullable().optional(),
  comparable_count: z.number().int().default(0),
  /** Hebrew honesty note, e.g. "הזול ביותר מבין ההצעות שנמצאו בחיפוש זה (מטבע זהה) — לא בהכרח בכל השוק". */
  note: z.string().nullable().optional(),
});
export type SearchHighlights = z.infer<typeof SearchHighlightsSchema>;

export const SearchResponseSchema = z.object({
  search_id: z.string(),
  category: CategorySchema,
  status: SearchStatusSchema,
  params: z.record(z.string(), z.unknown()),
  created_at: IsoDateTimeSchema,
  completed_at: IsoDateTimeSchema.nullable().optional(),
  providers: z.array(ProviderRunSchema),
  offers: z.array(CanonicalOfferSchema),
  total_offers_before_dedupe: z.number().int().default(0),
  weights: z.record(z.string(), z.number().int()),
  coverage_note: z.string(),
  has_demo_results: z.boolean().default(false),
  has_live_results: z.boolean().default(false),
  /** Additive (V6). Absent on older servers → the UI derives the cheapest offer client-side from the same offers. */
  highlights: SearchHighlightsSchema.nullable().optional(),
});
export type SearchResponse = z.infer<typeof SearchResponseSchema>;

/** GET /api/search/history item (contract §3.3). */
export const SearchHistoryItemSchema = z.object({
  search_id: z.string(),
  category: CategorySchema,
  params: z.record(z.string(), z.unknown()),
  status: z.string(),
  result_count: z.number().int().nullable().optional(),
  created_at: IsoDateTimeSchema,
  origin: z.string().nullable().optional(),
});
export type SearchHistoryItem = z.infer<typeof SearchHistoryItemSchema>;
export const SearchHistoryPageSchema = pageSchema(SearchHistoryItemSchema);

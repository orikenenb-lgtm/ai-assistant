/**
 * Fare calendar contract — `POST /api/search/flight/calendar`
 * (docs/architecture/v6-flight-experience-contract.md §1, backend owner BE-CAL).
 *
 * Honesty rules mirrored from the contract:
 * - a cell is `priced` only when a real adapter quote (DEMO fixture or cached LIVE/CACHED offer) exists;
 * - `no_offers` = providers answered with zero offers, `not_searched` = nothing was asked for that cell,
 *   `error` = the provider failed for that cell;
 * - calendar cells are never persisted as offers: selecting one runs the normal flight search.
 */
import { z } from 'zod';
import { DataModeSchema, IsoDateSchema, IsoDateTimeSchema, MoneySchema } from './common';

export const FARE_CELL_STATUSES = ['priced', 'no_offers', 'not_searched', 'error'] as const;
export const FareCellStatusSchema = z.enum(FARE_CELL_STATUSES);
export type FareCellStatus = z.infer<typeof FareCellStatusSchema>;

/** Tertiles of priced cells in the same currency; the minimum price cell(s) get `best`. */
export const FARE_TIERS = ['best', 'low', 'mid', 'high'] as const;
export const FareTierSchema = z.enum(FARE_TIERS);
export type FareTier = z.infer<typeof FareTierSchema>;

export const FareCellSchema = z.object({
  depart_date: IsoDateSchema,
  return_date: IsoDateSchema.nullable().optional(),
  /** null for one-way. */
  nights: z.number().int().nullable().optional(),
  status: FareCellStatusSchema,
  min_total: MoneySchema.nullable().optional(),
  per_person: MoneySchema.nullable().optional(),
  travelers: z.number().int().nullable().optional(),
  tier: FareTierSchema.nullable().optional(),
  mode: DataModeSchema.nullable().optional(),
  provider_id: z.string().nullable().optional(),
  provider_name: z.string().nullable().optional(),
  offers_count: z.number().int().nullable().optional(),
  fetched_at: IsoDateTimeSchema.nullable().optional(),
  /** Hebrew, for error / not_searched. */
  message: z.string().nullable().optional(),
});
export type FareCell = z.infer<typeof FareCellSchema>;

export const FareCalendarStatsSchema = z.object({
  min: MoneySchema.nullable().optional(),
  max: MoneySchema.nullable().optional(),
  median: MoneySchema.nullable().optional(),
  /** Average of the priced cells (same currency). */
  mean: MoneySchema.nullable().optional(),
  priced: z.number().int().default(0),
  no_offers: z.number().int().default(0),
  not_searched: z.number().int().default(0),
  error: z.number().int().default(0),
});
export type FareCalendarStats = z.infer<typeof FareCalendarStatsSchema>;

export const FareCalendarSourceSchema = z.object({
  provider_id: z.string(),
  provider_name: z.string(),
  mode: DataModeSchema.nullable().optional(),
  /** Provider run status (OK / NOT_CONFIGURED / …) or a calendar-specific status such as "not_queried". */
  status: z.string(),
  message: z.string().nullable().optional(),
});
export type FareCalendarSource = z.infer<typeof FareCalendarSourceSchema>;

export const FareCalendarResponseSchema = z.object({
  origin: z.string(),
  destination: z.string(),
  currency: z.string(),
  depart_dates: z.array(IsoDateSchema),
  /** `[null]` for one-way. */
  trip_nights: z.array(z.number().int().nullable()),
  cells: z.array(FareCellSchema),
  stats: FareCalendarStatsSchema,
  sources: z.array(FareCalendarSourceSchema).default([]),
  legend_note: z.string().nullable().optional(),
  coverage_note: z.string().nullable().optional(),
  has_demo: z.boolean().default(false),
  generated_at: IsoDateTimeSchema.nullable().optional(),
});
export type FareCalendarResponse = z.infer<typeof FareCalendarResponseSchema>;

/** Request body. `trip_nights` empty ⇒ one-way. Limits: ≤ 42 depart dates, ≤ 150 cells, ≤ 7 nights values (1..30). */
export interface FareCalendarRequest {
  origin: string;
  destination: string;
  depart_from: string;
  depart_to: string;
  trip_nights: number[];
  adults: number;
  children_ages: number[];
  cabin: string;
  max_stops: number | null;
  checked_bags: number;
  currency: string;
}

export const CALENDAR_MAX_DEPART_DATES = 42;
export const CALENDAR_MAX_CELLS = 150;
export const CALENDAR_MAX_NIGHTS_VALUES = 7;

/**
 * Year scan — `POST /api/search/flight/year-scan`: every depart date from tomorrow until a year ahead for ONE trip
 * length (`nights` null ⇒ one-way). Same response shape and honesty rules as the calendar (DEMO + cached only).
 */
export interface YearScanRequest {
  origin: string;
  destination: string;
  nights: number | null;
  adults: number;
  children_ages: number[];
  cabin: string;
  currency: string;
}

/**
 * Trips, trip items and budget — mirrors `apps/api/app/modules/itineraries/schemas.py`.
 * Money amounts are decimal strings; totals are always per currency (never mixed).
 */
import { z } from 'zod';
import { DataModeSchema, DecimalStringSchema, IsoDateSchema, IsoDateTimeSchema, MoneySchema, listOrPageSchema } from './common';

export const ITEM_KINDS = ['flight', 'hotel', 'car', 'activity', 'transfer', 'note', 'other'] as const;
export const ItemKindSchema = z.enum(ITEM_KINDS);
export type ItemKind = z.infer<typeof ItemKindSchema>;

export const ITEM_COST_STATUSES = ['known', 'estimate', 'excluded'] as const;
export const ItemCostStatusSchema = z.enum(ITEM_COST_STATUSES);
export type ItemCostStatus = z.infer<typeof ItemCostStatusSchema>;

export const TRIP_STATUSES = ['planning', 'booked', 'completed', 'cancelled'] as const;
export const TripStatusSchema = z.enum(TRIP_STATUSES);
export type TripStatus = z.infer<typeof TripStatusSchema>;

export const CurrencyTotalSchema = z.object({
  currency: z.string(),
  known: DecimalStringSchema,
  estimated: DecimalStringSchema,
});
export type CurrencyTotal = z.infer<typeof CurrencyTotalSchema>;

export const TripSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  destination: z.string().nullable().optional(),
  start_date: IsoDateSchema.nullable().optional(),
  end_date: IsoDateSchema.nullable().optional(),
  timezone: z.string().nullable().optional(),
  status: z.string().optional(),
  budget: MoneySchema.nullable().optional(),
  traveler_count: z.number().int().nullable().optional(),
  item_count: z.number().int().nullable().optional(),
  day_count: z.number().int().nullable().optional(),
  totals: z.array(CurrencyTotalSchema).default([]),
  has_demo_data: z.boolean().default(false),
  created_at: IsoDateTimeSchema.optional(),
  updated_at: IsoDateTimeSchema.nullable().optional(),
});
export type TripSummary = z.infer<typeof TripSummarySchema>;
export const TripSummaryListSchema = listOrPageSchema(TripSummarySchema);

export const TripTravelerSchema = z.object({
  id: z.string(),
  display_name: z.string(),
  relation: z.string().nullable().optional(),
  age_group: z.string(),
  is_minor: z.boolean(),
});
export type TripTraveler = z.infer<typeof TripTravelerSchema>;

export const TripItemSchema = z.object({
  id: z.string(),
  trip_id: z.string(),
  kind: z.string(),
  title: z.string(),
  start_at: IsoDateTimeSchema.nullable().optional(),
  end_at: IsoDateTimeSchema.nullable().optional(),
  timezone: z.string().nullable().optional(),
  local_date: IsoDateSchema.nullable().optional(),
  location: z.string().nullable().optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  offer_id: z.string().nullable().optional(),
  cost: MoneySchema.nullable().optional(),
  cost_status: z.string(),
  notes: z.string().nullable().optional(),
  sort_order: z.number().int(),
  offer_snapshot: z.record(z.string(), z.unknown()).nullable().optional(),
  data_mode: DataModeSchema.nullable().optional(),
  offer_expired: z.boolean().default(false),
  created_at: IsoDateTimeSchema,
  updated_at: IsoDateTimeSchema,
});
export type TripItem = z.infer<typeof TripItemSchema>;

export const TripDaySchema = z.object({ date: IsoDateSchema, item_ids: z.array(z.string()) });
export type TripDay = z.infer<typeof TripDaySchema>;

export const TripDetailSchema = TripSummarySchema.extend({
  notes: z.string().nullable().optional(),
  travelers: z.array(TripTravelerSchema).default([]),
  items: z.array(TripItemSchema).default([]),
  days: z.array(TripDaySchema).default([]),
  unscheduled_item_ids: z.array(z.string()).default([]),
});
export type TripDetail = z.infer<typeof TripDetailSchema>;

export const FromOfferResultSchema = z.object({ item: TripItemSchema, items: z.array(TripItemSchema) });

// ---- budget ----

export const BudgetCurrencyRowSchema = z.object({
  currency: z.string(),
  known: DecimalStringSchema,
  estimated: DecimalStringSchema,
  excluded: DecimalStringSchema,
  counted: DecimalStringSchema,
});
export type BudgetCurrencyRow = z.infer<typeof BudgetCurrencyRowSchema>;

export const BudgetSchema = z.object({
  trip_id: z.string(),
  budget: MoneySchema.nullable().optional(),
  totals: z.array(BudgetCurrencyRowSchema),
  by_kind: z.array(z.object({ kind: z.string(), item_count: z.number().int(), totals: z.array(BudgetCurrencyRowSchema) })).default([]),
  remaining: MoneySchema.nullable().optional(),
  remaining_reason: z.enum(['ok', 'no_budget', 'mixed_currencies']),
  over_budget: z.boolean().default(false),
  warnings: z.array(z.object({ code: z.string(), message: z.string(), item_ids: z.array(z.string()).default([]) })).default([]),
});
export type Budget = z.infer<typeof BudgetSchema>;

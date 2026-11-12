/**
 * Canonical offer contract — mirrors `apps/api/app/schemas/offers.py`.
 *
 * - `price.total` is the KNOWN total for the exact bundle; estimated/excluded
 *   components are listed separately and must be shown as such.
 * - `source.mode` (DEMO/LIVE/CACHED) must always be visible next to an offer.
 * - `details` is a discriminated union on `details.kind`.
 */
import { z } from 'zod';
import {
  CategorySchema,
  DataModeSchema,
  DecimalStringSchema,
  IsoDateSchema,
  IsoDateTimeSchema,
  MoneySchema,
} from './common';

export const PriceComponentKindSchema = z.enum(['base', 'tax', 'fee', 'extra', 'discount']);
export const CostStatusSchema = z.enum(['known', 'estimated', 'excluded']);
export type CostStatus = z.infer<typeof CostStatusSchema>;

export const PriceComponentSchema = z.object({
  label: z.string(),
  kind: PriceComponentKindSchema,
  amount: MoneySchema,
  status: CostStatusSchema.default('known'),
  included_in_total: z.boolean().default(true),
});
export type PriceComponent = z.infer<typeof PriceComponentSchema>;

export const PriceBreakdownSchema = z.object({
  total: MoneySchema,
  total_status: z.enum(['known', 'estimated']).default('known'),
  components: z.array(PriceComponentSchema).default([]),
  excluded_notes: z.array(z.string()).default([]),
  per_night: MoneySchema.nullable().optional(),
  per_person: MoneySchema.nullable().optional(),
  per_day: MoneySchema.nullable().optional(),
});
export type PriceBreakdown = z.infer<typeof PriceBreakdownSchema>;

export const SourceInfoSchema = z.object({
  provider_id: z.string(),
  provider_name: z.string(),
  mode: DataModeSchema,
  fetched_at: IsoDateTimeSchema,
  expires_at: IsoDateTimeSchema.nullable().optional(),
  supplier_offer_id: z.string(),
  deep_link: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
});
export type SourceInfo = z.infer<typeof SourceInfoSchema>;

export const CancellationPolicySchema = z.object({
  refundable: z.boolean().nullable().optional(), // null = unknown
  free_cancellation_until: IsoDateTimeSchema.nullable().optional(),
  changeable: z.boolean().nullable().optional(),
  change_fee: MoneySchema.nullable().optional(),
  policy_text: z.string().nullable().optional(),
});
export type CancellationPolicy = z.infer<typeof CancellationPolicySchema>;

// ---------- flight ----------
export const FlightSegmentSchema = z.object({
  carrier_code: z.string(),
  carrier_name: z.string(),
  flight_number: z.string(),
  origin: z.string(),
  origin_name: z.string().nullable().optional(),
  destination: z.string(),
  destination_name: z.string().nullable().optional(),
  departing_at: IsoDateTimeSchema, // local wall-clock WITH offset
  arriving_at: IsoDateTimeSchema,
  duration_minutes: z.number().int(),
  cabin: z.string(),
  aircraft: z.string().nullable().optional(),
  operating_carrier_name: z.string().nullable().optional(),
});
export type FlightSegment = z.infer<typeof FlightSegmentSchema>;

export const FlightSliceSchema = z.object({
  origin: z.string(),
  destination: z.string(),
  departing_at: IsoDateTimeSchema,
  arriving_at: IsoDateTimeSchema,
  duration_minutes: z.number().int(),
  stops: z.number().int(),
  segments: z.array(FlightSegmentSchema),
  layovers_minutes: z.array(z.number().int()).default([]),
});
export type FlightSlice = z.infer<typeof FlightSliceSchema>;

export const BaggageSchema = z.object({
  personal_item: z.boolean().default(true),
  carry_on_included: z.number().int().nullable().optional(), // null = unknown
  checked_included: z.number().int().nullable().optional(),
  checked_bag_weight_kg: z.number().int().nullable().optional(),
  notes: z.string().nullable().optional(),
});
export type Baggage = z.infer<typeof BaggageSchema>;

export const FlightDetailsSchema = z.object({
  kind: z.literal('flight'),
  slices: z.array(FlightSliceSchema),
  cabin: z.string(),
  fare_brand: z.string().nullable().optional(),
  baggage: BaggageSchema,
  passengers: z.record(z.string(), z.number().int()),
  validating_carrier: z.string().nullable().optional(),
  total_duration_minutes: z.number().int(),
  max_stops: z.number().int(),
});
export type FlightDetails = z.infer<typeof FlightDetailsSchema>;

// ---------- hotel ----------
export const BoardSchema = z.enum(['room_only', 'breakfast', 'half_board', 'full_board', 'all_inclusive']);
export type Board = z.infer<typeof BoardSchema>;

export const HotelDetailsSchema = z.object({
  kind: z.literal('hotel'),
  hotel_name: z.string(),
  hotel_id: z.string(),
  star_rating: z.number().nullable().optional(),
  guest_rating: z.number().nullable().optional(), // 0-10
  review_count: z.number().int().nullable().optional(),
  address: z.string().nullable().optional(),
  city: z.string(),
  country_code: z.string().nullable().optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  distance_to_center_km: z.number().nullable().optional(),
  room_name: z.string(),
  board: BoardSchema,
  check_in: IsoDateSchema,
  check_out: IsoDateSchema,
  nights: z.number().int(),
  rooms: z.number().int(),
  adults: z.number().int(),
  children: z.number().int(),
  amenities: z.array(z.string()).default([]),
  kosher_info: z.string().nullable().optional(), // only when supplier states it
  accessibility_features: z.array(z.string()).default([]),
});
export type HotelDetails = z.infer<typeof HotelDetailsSchema>;

// ---------- car ----------
export const CarDetailsSchema = z.object({
  kind: z.literal('car'),
  vendor: z.string(),
  car_class: z.string(),
  model_example: z.string(),
  transmission: z.enum(['manual', 'automatic']),
  seats: z.number().int(),
  bags: z.number().int(),
  air_conditioning: z.boolean().default(true),
  fuel_policy: z.string().nullable().optional(),
  mileage: z.string().nullable().optional(),
  pickup_location: z.string(),
  dropoff_location: z.string(),
  pickup_at: IsoDateTimeSchema,
  dropoff_at: IsoDateTimeSchema,
  rental_days: z.number().int(),
  driver_min_age: z.number().int().nullable().optional(),
  young_driver_fee_applies: z.boolean().nullable().optional(),
  insurance_included: z.array(z.string()).default([]),
  deposit: MoneySchema.nullable().optional(),
});
export type CarDetails = z.infer<typeof CarDetailsSchema>;

// ---------- activity ----------
export const ActivityDetailsSchema = z.object({
  kind: z.literal('activity'),
  name: z.string(),
  activity_id: z.string(),
  category: z.string(),
  city: z.string(),
  description: z.string().nullable().optional(),
  duration_minutes: z.number().int().nullable().optional(),
  available_dates: z.array(IsoDateSchema).default([]),
  start_times: z.array(z.string()).default([]),
  languages: z.array(z.string()).default([]),
  meeting_point: z.string().nullable().optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  rating: z.number().nullable().optional(), // 0-5
  review_count: z.number().int().nullable().optional(),
  family_friendly: z.boolean().nullable().optional(),
  min_age: z.number().int().nullable().optional(),
  accessibility_features: z.array(z.string()).default([]),
  participants: z.record(z.string(), z.number().int()).default({}),
});
export type ActivityDetails = z.infer<typeof ActivityDetailsSchema>;

export const OfferDetailsSchema = z.discriminatedUnion('kind', [
  FlightDetailsSchema,
  HotelDetailsSchema,
  CarDetailsSchema,
  ActivityDetailsSchema,
]);
export type OfferDetails = z.infer<typeof OfferDetailsSchema>;

export const ScoreBreakdownSchema = z.object({
  total: DecimalStringSchema,
  cost: DecimalStringSchema,
  convenience: DecimalStringSchema,
  flexibility: DecimalStringSchema,
  quality: DecimalStringSchema,
  weights: z.record(z.string(), z.number().int()),
  reasons: z.array(z.string()).default([]),
  rank: z.number().int().nullable().optional(),
  comparable: z.boolean().default(true),
});
export type ScoreBreakdown = z.infer<typeof ScoreBreakdownSchema>;

export const CanonicalOfferSchema = z.object({
  id: z.string(),
  category: CategorySchema,
  title: z.string(),
  subtitle: z.string().nullable().optional(),
  source: SourceInfoSchema,
  price: PriceBreakdownSchema,
  cancellation: CancellationPolicySchema,
  details: OfferDetailsSchema,
  dedupe_key: z.string(),
  also_offered_by: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
  score: ScoreBreakdownSchema.nullable().optional(),
});
export type CanonicalOffer = z.infer<typeof CanonicalOfferSchema>;

/** Narrowing helpers for `details`. */
export type OfferOf<K extends OfferDetails['kind']> = CanonicalOffer & {
  details: Extract<OfferDetails, { kind: K }>;
};
export function isOfferKind<K extends OfferDetails['kind']>(offer: CanonicalOffer, kind: K): offer is OfferOf<K> {
  return offer.details.kind === kind;
}

export const ConvertedAmountSchema = z.object({
  original: MoneySchema,
  converted: MoneySchema,
  rate: DecimalStringSchema,
  rate_source: z.string(),
  rate_mode: DataModeSchema,
  rate_timestamp: IsoDateTimeSchema,
});
export type ConvertedAmount = z.infer<typeof ConvertedAmountSchema>;

/** Default comparison weights (see Help page): cost 40, convenience 25, flexibility 20, quality 15. */
export const DEFAULT_RANKING_WEIGHTS = { cost: 40, convenience: 25, flexibility: 20, quality: 15 } as const;

// ---------- comparison (POST /api/comparisons, GET /api/fx/rates) ----------
export const ComparisonGroupSchema = z.object({
  category: CategorySchema,
  currency: z.string(),
  offers: z.array(CanonicalOfferSchema),
  cheapest_offer_id: z.string().nullable().optional(),
  /** DEMO FX conversions into the display currency — display only, never used for ranking. Keyed by offer id. */
  display_conversions: z.record(z.string(), ConvertedAmountSchema).default({}),
});
export type ComparisonGroup = z.infer<typeof ComparisonGroupSchema>;

export const ComparisonResultSchema = z.object({
  groups: z.array(ComparisonGroupSchema),
  weights: z.record(z.string(), z.number().int()),
  notes: z.array(z.string()).default([]),
});
export type ComparisonResult = z.infer<typeof ComparisonResultSchema>;

export const FxRatesSchema = z.object({
  mode: DataModeSchema,
  source: z.string(),
  as_of: IsoDateTimeSchema,
  base: z.string(),
  rates: z.record(z.string(), DecimalStringSchema),
  note: z.string(),
});
export type FxRates = z.infer<typeof FxRatesSchema>;

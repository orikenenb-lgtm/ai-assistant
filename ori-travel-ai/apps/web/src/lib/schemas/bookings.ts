/** Booking-preparation contracts — mirrors `apps/api/app/modules/booking/schemas.py` (api-contract §3.5). */
import { z } from 'zod';
import { CategorySchema, IsoDateTimeSchema, MoneySchema, pageSchema } from './common';

export const BOOKING_STATES = [
  'DRAFT',
  'QUOTE_SELECTED',
  'REVALIDATING',
  'READY_FOR_APPROVAL',
  'APPROVED',
  'SUBMITTING',
  'CONFIRMED',
  'EXPIRED',
  'FAILED',
  'UNKNOWN',
  'CANCELLED',
] as const;
export type BookingState = (typeof BOOKING_STATES)[number];

export const EXECUTION_MODES = ['SIMULATION', 'HOSTED_CHECKOUT', 'LIVE'] as const;
export const ExecutionModeSchema = z.enum(EXECUTION_MODES);
export type ExecutionMode = z.infer<typeof ExecutionModeSchema>;

export const SIMULATION_SCENARIOS = ['success', 'price_change', 'expired', 'supplier_failure', 'timeout_unknown'] as const;
export type SimulationScenario = (typeof SIMULATION_SCENARIOS)[number];

export const BookingCanSchema = z.object({
  edit_travelers: z.boolean().default(false),
  revalidate: z.boolean().default(false),
  approve: z.boolean().default(false),
  submit: z.boolean().default(false),
  reconcile: z.boolean().default(false),
  cancel: z.boolean().default(false),
  record_confirmation: z.boolean().default(false),
  open_checkout: z.boolean().default(false),
});
export type BookingCan = z.infer<typeof BookingCanSchema>;

export const BookingSummarySchema = z.object({
  id: z.string(),
  state: z.string(),
  state_label: z.string(),
  category: CategorySchema,
  title: z.string(),
  provider_id: z.string(),
  provider_name: z.string(),
  execution_mode: ExecutionModeSchema,
  is_simulation: z.boolean(),
  current_price: MoneySchema,
  price_changed: z.boolean(),
  offer_expired: z.boolean().default(false),
  travelers_count: z.number().int(),
  supplier_reference: z.string().nullable().optional(),
  trip_id: z.string().nullable().optional(),
  created_at: IsoDateTimeSchema,
  updated_at: IsoDateTimeSchema,
});
export type BookingSummary = z.infer<typeof BookingSummarySchema>;
export const BookingPageSchema = pageSchema(BookingSummarySchema);

export const BookingTravelerSchema = z.object({
  family_member_id: z.string(),
  display_name: z.string(),
  age_group: z.string(),
  is_minor: z.boolean().default(false),
});
export type BookingTraveler = z.infer<typeof BookingTravelerSchema>;

export const ApprovalSchema = z.object({
  id: z.string(),
  approved_by_id: z.string().nullable().optional(),
  approved_by: z.string().nullable().optional(),
  approved_at: IsoDateTimeSchema,
  expires_at: IsoDateTimeSchema,
  amount: MoneySchema,
  terms_hash: z.string(),
  valid: z.boolean(),
  invalidated_at: IsoDateTimeSchema.nullable().optional(),
  invalidation_reason: z.string().nullable().optional(),
  consumed_at: IsoDateTimeSchema.nullable().optional(),
});
export type Approval = z.infer<typeof ApprovalSchema>;

export const HistoryEntrySchema = z.object({
  from: z.string().nullable().optional(),
  to: z.string(),
  at: IsoDateTimeSchema,
  by: z.string().nullable().optional(),
  by_name: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
});
export type HistoryEntry = z.infer<typeof HistoryEntrySchema>;

export const ReservationSchema = z.object({
  id: z.string(),
  supplier_reference: z.string(),
  mode: z.string(),
  status: z.string(),
  amount: MoneySchema,
  confirmed_at: IsoDateTimeSchema,
  notes: z.string().nullable().optional(),
});
export type Reservation = z.infer<typeof ReservationSchema>;

export const BookingSchema = BookingSummarySchema.extend({
  offer_id: z.string().nullable().optional(),
  /** CanonicalOffer snapshot; parsed leniently in the UI (see `parseSnapshot`). */
  offer: z.record(z.string(), z.unknown()),
  travelers: z.array(BookingTravelerSchema),
  quoted_price: MoneySchema,
  simulation_scenario: z.string().nullable().optional(),
  terms_hash: z.string(),
  terms_summary: z.array(z.string()),
  approval: ApprovalSchema.nullable().optional(),
  can: BookingCanSchema,
  history: z.array(HistoryEntrySchema).default([]),
  failure_reason: z.string().nullable().optional(),
  reservation: ReservationSchema.nullable().optional(),
  revalidated_at: IsoDateTimeSchema.nullable().optional(),
  revalidation_fresh: z.boolean().default(false),
  offer_expires_at: IsoDateTimeSchema.nullable().optional(),
  submitted_at: IsoDateTimeSchema.nullable().optional(),
  created_by_id: z.string().nullable().optional(),
  created_by: z.string().nullable().optional(),
  version: z.number().int(),
  warnings: z.array(z.string()).default([]),
  notice: z.string().nullable().optional(),
  idempotent_replay: z.boolean().default(false),
});
export type Booking = z.infer<typeof BookingSchema>;

export const CheckoutLinkSchema = z.object({
  url: z.string(),
  provider_id: z.string(),
  provider_name: z.string(),
  instructions: z.string(),
  warnings: z.array(z.string()).default([]),
});
export type CheckoutLink = z.infer<typeof CheckoutLinkSchema>;

export interface BookingCreateBody {
  offer_id: string;
  traveler_member_ids: string[];
  trip_id?: string;
  simulation_scenario?: SimulationScenario;
}

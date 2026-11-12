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
  /** The supplier is a DEMO (fictional) provider: nothing real is booked or charged in any execution mode. */
  is_demo: z.boolean().default(false),
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
  /** DEMO supplier: `url` is the in-app page `/demo-supplier/checkout?ref=…` (same origin), never an external site. */
  is_demo: z.boolean().default(false),
});
export type CheckoutLink = z.infer<typeof CheckoutLinkSchema>;

/** The only relative checkout URL the client will ever follow — mirrors the server allowlist exactly. */
export const DEMO_CHECKOUT_URL_PATTERN = /^\/demo-supplier\/checkout\?ref=[A-Za-z0-9_-]{16,64}$/;
export const DEMO_CHECKOUT_REF_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

/** In-app DEMO supplier page payload (`GET /api/demo-supplier/checkout`). No payment fields exist. */
export const DemoCheckoutSchema = z.object({
  ref: z.string(),
  status: z.enum(['OPEN', 'COMPLETED', 'EXPIRED']),
  is_demo: z.literal(true),
  provider_id: z.string(),
  provider_name: z.string(),
  booking_id: z.string(),
  title: z.string(),
  summary: z.array(z.string()).default([]),
  price: MoneySchema,
  supplier_reference: z.string().nullable().optional(),
  recorded: z.boolean().default(false),
  can_complete: z.boolean().default(false),
  message: z.string(),
});
export type DemoCheckout = z.infer<typeof DemoCheckoutSchema>;

export interface BookingCreateBody {
  offer_id: string;
  traveler_member_ids: string[];
  trip_id?: string;
  simulation_scenario?: SimulationScenario;
  /** Optional choice between the modes the provider supports; the server validates it. Never LIVE. */
  execution_mode?: 'SIMULATION' | 'HOSTED_CHECKOUT';
}

/** Price alerts and snapshots — mirrors `apps/api/app/modules/price_tracking/schemas.py`. */
import { z } from 'zod';
import { CategorySchema, DataModeSchema, IsoDateTimeSchema, MoneySchema } from './common';
import { CanonicalOfferSchema } from './offers';

export const ALERT_STATUSES = ['NEVER', 'OK', 'FAILED', 'NO_RESULTS', 'EXPIRED'] as const;

export const AlertSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  owner_name: z.string().nullable().optional(),
  name: z.string(),
  category: CategorySchema,
  search_params: z.record(z.string(), z.unknown()),
  target_price: MoneySchema.nullable().optional(),
  currency: z.string(),
  is_active: z.boolean(),
  check_interval_minutes: z.number().int(),
  last_checked_at: IsoDateTimeSchema.nullable().optional(),
  next_check_at: IsoDateTimeSchema.nullable().optional(),
  last_best_price: MoneySchema.nullable().optional(),
  last_best_mode: DataModeSchema.nullable().optional(),
  last_status: z.string(),
  last_error: z.string().nullable().optional(),
  created_at: IsoDateTimeSchema,
  updated_at: IsoDateTimeSchema,
});
export type Alert = z.infer<typeof AlertSchema>;
export const AlertListSchema = z.array(AlertSchema);

export const SnapshotSchema = z.object({
  id: z.string(),
  alert_id: z.string().nullable().optional(),
  offer_id: z.string().nullable().optional(),
  provider_id: z.string().nullable().optional(),
  mode: DataModeSchema.nullable().optional(),
  price: MoneySchema.nullable().optional(),
  status: z.string(),
  error_message: z.string().nullable().optional(),
  captured_at: IsoDateTimeSchema,
});
export type Snapshot = z.infer<typeof SnapshotSchema>;
export const SnapshotListSchema = z.array(SnapshotSchema);

export const CheckResultSchema = z.object({
  status: z.string(),
  best_offer: CanonicalOfferSchema.nullable().optional(),
  triggered: z.boolean(),
  target_reached: z.boolean().default(false),
  snapshot: SnapshotSchema.nullable().optional(),
  alert: AlertSchema,
});
export type CheckResult = z.infer<typeof CheckResultSchema>;

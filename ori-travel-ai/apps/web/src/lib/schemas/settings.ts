/** Family settings — mirrors `apps/api/app/modules/settings/schemas.py`. */
import { z } from 'zod';

export const SettingsSchema = z.object({
  ranking_weights: z.record(z.string(), z.number().int()),
  scheduler: z.object({ enabled: z.boolean(), allowed_by_server: z.boolean() }),
  map: z.object({ enabled: z.boolean() }).catch({ enabled: false }),
  display: z.object({ currency: z.string() }),
  retention: z.object({ search_days: z.number().int(), audit_days: z.number().int() }),
  ai: z.object({
    provider: z.string(),
    configured: z.boolean(),
    model: z.string().nullable().optional(),
    paid_allowed: z.boolean(),
  }),
  booking: z.object({ live_execution: z.boolean().default(false) }),
  encryption_available: z.boolean(),
  live_providers_enabled: z.boolean(),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const RetentionRunSchema = z.object({
  search_requests_deleted: z.number().int(),
  offers_deleted: z.number().int(),
  audit_events_deleted: z.number().int(),
});
export type RetentionRun = z.infer<typeof RetentionRunSchema>;

/**
 * Provider status — mirrors `ProviderStatusOut` (contract §3.3) and
 * `apps/api/app/modules/providers/base.py`.
 *
 * B2's ProviderStatusOut (apps/api/app/modules/providers/schemas.py) sends the
 * key capability fields flattened AND the full `capabilities` object. The schema
 * tolerates either; prefer `providerDisplayName()` / `providerMode()` helpers.
 */
import { z } from 'zod';
import { CategorySchema, DataModeSchema, IsoDateTimeSchema, ProviderHealthStatusSchema } from './common';

export const ProviderCapabilitiesSchema = z.object({
  provider_id: z.string(),
  display_name: z.string(),
  mode: DataModeSchema,
  categories: z.array(CategorySchema).default([]),
  supports_search: z.boolean().default(true),
  supports_revalidate: z.boolean().default(false),
  supports_booking_options: z.boolean().default(false),
  supports_hosted_checkout: z.boolean().default(false),
  supports_live_booking: z.boolean().default(false),
  requires_credentials: z.array(z.string()).default([]),
  official_docs_url: z.string().nullable().optional(),
  deep_link_domains: z.array(z.string()).default([]),
  rate_limit_note: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});
export type ProviderCapabilities = z.infer<typeof ProviderCapabilitiesSchema>;

export const ProviderHealthSchema = z.object({
  provider_id: z.string(),
  status: ProviderHealthStatusSchema,
  checked_at: IsoDateTimeSchema,
  message: z.string(),
  latency_ms: z.number().int().nullable().optional(),
});
export type ProviderHealth = z.infer<typeof ProviderHealthSchema>;

export const ProviderStatusSchema = z.object({
  provider_id: z.string(),
  display_name: z.string().optional(),
  mode: DataModeSchema.optional(),
  categories: z.array(CategorySchema).optional(),
  notes: z.string().nullable().optional(),
  official_docs_url: z.string().nullable().optional(),
  capabilities: ProviderCapabilitiesSchema.partial().optional(),
  status: ProviderHealthStatusSchema,
  enabled: z.boolean(),
  configured: z.boolean(),
  last_health: ProviderHealthSchema.nullable().optional(),
  requires_credentials: z.array(z.string()).default([]),
  setup_doc: z.string().nullable().optional(),
  setup_instructions: z.string().nullable().optional(), // Hebrew
  settings: z.record(z.string(), z.unknown()).default({}), // non-secret only
});
export type ProviderStatus = z.infer<typeof ProviderStatusSchema>;
export const ProviderStatusListSchema = z.array(ProviderStatusSchema);

export function providerDisplayName(p: ProviderStatus): string {
  return p.display_name ?? p.capabilities?.display_name ?? p.provider_id;
}

export function providerMode(p: ProviderStatus): 'DEMO' | 'LIVE' | 'CACHED' | undefined {
  return p.mode ?? p.capabilities?.mode;
}

export function providerCategories(p: ProviderStatus) {
  return p.categories ?? p.capabilities?.categories ?? [];
}

export function providerDocsUrl(p: ProviderStatus): string | null {
  return p.official_docs_url ?? p.capabilities?.official_docs_url ?? null;
}

export function providerRateLimitNote(p: ProviderStatus): string | null {
  return p.capabilities?.rate_limit_note ?? null;
}

// ---- GET /api/providers/diagnostics (editor+) ----
export const ProviderLastErrorSchema = z.object({
  code: z.string().nullable().optional(),
  message: z.string().nullable().optional(),
  at: IsoDateTimeSchema,
});

export const ProviderDiagnosticsSchema = z.object({
  provider_id: z.string(),
  display_name: z.string(),
  mode: DataModeSchema,
  status: ProviderHealthStatusSchema,
  runs: z.number().int(),
  ok_runs: z.number().int(),
  failed_runs: z.number().int(),
  timeout_runs: z.number().int(),
  cached_runs: z.number().int(),
  skipped_runs: z.number().int(),
  success_rate: z.string().nullable().optional(), // percent 0-100 as decimal string
  avg_latency_ms: z.number().int().nullable().optional(),
  last_error: ProviderLastErrorSchema.nullable().optional(),
  last_run_at: IsoDateTimeSchema.nullable().optional(),
  last_run_status: z.string().nullable().optional(),
});
export type ProviderDiagnostics = z.infer<typeof ProviderDiagnosticsSchema>;

export const DiagnosticsSchema = z.object({
  window_days: z.number().int(),
  generated_at: IsoDateTimeSchema,
  providers: z.array(ProviderDiagnosticsSchema),
});
export type Diagnostics = z.infer<typeof DiagnosticsSchema>;

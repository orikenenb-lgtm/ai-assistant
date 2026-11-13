/** Providers API (contract §3.3, owner B2). */
import { api } from '@/lib/api';
import { DiagnosticsSchema, ProviderHealthSchema, ProviderStatusListSchema, ProviderStatusSchema } from '@/lib/schemas/providers';

export const providerKeys = {
  all: ['providers'] as const,
  list: ['providers', 'list'] as const,
  diagnostics: (days: number) => ['providers', 'diagnostics', days] as const,
};

export function fetchProviders() {
  return api.get('/api/providers', { schema: ProviderStatusListSchema });
}

/** editor+ */
export function fetchDiagnostics(days = 30) {
  return api.get('/api/providers/diagnostics', { schema: DiagnosticsSchema, query: { days } });
}

/** editor+ — rate limited (10 per 5 minutes). */
export function runHealthCheck(providerId: string) {
  return api.post(`/api/providers/${encodeURIComponent(providerId)}/health-check`, undefined, { schema: ProviderHealthSchema });
}

/** owner only. */
export function updateProvider(providerId: string, body: { enabled: boolean }) {
  return api.put(`/api/providers/${encodeURIComponent(providerId)}`, body, { schema: ProviderStatusSchema });
}

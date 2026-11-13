/** Comparison + FX API (contract §3.3: POST /api/comparisons, GET /api/fx/rates). */
import { api } from '@/lib/api';
import { ComparisonResultSchema, FxRatesSchema } from '@/lib/schemas/offers';

export const compareKeys = {
  all: ['compare'] as const,
  result: (ids: string[], weights?: string) => ['compare', 'result', ids, weights ?? null] as const,
  fx: ['compare', 'fx'] as const,
};

export function postComparison(offerIds: string[], weights?: Record<string, number>, signal?: AbortSignal) {
  return api.post('/api/comparisons', { offer_ids: offerIds, ...(weights ? { weights } : {}) }, { schema: ComparisonResultSchema, signal });
}

export function fetchFxRates() {
  return api.get('/api/fx/rates', { schema: FxRatesSchema });
}

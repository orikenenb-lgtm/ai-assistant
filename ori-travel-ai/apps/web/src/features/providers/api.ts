/** Providers API (contract §3.3, owner B2). */
import { api } from '@/lib/api';
import { ProviderStatusListSchema } from '@/lib/schemas/providers';

export const providerKeys = {
  all: ['providers'] as const,
  list: ['providers', 'list'] as const,
};

export function fetchProviders() {
  return api.get('/api/providers', { schema: ProviderStatusListSchema });
}

import { useQuery } from '@tanstack/react-query';
import { providerMode, type ProviderStatus } from '@/lib/schemas/providers';
import { fetchProviders, providerKeys } from './api';

export function useProviders() {
  return useQuery({ queryKey: providerKeys.list, queryFn: fetchProviders, staleTime: 60_000 });
}

/**
 * Global data-honesty summary:
 * - "DEMO": no usable LIVE provider (default; also when status is unknown)
 * - "MIXED": at least one usable LIVE provider plus enabled DEMO providers
 * - "LIVE": only LIVE providers enabled
 */
export type DataModeSummary = { mode: 'DEMO' | 'MIXED' | 'LIVE'; known: boolean; liveCount: number; demoCount: number };

export function summarizeDataMode(providers: ProviderStatus[] | undefined): DataModeSummary {
  if (!providers) return { mode: 'DEMO', known: false, liveCount: 0, demoCount: 0 };
  const usable = providers.filter(
    (p) => p.enabled && p.configured && p.status !== 'DISABLED' && p.status !== 'NOT_CONFIGURED' && p.status !== 'FAILED',
  );
  const liveCount = usable.filter((p) => providerMode(p) === 'LIVE').length;
  const demoCount = usable.filter((p) => providerMode(p) !== 'LIVE').length;
  const mode = liveCount === 0 ? 'DEMO' : demoCount > 0 ? 'MIXED' : 'LIVE';
  return { mode, known: true, liveCount, demoCount };
}

export function useDataModeSummary(): DataModeSummary {
  const { data } = useProviders();
  return summarizeDataMode(data);
}

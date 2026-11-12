import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui';
import { isApiError } from '@/lib/api';
import { providerMode, type ProviderStatus } from '@/lib/schemas/providers';
import { fetchDiagnostics, fetchProviders, providerKeys, runHealthCheck, updateProvider } from './api';

export function useProviders() {
  return useQuery({ queryKey: providerKeys.list, queryFn: fetchProviders, staleTime: 60_000 });
}

export function useDiagnostics(enabled: boolean, days = 30) {
  return useQuery({ queryKey: providerKeys.diagnostics(days), queryFn: () => fetchDiagnostics(days), enabled, staleTime: 30_000 });
}

export function useHealthCheck() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: (providerId: string) => runHealthCheck(providerId),
    onSuccess: (h) => {
      void qc.invalidateQueries({ queryKey: providerKeys.all });
      toast({
        title: h.status === 'OK' ? 'הספק תקין' : h.status === 'NOT_CONFIGURED' ? 'הספק לא מחובר' : 'בדיקת התקינות הסתיימה',
        description: h.message,
        tone: h.status === 'OK' ? 'success' : h.status === 'DEGRADED' || h.status === 'NOT_CONFIGURED' ? 'warn' : h.status === 'FAILED' ? 'danger' : 'info',
      });
    },
    onError: (e) =>
      toast({
        title: 'בדיקת התקינות נכשלה',
        description: isApiError(e) ? e.message : 'נסו שוב.',
        tone: isApiError(e) && e.status === 429 ? 'warn' : 'danger',
      }),
  });
}

export function useUpdateProvider() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: ({ providerId, enabled }: { providerId: string; enabled: boolean }) => updateProvider(providerId, { enabled }),
    onSuccess: (_p, { enabled }) => {
      void qc.invalidateQueries({ queryKey: providerKeys.all });
      toast({ title: enabled ? 'הספק הופעל' : 'הספק הושבת', tone: 'success' });
    },
  });
}

/**
 * Global data-honesty summary:
 * - "DEMO": no usable LIVE provider (default; also when status is unknown)
 * - "MIXED": at least one usable LIVE provider plus enabled DEMO providers
 * - "LIVE": only LIVE providers enabled
 */
export type DataModeSummary = {
  /** SANDBOX = no live provider, but at least one real supplier API in its test environment. */
  mode: 'DEMO' | 'SANDBOX' | 'MIXED' | 'LIVE';
  known: boolean;
  liveCount: number;
  demoCount: number;
  sandboxCount: number;
};

export function summarizeDataMode(providers: ProviderStatus[] | undefined): DataModeSummary {
  if (!providers) return { mode: 'DEMO', known: false, liveCount: 0, demoCount: 0, sandboxCount: 0 };
  const usable = providers.filter(
    (p) => p.enabled && p.configured && p.status !== 'DISABLED' && p.status !== 'NOT_CONFIGURED' && p.status !== 'FAILED',
  );
  const liveCount = usable.filter((p) => providerMode(p) === 'LIVE').length;
  const sandboxCount = usable.filter((p) => providerMode(p) === 'SANDBOX').length;
  const demoCount = usable.filter((p) => providerMode(p) !== 'LIVE' && providerMode(p) !== 'SANDBOX').length;
  const mode = liveCount > 0 ? (demoCount + sandboxCount > 0 ? 'MIXED' : 'LIVE') : sandboxCount > 0 ? 'SANDBOX' : 'DEMO';
  return { mode, known: true, liveCount, demoCount, sandboxCount };
}

export function useDataModeSummary(): DataModeSummary {
  const { data } = useProviders();
  return summarizeDataMode(data);
}

/** Year scan API — cheapest day of the coming year for one trip length (DEMO + cached real offers only). */
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { FareCalendarResponseSchema, type YearScanRequest } from '@/lib/schemas/calendar';

export const yearScanKeys = {
  all: ['year-scan'] as const,
  scan: (req: YearScanRequest) => ['year-scan', req] as const,
};

/** POST /api/search/flight/year-scan — read-only; shares the calendar's per-user rate limit. */
export function fetchYearScan(req: YearScanRequest) {
  return api.post('/api/search/flight/year-scan', req, {
    schema: FareCalendarResponseSchema,
  });
}

/**
 * One scan per request. Rate limited server-side, so results are kept for 10 minutes and never refetched or retried
 * automatically (the error state offers an explicit retry).
 */
export function useYearScan(req: YearScanRequest | null) {
  return useQuery({
    queryKey: req ? yearScanKeys.scan(req) : [...yearScanKeys.all, 'disabled'],
    queryFn: () => fetchYearScan(req as YearScanRequest),
    enabled: !!req,
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

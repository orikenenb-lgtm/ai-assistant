import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { FareCalendarRequest } from '@/lib/schemas/calendar';
import { fareCalendarKeys, fetchFareCalendar } from './api';

/**
 * One calendar window. The endpoint is rate limited (10 / 10 min per user), so results are kept for 10 minutes, never
 * refetched on focus and never retried automatically — the error state offers an explicit retry.
 */
export function useFareCalendar(req: FareCalendarRequest | null) {
  return useQuery({
    queryKey: req ? fareCalendarKeys.calendar(req) : [...fareCalendarKeys.all, 'disabled'],
    queryFn: ({ signal }) => fetchFareCalendar(req as FareCalendarRequest, signal),
    enabled: !!req,
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

/**
 * `value` after it stopped changing for `ms` (the first value is returned immediately). Quick month / week clicks
 * therefore cost one calendar request, not one per click.
 */
export function useDebouncedValue<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}

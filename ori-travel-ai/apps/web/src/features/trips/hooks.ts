import { useQuery } from '@tanstack/react-query';
import type { TripSummary } from '@/lib/schemas/trips';
import { fetchTrips, tripKeys } from './api';

export function useTrips() {
  return useQuery({ queryKey: tripKeys.list, queryFn: fetchTrips });
}

/** Trips that have not ended yet (or have no dates), soonest first. */
export function upcomingTrips(trips: TripSummary[], today = new Date()): TripSummary[] {
  const todayIso = today.toISOString().slice(0, 10);
  return trips
    .filter((t) => !t.end_date || t.end_date >= todayIso)
    .sort((a, b) => (a.start_date ?? '9999').localeCompare(b.start_date ?? '9999'));
}

/** `GET /api/geo/airports` (contract V6 §3) — airport combobox + route-map coordinates. */
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api, isApiError } from '@/lib/api';
import { GeoAirportListSchema, type GeoAirport } from '@/lib/schemas/geo';
import { PLACES, placesFromGeo, type Place } from './airports';

export const geoKeys = {
  airports: ['geo', 'airports'] as const,
};

export function fetchAirports(signal?: AbortSignal) {
  return api.get('/api/geo/airports', { schema: GeoAirportListSchema, signal });
}

/** Static reference data: fetched once per session. A 404 (older server) is not retried. */
export function useAirports() {
  return useQuery({
    queryKey: geoKeys.airports,
    queryFn: ({ signal }) => fetchAirports(signal),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: (count, error) => !(isApiError(error) && error.status < 500) && count < 1,
    refetchOnWindowFocus: false,
  });
}

/** Places for the flight combobox: the server dataset when available, otherwise the bundled client list. */
export function useFlightPlaces(): readonly Place[] {
  const { data } = useAirports();
  return useMemo(() => (data && data.length > 0 ? placesFromGeo(data) : PLACES), [data]);
}

export type AirportIndex = ReadonlyMap<string, GeoAirport>;

/** Code → airport (with coordinates). `null` while loading or when the endpoint is unavailable (the map is then hidden). */
export function useAirportIndex(): AirportIndex | null {
  const { data } = useAirports();
  return useMemo(() => (data && data.length > 0 ? new Map(data.map((a) => [a.code, a])) : null), [data]);
}

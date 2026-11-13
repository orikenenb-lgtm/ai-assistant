/**
 * Geo contract — `GET /api/geo/airports` (docs/architecture/v6-flight-experience-contract.md §3).
 * Real airport coordinates from the backend's offline dataset; used by the airport combobox and the route map.
 */
import { z } from 'zod';
import { listOrPageSchema } from './common';

export const GeoAirportSchema = z.object({
  code: z.string(),
  city_code: z.string().nullable().optional(),
  name_he: z.string(),
  name_en: z.string(),
  city_he: z.string(),
  city_en: z.string(),
  country_code: z.string().nullable().optional(),
  lat: z.number(),
  lon: z.number(),
  timezone: z.string().nullable().optional(),
});
export type GeoAirport = z.infer<typeof GeoAirportSchema>;

/** Bare array per contract; a Page envelope is accepted too. */
export const GeoAirportListSchema = listOrPageSchema(GeoAirportSchema);

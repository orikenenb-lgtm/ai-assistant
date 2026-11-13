/** Route model for the map: one leg per flight segment, with airport coordinates from `/api/geo/airports`. */
import type { CanonicalOffer } from '@/lib/schemas/offers';
import type { GeoAirport } from '@/lib/schemas/geo';

export interface RoutePoint {
  code: string;
  city: string;
  name: string;
  lat: number;
  lon: number;
  role: 'origin' | 'destination' | 'stop';
}

export interface RouteLeg {
  sliceIndex: number;
  /** "הלוך" / "חזור" / "קטע 2". */
  sliceTitle: string;
  from: RoutePoint;
  to: RoutePoint;
  carrier: string;
  flight: string;
  durationMinutes: number;
}

export interface RouteModel {
  legs: RouteLeg[];
  /** Unique airports (origin, final destination, connections). */
  points: RoutePoint[];
  origin: RoutePoint;
  destination: RoutePoint;
}

function title(i: number, total: number): string {
  if (total === 2) return i === 0 ? 'הלוך' : 'חזור';
  if (total === 1) return 'טיסה';
  return `קטע ${i + 1}`;
}

/**
 * Builds the map model, or `null` when the offer is not a flight or ANY airport lacks coordinates
 * (the map is then hidden rather than drawn partially or with guessed positions).
 */
export function buildRoute(offer: CanonicalOffer, airports: ReadonlyMap<string, GeoAirport> | null): RouteModel | null {
  if (!airports || offer.details.kind !== 'flight') return null;
  const slices = offer.details.slices;
  if (slices.length === 0) return null;
  const firstOrigin = slices[0].origin;
  const outboundDestination = slices[0].destination;
  const points = new Map<string, RoutePoint>();
  const point = (code: string): RoutePoint | null => {
    const known = points.get(code);
    if (known) return known;
    const a = airports.get(code);
    if (!a) return null;
    const role: RoutePoint['role'] = code === firstOrigin ? 'origin' : code === outboundDestination ? 'destination' : 'stop';
    const p: RoutePoint = { code, city: a.city_he, name: a.name_he, lat: a.lat, lon: a.lon, role };
    points.set(code, p);
    return p;
  };
  const legs: RouteLeg[] = [];
  for (const [i, s] of slices.entries()) {
    for (const seg of s.segments) {
      const from = point(seg.origin);
      const to = point(seg.destination);
      if (!from || !to) return null;
      legs.push({
        sliceIndex: i,
        sliceTitle: title(i, slices.length),
        from,
        to,
        carrier: seg.carrier_name,
        flight: `${seg.carrier_code}${seg.flight_number}`,
        durationMinutes: seg.duration_minutes,
      });
    }
  }
  const origin = points.get(firstOrigin);
  const destination = points.get(outboundDestination);
  if (!origin || !destination || legs.length === 0) return null;
  return { legs, points: [...points.values()], origin, destination };
}

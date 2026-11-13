import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeFlightOffer } from '@/features/offers/testFixtures';
import { CanonicalOfferSchema } from '@/lib/schemas/offers';
import type { GeoAirport } from '@/lib/schemas/geo';
import { basemapPaths } from './basemap';
import RouteMap from './components/RouteMap';
import { distanceKm, fitViewBox, greatCircle, makeProjection, offsetPolyline, polylinePath } from './geometry';
import { buildRoute } from './legs';

const airport = (code: string, city_he: string, lat: number, lon: number): GeoAirport => ({
  code,
  city_code: code,
  name_he: `נמל התעופה ${city_he}`,
  name_en: code,
  city_he,
  city_en: code,
  country_code: 'XX',
  lat,
  lon,
  timezone: 'UTC',
});

const airports = new Map(
  [airport('TLV', 'תל אביב', 32.0114, 34.8867), airport('ATH', 'אתונה', 37.9364, 23.9445), airport('FCO', 'רומא', 41.8003, 12.2389)].map((a) => [
    a.code,
    a,
  ]),
);

const seg = (o: string, d: string, dep: string, arr: string, num: string) => ({
  carrier_code: 'D2',
  carrier_name: 'כחול-ים איירליינס (דמו)',
  flight_number: num,
  origin: o,
  destination: d,
  departing_at: dep,
  arriving_at: arr,
  duration_minutes: 120,
  cabin: 'economy',
});

/** TLV → ATH → FCO outbound (one stop), FCO → TLV direct return. */
const offer = CanonicalOfferSchema.parse({
  ...makeFlightOffer({ id: 'r1' }),
  title: 'תל אביב – רומא',
  details: {
    ...makeFlightOffer().details,
    slices: [
      {
        origin: 'TLV',
        destination: 'FCO',
        departing_at: '2026-12-10T08:00:00+02:00',
        arriving_at: '2026-12-10T13:00:00+01:00',
        duration_minutes: 360,
        stops: 1,
        segments: [
          seg('TLV', 'ATH', '2026-12-10T08:00:00+02:00', '2026-12-10T10:00:00+02:00', '101'),
          seg('ATH', 'FCO', '2026-12-10T11:30:00+02:00', '2026-12-10T13:00:00+01:00', '202'),
        ],
        layovers_minutes: [90],
      },
      {
        origin: 'FCO',
        destination: 'TLV',
        departing_at: '2026-12-15T14:00:00+01:00',
        arriving_at: '2026-12-15T18:40:00+02:00',
        duration_minutes: 220,
        stops: 0,
        segments: [seg('FCO', 'TLV', '2026-12-15T14:00:00+01:00', '2026-12-15T18:40:00+02:00', '303')],
        layovers_minutes: [],
      },
    ],
    max_stops: 1,
  },
});

describe('route geometry', () => {
  it('great circle runs between the endpoints and bows north on long east-west legs', () => {
    const pts = greatCircle({ lat: 32, lon: 34.9 }, { lat: 40.6, lon: -73.8 }, 32);
    expect(pts[0].lat).toBeCloseTo(32, 5);
    expect(pts.at(-1)!.lon).toBeCloseTo(-73.8, 5);
    expect(Math.max(...pts.map((p) => p.lat))).toBeGreaterThan(50);
    expect(distanceKm({ lat: 32.0114, lon: 34.8867 }, { lat: 41.8003, lon: 12.2389 })).toBeGreaterThan(2200);
  });

  it('splits paths at the antimeridian and offsets two-way lanes', () => {
    const proj = makeProjection(0);
    expect(
      polylinePath(
        [
          { lon: 179, lat: 0 },
          { lon: -179, lat: 0 },
        ],
        proj,
      ).match(/M/g),
    ).toHaveLength(2);
    const lane = offsetPolyline(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      1,
    );
    expect(lane[0].y).toBe(-1);
  });

  it('fits a padded viewbox with the requested aspect', () => {
    const proj = makeProjection(35);
    const vb = fitViewBox([proj.project({ lon: 34.9, lat: 32 }), proj.project({ lon: 12.2, lat: 41.8 })], proj, 1.7);
    expect(vb.width / vb.height).toBeCloseTo(1.7, 5);
    expect(vb.x).toBeLessThan(12.2 * proj.k);
    expect(vb.x + vb.width).toBeGreaterThan(34.9 * proj.k);
  });

  it('decodes the bundled Natural Earth basemap (no network)', () => {
    const paths = basemapPaths(makeProjection(35));
    expect(paths.land.length).toBeGreaterThan(10_000);
    expect(paths.borders.startsWith('M')).toBe(true);
  });
});

describe('buildRoute', () => {
  it('builds one leg per segment with stops, or null when coordinates are missing', () => {
    const route = buildRoute(offer, airports)!;
    expect(route.legs.map((l) => `${l.sliceTitle}:${l.from.code}-${l.to.code}`)).toEqual(['הלוך:TLV-ATH', 'הלוך:ATH-FCO', 'חזור:FCO-TLV']);
    expect(route.points.map((p) => `${p.code}:${p.role}`)).toEqual(['TLV:origin', 'ATH:stop', 'FCO:destination']);
    expect(buildRoute(offer, new Map([...airports].filter(([c]) => c !== 'ATH')))).toBeNull();
    expect(buildRoute(offer, null)).toBeNull();
  });
});

describe('RouteMap', () => {
  it('renders an accessible SVG with Hebrew labels and a text list of the legs', () => {
    render(<RouteMap route={buildRoute(offer, airports)!} subtitle={offer.title} />);
    const fig = screen.getByTestId('route-map');
    expect(within(fig).getByRole('heading', { name: 'מסלול על המפה' })).toBeInTheDocument();
    const img = within(fig).getByRole('img');
    expect(img).toHaveAccessibleName(/מפת מסלול: תל אביב אל רומא/);
    expect(img).toHaveAccessibleName(/הלוך: תל אביב אל רומא דרך אתונה/);
    expect(img).toHaveAccessibleName(/חזור: רומא אל תל אביב, ישירה/);
    expect(fig.querySelectorAll('svg path[d^="M"]').length).toBeGreaterThan(5);
    expect(within(img).getAllByText('אתונה').length).toBeGreaterThan(0);

    const legs = within(screen.getByTestId('route-legs')).getAllByRole('listitem');
    expect(legs).toHaveLength(3);
    expect(legs[0]).toHaveTextContent('הלוך: תל אביב (TLV) אל אתונה (ATH)');
    expect(legs[0]).toHaveTextContent('D2101');
    expect(legs[2]).toHaveTextContent('חזור: רומא (FCO) אל תל אביב (TLV)');
    expect(fig).toHaveTextContent('לא נתיב הטיסה בפועל');
  });
});

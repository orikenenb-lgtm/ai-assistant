/**
 * Simplified world basemap bundled at build time: Natural Earth 1:110m via `world-atlas` (ISC) decoded with
 * `topojson-client` (ISC). No tiles, no external requests. Paths are memoised per standard parallel.
 */
import { feature, mesh } from 'topojson-client';
import world from 'world-atlas/countries-110m.json';
import type { Geometry, MultiLineString, Position } from 'geojson';
import { polylinePath, type Projection } from './geometry';

function ringsOf(g: Geometry | null): Position[][] {
  if (!g) return [];
  switch (g.type) {
    case 'Polygon':
      return g.coordinates;
    case 'MultiPolygon':
      return g.coordinates.flat();
    case 'LineString':
      return [g.coordinates];
    case 'MultiLineString':
      return g.coordinates;
    case 'GeometryCollection':
      return g.geometries.flatMap(ringsOf);
    default:
      return [];
  }
}

function toPath(rings: Position[][], proj: Projection, close: boolean): string {
  return rings
    .map((r) =>
      polylinePath(
        r.map(([lon, lat]) => ({ lon, lat })),
        proj,
        close,
      ),
    )
    .join('');
}

let landRings: Position[][] | null = null;
let borderLines: Position[][] | null = null;

function decode() {
  if (!landRings) {
    landRings = feature(world, world.objects.land).features.flatMap((f) => ringsOf(f.geometry));
  }
  if (!borderLines) {
    const borders: MultiLineString = mesh(world, world.objects.countries, (a, b) => a !== b);
    borderLines = borders.coordinates;
  }
  return { landRings, borderLines };
}

const cache = new Map<number, { land: string; borders: string }>();

/** Land fill + interior country borders for a projection (keyed by its cos φ0). */
export function basemapPaths(proj: Projection): { land: string; borders: string } {
  const key = Math.round(proj.k * 1000);
  const hit = cache.get(key);
  if (hit) return hit;
  const { landRings: land, borderLines: borders } = decode();
  const out = { land: toPath(land, proj, true), borders: toPath(borders, proj, false) };
  cache.set(key, out);
  return out;
}

/**
 * Pure geometry for the route map (unit-tested; no DOM, no network).
 *
 * Projection: equirectangular with a standard parallel φ0 chosen per route (x = λ·cos φ0, y = −φ, degrees), which keeps
 * Mediterranean / European routes undistorted enough for a schematic map. Paths between airports are great circles.
 */

export interface LonLat {
  lon: number;
  lat: number;
}

export interface XY {
  x: number;
  y: number;
}

export interface Projection {
  /** cos φ0 */
  k: number;
  project: (p: LonLat) => XY;
}

const RAD = Math.PI / 180;

export function makeProjection(standardParallelDeg: number): Projection {
  const k = Math.cos(Math.min(70, Math.max(0, Math.abs(standardParallelDeg))) * RAD);
  return { k, project: ({ lon, lat }) => ({ x: lon * k, y: -lat }) };
}

/** Standard parallel for a set of points (mean |latitude|), rounded to 5° so the basemap path can be memoised. */
export function standardParallelFor(points: readonly LonLat[]): number {
  if (points.length === 0) return 35;
  const mean = points.reduce((a, p) => a + Math.abs(p.lat), 0) / points.length;
  return Math.round(Math.min(60, mean) / 5) * 5;
}

/** Great-circle interpolation (slerp) between two points, `n` segments (n + 1 points). */
export function greatCircle(a: LonLat, b: LonLat, n = 48): LonLat[] {
  const phi1 = a.lat * RAD;
  const lam1 = a.lon * RAD;
  const phi2 = b.lat * RAD;
  const lam2 = b.lon * RAD;
  const d =
    2 *
    Math.asin(
      Math.sqrt(Math.sin((phi2 - phi1) / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin((lam2 - lam1) / 2) ** 2),
    );
  if (!Number.isFinite(d) || d < 1e-9) return [a, b];
  const out: LonLat[] = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(phi1) * Math.cos(lam1) + B * Math.cos(phi2) * Math.cos(lam2);
    const y = A * Math.cos(phi1) * Math.sin(lam1) + B * Math.cos(phi2) * Math.sin(lam2);
    const z = A * Math.sin(phi1) + B * Math.sin(phi2);
    out.push({ lat: Math.atan2(z, Math.sqrt(x * x + y * y)) / RAD, lon: Math.atan2(y, x) / RAD });
  }
  return out;
}

/** Great-circle distance in km (display only). */
export function distanceKm(a: LonLat, b: LonLat): number {
  const phi1 = a.lat * RAD;
  const phi2 = b.lat * RAD;
  const h = Math.sin(((b.lat - a.lat) * RAD) / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(((b.lon - a.lon) * RAD) / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
}

const fmt = (n: number) => (Math.round(n * 100) / 100).toString();

/**
 * SVG path for a polyline of lon/lat points. A jump of more than 180° in longitude (antimeridian crossing) starts a
 * new sub-path instead of drawing a line across the whole map.
 */
export function polylinePath(points: readonly LonLat[], proj: Projection, close = false): string {
  let d = '';
  let prev: LonLat | null = null;
  for (const p of points) {
    const { x, y } = proj.project(p);
    const jump = prev !== null && Math.abs(p.lon - prev.lon) > 180;
    d += `${prev === null || jump ? 'M' : 'L'}${fmt(x)} ${fmt(y)}`;
    prev = p;
  }
  return close && d ? `${d}Z` : d;
}

/**
 * Parallel "lane" offset of a projected polyline (outbound and return legs share the same great circle; offsetting each
 * to its own left keeps both visible, like two-way traffic lanes).
 */
export function offsetPolyline(points: readonly XY[], distance: number): XY[] {
  if (points.length < 2 || distance === 0) return [...points];
  return points.map((p, i) => {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    // Left normal in SVG coordinates (y grows downward).
    return { x: p.x + (dy / len) * distance, y: p.y - (dx / len) * distance };
  });
}

export function xyPath(points: readonly XY[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${fmt(p.x)} ${fmt(p.y)}`).join('');
}

export interface ViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Viewbox around projected points: padded, at least `minSpan` wide, expanded to `aspect` (width / height) and clamped to
 * the projected world where possible.
 */
export function fitViewBox(points: readonly XY[], proj: Projection, aspect = 1.6, pad = 0.22, minSpan = 18): ViewBox {
  const worldW = 360 * proj.k;
  const worldMinX = -180 * proj.k;
  if (points.length === 0) return { x: worldMinX, y: -85, width: worldW, height: worldW / aspect };
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  let w = Math.max(maxX - minX, minSpan * proj.k);
  let h = Math.max(maxY - minY, (minSpan * proj.k) / aspect);
  w *= 1 + pad * 2;
  h *= 1 + pad * 2;
  if (w / h > aspect) h = w / aspect;
  else w = h * aspect;
  w = Math.min(w, worldW);
  h = Math.min(h, 170);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  let x = cx - w / 2;
  let y = cy - h / 2;
  x = Math.min(Math.max(x, worldMinX), worldMinX + worldW - w);
  y = Math.min(Math.max(y, -85), 85 - h);
  return { x, y, width: w, height: h };
}

/** Graticule lines (every `step` degrees) inside a lon/lat box, as one SVG path. */
export function graticulePath(proj: Projection, box: { lonMin: number; lonMax: number; latMin: number; latMax: number }, step = 10): string {
  const parts: string[] = [];
  const lon0 = Math.floor(box.lonMin / step) * step;
  const lat0 = Math.floor(box.latMin / step) * step;
  for (let lon = lon0; lon <= box.lonMax; lon += step) {
    parts.push(polylinePath([{ lon, lat: box.latMin }, { lon, lat: box.latMax }], proj));
  }
  for (let lat = lat0; lat <= box.latMax; lat += step) {
    parts.push(polylinePath([{ lon: box.lonMin, lat }, { lon: box.lonMax, lat }], proj));
  }
  return parts.join('');
}

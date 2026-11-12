import { useId, useMemo } from 'react';
import { cn } from '@/lib/cn';
import { formatDuration } from '@/lib/format';
import { basemapPaths } from '../basemap';
import {
  fitViewBox,
  graticulePath,
  greatCircle,
  makeProjection,
  offsetPolyline,
  standardParallelFor,
  xyPath,
  type XY,
} from '../geometry';
import type { RouteModel, RoutePoint } from '../legs';

export interface RouteMapProps {
  route: RouteModel;
  /** Offer title shown under the heading (e.g. "תל אביב – רומא · הלוך-חזור"). */
  subtitle?: string;
  className?: string;
}

const SLICE_STROKE = ['stroke-tangerine-600', 'stroke-sky-700', 'stroke-ink-600', 'stroke-ink-500'];
const SLICE_FILL = ['fill-tangerine-600', 'fill-sky-700', 'fill-ink-600', 'fill-ink-500'];
const SLICE_SWATCH = ['bg-tangerine-600', 'bg-sky-700', 'bg-ink-600', 'bg-ink-500'];

function chevron(points: readonly XY[], size: number): string | null {
  if (points.length < 3) return null;
  const i = Math.floor(points.length / 2);
  const a = points[i - 1];
  const b = points[i + 1];
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const p = points[i];
  const rot = (dx: number, dy: number) => `${(p.x + dx * Math.cos(angle) - dy * Math.sin(angle)).toFixed(3)} ${(p.y + dx * Math.sin(angle) + dy * Math.cos(angle)).toFixed(3)}`;
  return `M${rot(-size, -size * 0.8)}L${rot(size * 0.6, 0)}L${rot(-size, size * 0.8)}`;
}

function cityLabel(p: RoutePoint): string {
  return p.city || p.code;
}

/**
 * Schematic route map (pure SVG): bundled Natural Earth basemap, great-circle arcs for every segment of the offer
 * (outbound / return in their own lanes), airports labelled in Hebrew, and a text alternative listing the legs.
 */
export default function RouteMap({ route, subtitle, className }: RouteMapProps) {
  const headingId = useId();
  const titleId = useId();
  const descId = useId();

  const model = useMemo(() => {
    const proj = makeProjection(standardParallelFor(route.points));
    const arcs = route.legs.map((leg) => greatCircle(leg.from, leg.to, 48).map(proj.project));
    const all = [...arcs.flat(), ...route.points.map(proj.project)];
    const vb = fitViewBox(all, proj, 1.7);
    const lane = vb.width * 0.0065;
    const unit = vb.width / 100;
    const legs = route.legs.map((leg, i) => {
      // Lanes only when the same pair of airports is flown in both directions.
      const twoWay = route.legs.some((o) => o.from.code === leg.to.code && o.to.code === leg.from.code);
      const pts = twoWay ? offsetPolyline(arcs[i], lane) : arcs[i];
      return { leg, d: xyPath(pts), arrow: chevron(pts, unit * 1.1) };
    });
    const box = {
      lonMin: vb.x / proj.k,
      lonMax: (vb.x + vb.width) / proj.k,
      latMin: -(vb.y + vb.height),
      latMax: -vb.y,
    };
    const step = vb.width / proj.k > 60 ? 20 : vb.width / proj.k > 25 ? 10 : 5;
    const points = route.points.map((p) => {
      const xy = proj.project(p);
      const font = unit * (p.role === 'stop' ? 2.9 : 3.4);
      const nearTop = xy.y - vb.y < font * 3;
      const nearStart = xy.x - vb.x < font * 3;
      const nearEnd = vb.x + vb.width - xy.x < font * 3;
      return {
        p,
        xy,
        font,
        r: unit * (p.role === 'stop' ? 0.9 : 1.25),
        labelY: nearTop ? xy.y + font * 1.7 : xy.y - font * 1.25,
        codeY: nearTop ? xy.y + font * 2.7 : xy.y - font * 0.25 - unit * 1.2,
        anchor: (nearStart ? 'start' : nearEnd ? 'end' : 'middle') as 'start' | 'end' | 'middle',
      };
    });
    // Code under the city label (above the dot) unless the label sits below the dot.
    for (const pt of points) {
      if (pt.labelY < pt.xy.y) pt.codeY = pt.labelY + pt.font * 0.95;
    }
    return { proj, vb, legs, graticule: graticulePath(proj, box, step), base: basemapPaths(proj), points, unit };
  }, [route]);

  const slices = [...new Map(route.legs.map((l) => [l.sliceIndex, l.sliceTitle])).entries()];
  const via = route.points.filter((p) => p.role === 'stop');
  const svgTitle = `מפת מסלול: ${cityLabel(route.origin)} אל ${cityLabel(route.destination)}`;
  const svgDesc = slices
    .map(([i, t]) => {
      const legs = route.legs.filter((l) => l.sliceIndex === i);
      const stops = legs.slice(0, -1).map((l) => cityLabel(l.to));
      return `${t}: ${cityLabel(legs[0].from)} אל ${cityLabel(legs[legs.length - 1].to)}${stops.length ? ` דרך ${stops.join(', ')}` : ', ישירה'}`;
    })
    .join('. ');
  const { vb, unit } = model;

  return (
    <figure className={cn('flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-5', className)} data-testid="route-map" aria-labelledby={headingId}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id={headingId} className="text-sm font-semibold text-fg">
            מסלול על המפה
          </h2>
          {subtitle && <p className="truncate text-xs text-fg-muted">{subtitle}</p>}
        </div>
        <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted" aria-label="מקרא המפה">
          {slices.map(([i, t]) => (
            <li key={i} className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className={cn('h-1 w-5 rounded-full', SLICE_SWATCH[i] ?? SLICE_SWATCH[3])} />
              {t}
            </li>
          ))}
          {via.length > 0 && (
            <li className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="size-2 rounded-full bg-ink-600" />
              עצירת ביניים
            </li>
          )}
        </ul>
      </div>

      <div className="overflow-hidden rounded-xl border border-sky-100 bg-sky-50">
        <svg
          role="img"
          aria-labelledby={`${titleId} ${descId}`}
          viewBox={`${vb.x} ${vb.y} ${vb.width} ${vb.height}`}
          preserveAspectRatio="xMidYMid slice"
          className="block aspect-[1.7] h-auto w-full"
          style={{ direction: 'ltr' }}
        >
          <title id={titleId}>{svgTitle}</title>
          <desc id={descId}>{svgDesc}</desc>
          <path d={model.graticule} className="fill-none stroke-sky-100" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <path d={model.base.land} className="fill-ink-100 stroke-none" fillRule="evenodd" />
          <path d={model.base.borders} className="fill-none stroke-white" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          {model.legs.map(({ leg, d, arrow }, i) => (
            <g key={i} data-slice={leg.sliceIndex}>
              <path d={d} className="fill-none stroke-white" strokeWidth={5} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              <path
                d={d}
                className={cn('fill-none', SLICE_STROKE[leg.sliceIndex] ?? SLICE_STROKE[3])}
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeDasharray={leg.sliceIndex === 1 ? '6 5' : undefined}
                vectorEffect="non-scaling-stroke"
              />
              {arrow && (
                <path
                  d={arrow}
                  className={cn('fill-none', SLICE_STROKE[leg.sliceIndex] ?? SLICE_STROKE[3])}
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </g>
          ))}
          {model.points.map(({ p, xy, r }) => (
            <circle
              key={p.code}
              cx={xy.x}
              cy={xy.y}
              r={r}
              className={p.role === 'stop' ? 'fill-ink-600 stroke-white' : cn('fill-white', p.role === 'origin' ? 'stroke-tangerine-600' : 'stroke-sky-700')}
              strokeWidth={p.role === 'stop' ? 1.5 : 3}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {model.points.map(({ p, xy, font, labelY, codeY, anchor }) => (
            <g key={`l-${p.code}`} aria-hidden="true">
              <text
                x={xy.x}
                y={labelY}
                textAnchor={anchor}
                fontSize={font}
                fontWeight={p.role === 'stop' ? 500 : 700}
                className="fill-ink-900 stroke-white"
                strokeWidth={font * 0.28}
                paintOrder="stroke"
                strokeLinejoin="round"
              >
                {cityLabel(p)}
              </text>
              <text
                x={xy.x}
                y={codeY}
                textAnchor={anchor}
                fontSize={font * 0.62}
                fontWeight={600}
                letterSpacing={unit * 0.1}
                className={cn('stroke-white', p.role === 'stop' ? 'fill-ink-600' : SLICE_FILL[p.role === 'origin' ? 0 : 1])}
                strokeWidth={font * 0.2}
                paintOrder="stroke"
              >
                {p.code}
              </text>
            </g>
          ))}
        </svg>
      </div>

      <figcaption className="flex flex-col gap-2">
        <ol className="flex flex-col gap-1 text-xs text-fg-muted" data-testid="route-legs">
          {route.legs.map((l, i) => (
            <li key={i} className="flex flex-wrap items-baseline gap-x-1.5">
              <span className="font-semibold text-fg">{l.sliceTitle}:</span>
              <span>
                {cityLabel(l.from)} (<span dir="ltr">{l.from.code}</span>) אל {cityLabel(l.to)} (<span dir="ltr">{l.to.code}</span>)
              </span>
              <span className="text-fg-subtle">
                · {l.carrier} <span dir="ltr">{l.flight}</span> · {formatDuration(l.durationMinutes)}
              </span>
            </li>
          ))}
        </ol>
        <p className="text-2xs leading-relaxed text-fg-subtle">
          מפה סכמטית: הקווים הם קירוב (מסלול "מעגל גדול") בין שדות התעופה ולא נתיב הטיסה בפועל. מפת בסיס: Natural Earth.
        </p>
      </figcaption>
    </figure>
  );
}

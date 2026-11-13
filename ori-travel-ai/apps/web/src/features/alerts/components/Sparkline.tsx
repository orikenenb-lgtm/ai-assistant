import type { Snapshot } from '@/lib/schemas/alerts';
import { formatMoney } from '@/lib/format';

export interface SparkPoint {
  at: string;
  value: number;
}

/** Chronological numeric points from OK snapshots in one currency (presentation only — never used for money math). */
export function sparkPoints(snapshots: Snapshot[], currency: string): SparkPoint[] {
  return snapshots
    .filter((s) => s.status === 'OK' && s.price && s.price.currency === currency)
    .map((s) => ({ at: s.captured_at, value: Number(s.price!.amount) }))
    .filter((p) => Number.isFinite(p.value))
    .sort((a, b) => a.at.localeCompare(b.at));
}

export function sparkPath(points: SparkPoint[], w: number, h: number, pad = 4): string {
  if (points.length === 0) return '';
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = points.length > 1 ? (w - pad * 2) / (points.length - 1) : 0;
  return points
    .map((p, i) => {
      const x = points.length > 1 ? pad + i * step : w / 2;
      const y = h - pad - ((p.value - min) / span) * (h - pad * 2);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
}

/** Tiny inline price history (no chart library). Time flows left → right, as with all Latin-axis charts. */
export function Sparkline({ snapshots, currency, target }: { snapshots: Snapshot[]; currency: string; target?: string | null }) {
  const points = sparkPoints(snapshots, currency);
  const w = 160;
  const h = 40;
  if (points.length < 2) {
    return <p className="text-xs text-fg-subtle">דרושות לפחות שתי בדיקות מוצלחות כדי להציג מגמה.</p>;
  }
  const min = Math.min(...points.map((p) => p.value));
  const max = Math.max(...points.map((p) => p.value));
  const last = points[points.length - 1]!;
  const first = points[0]!;
  const dir = last.value < first.value ? 'ירד' : last.value > first.value ? 'עלה' : 'לא השתנה';
  const label = `מגמת מחיר: ${dir} מ-${formatMoney(String(first.value), currency) ?? ''} ל-${formatMoney(String(last.value), currency) ?? ''} ב-${points.length} בדיקות`;
  const d = sparkPath(points, w, h);
  const lastX = w - 4;
  const lastY = h - 4 - ((last.value - min) / (max - min || 1)) * (h - 8);
  void target;
  return (
    <figure className="flex items-center gap-3" dir="ltr">
      <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={label} className="shrink-0 overflow-visible">
        <path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-sea-600" />
        <circle cx={lastX} cy={lastY} r="3" className="fill-sea-700" />
      </svg>
      <figcaption className="text-xs text-fg-muted" dir="rtl">
        <span className="block">{label}</span>
        <span className="block text-fg-subtle">
          נמוך: {formatMoney(String(min), currency)} · גבוה: {formatMoney(String(max), currency)}
        </span>
      </figcaption>
    </figure>
  );
}

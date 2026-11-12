/** Ranking weights: 4 factors, integers summing to 100. */
import { DEFAULT_RANKING_WEIGHTS } from '@/lib/schemas/offers';
import { FACTOR_ORDER, type Factor } from '@/features/offers/labels';

export type Weights = Record<Factor, number>;

export const DEFAULT_WEIGHTS: Weights = { ...DEFAULT_RANKING_WEIGHTS };

export interface WeightPreset {
  id: string;
  label: string;
  description: string;
  weights: Weights;
}

export const WEIGHT_PRESETS: WeightPreset[] = [
  { id: 'default', label: 'ברירת מחדל', description: 'איזון: עלות 40, נוחות 25, גמישות 20, איכות 15', weights: { ...DEFAULT_WEIGHTS } },
  { id: 'cheap', label: 'הכי זול', description: 'מעדיף מחיר נמוך', weights: { cost: 70, convenience: 10, flexibility: 10, quality: 10 } },
  { id: 'comfort', label: 'הכי נוח', description: 'מעדיף ישירות, שעות נוחות ומיקום', weights: { cost: 20, convenience: 50, flexibility: 15, quality: 15 } },
  { id: 'flex', label: 'גמישות', description: 'מעדיף ביטול חינם ושינוי', weights: { cost: 20, convenience: 15, flexibility: 55, quality: 10 } },
  { id: 'quality', label: 'איכות', description: 'מעדיף דירוגים גבוהים', weights: { cost: 15, convenience: 20, flexibility: 15, quality: 50 } },
];

export function sumWeights(w: Weights): number {
  return FACTOR_ORDER.reduce((a, f) => a + w[f], 0);
}

export function weightsEqual(a: Record<string, number>, b: Record<string, number>): boolean {
  return FACTOR_ORDER.every((f) => a[f] === b[f]);
}

/** Server expects "cost:40,convenience:25,flexibility:20,quality:15". */
export function weightsToParam(w: Weights): string {
  return FACTOR_ORDER.map((f) => `${f}:${w[f]}`).join(',');
}

/** Coerce the server's weight map into a full Weights object (missing → 0). */
export function toWeights(w: Record<string, number>): Weights {
  return { cost: w.cost ?? 0, convenience: w.convenience ?? 0, flexibility: w.flexibility ?? 0, quality: w.quality ?? 0 };
}

/**
 * Set one factor and rebalance the others proportionally so the total stays exactly 100
 * (largest-remainder rounding; equal split when the others were all 0).
 */
export function rebalance(current: Weights, factor: Factor, value: number): Weights {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const others = FACTOR_ORDER.filter((f) => f !== factor);
  const remaining = 100 - v;
  const othersTotal = others.reduce((a, f) => a + current[f], 0);
  const raw = others.map((f) => (othersTotal > 0 ? (current[f] / othersTotal) * remaining : remaining / others.length));
  const floors = raw.map(Math.floor);
  let leftover = remaining - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (leftover <= 0) break;
    floors[i] += 1;
    leftover -= 1;
  }
  const next = { ...current, [factor]: v } as Weights;
  others.forEach((f, i) => {
    next[f] = floors[i];
  });
  return next;
}

/** Small, pure metric helpers shared by the analytics service and UI. */

/** won / (won + lost); null when nothing closed. */
export function winRate(won: number, lost: number): number | null {
  const closed = won + lost;
  return closed === 0 ? null : won / closed;
}

/** Expected value of a deal: value × probability (deal override, else stage default). */
export function weightedValueCents(valueCents: number, dealProbability: number | null, stageProbability: number): number {
  const p = dealProbability ?? stageProbability;
  return Math.round((valueCents * Math.min(100, Math.max(0, p))) / 100);
}

/** Relative change; null when the baseline is zero (undefined growth). */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return (current - previous) / previous;
}

export function ratio(part: number, whole: number): number | null {
  return whole === 0 ? null : part / whole;
}

/** Median of a numeric list (null when empty). */
export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Keeps the `keep` largest categories and folds the rest into "other". */
export function topNWithOther<T extends { key: string; value: number }>(items: T[], keep: number, otherKey = "__other"): { key: string; value: number }[] {
  const sorted = [...items].sort((a, b) => b.value - a.value);
  if (sorted.length <= keep) return sorted.map(({ key, value }) => ({ key, value }));
  const head = sorted.slice(0, keep).map(({ key, value }) => ({ key, value }));
  const rest = sorted.slice(keep).reduce((sum, i) => sum + i.value, 0);
  return rest > 0 ? [...head, { key: otherKey, value: rest }] : head;
}

/** Human duration from seconds, e.g. 95 → {value: 1.6, unit: "minute"}. */
export function durationParts(seconds: number): { value: number; unit: "second" | "minute" | "hour" | "day" } {
  if (seconds < 60) return { value: Math.round(seconds), unit: "second" };
  if (seconds < 3600) return { value: Math.round((seconds / 60) * 10) / 10, unit: "minute" };
  if (seconds < 86400) return { value: Math.round((seconds / 3600) * 10) / 10, unit: "hour" };
  return { value: Math.round((seconds / 86400) * 10) / 10, unit: "day" };
}

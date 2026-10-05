import type { LevelSource } from './types';

/**
 * עזרי עוצמה ו-waveform משותפים להקלטה ולהשמעה.
 * הכול נגזר מאות אמיתי (AnalyserNode או דגימות שנקלטו) — אין כאן ערכים מדומים.
 */

/** טווח הדציבלים שממופה ל-0..1: ‎-60dBFS (כמעט שקט) עד 0dBFS (מקסימום). */
const LEVEL_FLOOR_DB = -60;

export function rmsOf(samples: Float32Array, start = 0, end = samples.length): number {
  const from = Math.max(0, start);
  const to = Math.min(samples.length, end);
  if (to <= from) return 0;
  let sum = 0;
  for (let i = from; i < to; i++) {
    const v = samples[i] ?? 0;
    sum += v * v;
  }
  return Math.sqrt(sum / (to - from));
}

/** ממפה RMS לסקאלה לוגריתמית 0..1 שמתאימה לאנימציה (העין והאוזן שומעות בדציבלים). */
export function rmsToLevel(rms: number): number {
  if (!(rms > 0) || !Number.isFinite(rms)) return 0;
  const db = 20 * Math.log10(rms);
  const level = (db - LEVEL_FLOOR_DB) / -LEVEL_FLOOR_DB;
  return Math.min(1, Math.max(0, level));
}

/** מעתיק את source ל-target, ומותח/מכווץ באינטרפולציה לינארית אם האורכים שונים. */
export function stretchInto(source: Float32Array, target: Float32Array): void {
  const n = target.length;
  if (n === 0) return;
  if (source.length === 0) {
    target.fill(0);
    return;
  }
  if (source.length === n) {
    target.set(source);
    return;
  }
  if (n === 1) {
    target[0] = source[0] ?? 0;
    return;
  }
  const scale = (source.length - 1) / (n - 1);
  for (let i = 0; i < n; i++) {
    const pos = i * scale;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const a = source[idx] ?? 0;
    const b = source[Math.min(idx + 1, source.length - 1)] ?? a;
    target[i] = a + (b - a) * frac;
  }
}

/** מקור עוצמה מעל AnalyserNode אמיתי. */
export function analyserLevelSource(analyser: AnalyserNode): LevelSource {
  const scratch = new Float32Array(analyser.fftSize);
  return {
    getLevel() {
      analyser.getFloatTimeDomainData(scratch);
      return rmsToLevel(rmsOf(scratch));
    },
    getWaveform(target: Float32Array) {
      analyser.getFloatTimeDomainData(scratch);
      stretchInto(scratch, target);
      return true;
    },
  };
}

/** מקור "כבוי": אין אות פעיל, ולכן גם אין waveform. */
export const SILENT_LEVEL_SOURCE: LevelSource = {
  getLevel: () => 0,
  getWaveform: () => false,
};

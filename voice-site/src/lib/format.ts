const ils = new Intl.NumberFormat("he-IL", { maximumFractionDigits: 0 });
const num = new Intl.NumberFormat("he-IL", { maximumFractionDigits: 1 });

/** "₪1,290" — the shekel sign before the number, as Israeli price tags read. */
export function formatIls(value: number): string {
  const sign = value < 0 ? "-" : "";
  return `${sign}₪${ils.format(Math.abs(Math.round(value)))}`;
}

const ilsPrecise = new Intl.NumberFormat("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** Like formatIls but keeps agorot, for per-minute prices such as ₪1.9. */
export function formatIlsPrecise(value: number): string {
  return `₪${ilsPrecise.format(value)}`;
}

/**
 * Price inside running Hebrew text: "490 ש״ח". A bare "₪490" next to Latin words
 * (plan names) gets reordered by the bidi algorithm; the Hebrew unit never does.
 */
export function formatIlsText(value: number): string {
  return `${ilsPrecise.format(value)} ש״ח`;
}

export function formatNumber(value: number): string {
  return num.format(value);
}

export function formatMinutes(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

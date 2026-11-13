/** Date/time helpers for trip forms. Wall-clock values are interpreted in an explicit IANA zone. */

const partsCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = partsCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    partsCache.set(timeZone, f);
  }
  return f;
}

/** ISO instant → "YYYY-MM-DDTHH:mm" wall clock in `timeZone` (for `<input type="datetime-local">`). */
export function toLocalInput(iso: string | null | undefined, timeZone: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = formatterFor(timeZone || 'UTC').formatToParts(d);
  } catch {
    parts = formatterFor('UTC').formatToParts(d);
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

const AMOUNT_RE = /^\d{1,9}(\.\d{1,2})?$/;

/** Accepts "12", "12.5", "12,50" → canonical "12.50"-style decimal string, or null when invalid. */
export function normalizeAmount(raw: string): string | null {
  const v = raw.trim().replace(',', '.');
  return AMOUNT_RE.test(v) ? v : null;
}

export function todayIso(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** True for "0", "0.00", "-0" … (decimal strings; no float math). */
export function isZeroAmount(v: string): boolean {
  return /^-?0+(\.0+)?$/.test(v.trim());
}

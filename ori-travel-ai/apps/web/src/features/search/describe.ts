import { formatDate, formatDateRange } from '@/lib/format';
import type { Category } from '@/lib/schemas/common';

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function range(a: unknown, b: unknown): string | null {
  const s = str(a);
  const e = str(b);
  if (s && e) return formatDateRange(s.slice(0, 10), e.slice(0, 10), 'date-short');
  if (s) return formatDate(s.slice(0, 10), 'date-short');
  return null;
}

/** Short Hebrew summary of saved search params, e.g. "TLV → ATH · 12–19 בדצמ׳". Defensive: params are untyped. */
export function describeSearchParams(category: Category, params: Record<string, unknown>): string {
  const parts: string[] = [];
  switch (category) {
    case 'flight': {
      const o = str(params.origin);
      const d = str(params.destination);
      if (o && d) parts.push(`${o} → ${d}`); // Latin codes render LTR
      const when = range(params.depart_date, params.return_date);
      if (when) parts.push(when);
      break;
    }
    case 'hotel':
    case 'activity': {
      const dest = str(params.destination);
      if (dest) parts.push(dest);
      const when = category === 'hotel' ? range(params.check_in, params.check_out) : range(params.date_from, params.date_to);
      if (when) parts.push(when);
      break;
    }
    case 'car': {
      const pickup = str(params.pickup_location);
      if (pickup) parts.push(pickup);
      const when = range(params.pickup_at, params.dropoff_at);
      if (when) parts.push(when);
      break;
    }
  }
  return parts.join(' · ') || 'חיפוש';
}

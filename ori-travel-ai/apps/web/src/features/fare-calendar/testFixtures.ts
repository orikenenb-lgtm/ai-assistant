import { addDaysIso } from '@/features/search/forms/common';
import type { FareCalendarRequest, FareCell } from '@/lib/schemas/calendar';

/** Search params of a TLV→FCO round trip, 10–15 Dec 2026, 2 adults + 1 child. */
export const calendarSearchParams: Record<string, unknown> = {
  category: 'flight',
  origin: 'TLV',
  destination: 'FCO',
  depart_date: '2026-12-10',
  return_date: '2026-12-15',
  flex_days: 0,
  adults: 2,
  children_ages: [7],
  cabin: 'economy',
  max_stops: null,
  checked_bags: 0,
  preferred_departure_window: 'any',
  currency: 'ILS',
  max_price: null,
};

/**
 * Deterministic calendar response for any request: day-of-month 6 = no_offers, 7 = not_searched, 8 = error,
 * everything else priced (cheapest on the 3rd → `best`).
 */
export function calendarResponse(req: FareCalendarRequest) {
  const departs: string[] = [];
  for (let d = req.depart_from; d <= req.depart_to; d = addDaysIso(d, 1)) departs.push(d);
  const nightsAxis = req.trip_nights.length ? req.trip_nights : [null];
  const travelers = req.adults + req.children_ages.length;
  const cells: FareCell[] = [];
  for (const depart of departs) {
    for (const nights of nightsAxis) {
      const day = Number(depart.slice(8, 10));
      const ret = nights == null ? null : addDaysIso(depart, nights);
      const base = { depart_date: depart, return_date: ret, nights, travelers };
      if (day === 6) cells.push({ ...base, status: 'no_offers', offers_count: 0, message: 'אין טיסות בתאריך זה אצל ספקי ההדגמה' });
      else if (day === 7) cells.push({ ...base, status: 'not_searched', offers_count: 0, message: 'לא נבדק' });
      else if (day === 8) cells.push({ ...base, status: 'error', offers_count: 0, message: 'הספק לא ענה' });
      else {
        const amount = day === 3 ? '2100.00' : `${2400 + day * 10 + (nights ?? 0)}.50`;
        cells.push({
          ...base,
          status: 'priced',
          min_total: { amount, currency: 'ILS' },
          per_person: { amount: day === 3 ? '700.00' : '810.17', currency: 'ILS' },
          tier: day === 3 ? 'best' : day < 12 ? 'low' : day < 22 ? 'mid' : 'high',
          mode: 'DEMO',
          provider_id: 'demo_skyline',
          provider_name: 'דמו סקייליין',
          offers_count: 5,
          fetched_at: '2026-11-12T10:00:00Z',
          message: null,
        });
      }
    }
  }
  return {
    origin: req.origin,
    destination: req.destination,
    currency: req.currency,
    cabin: req.cabin,
    depart_dates: departs,
    trip_nights: nightsAxis,
    cells,
    stats: {
      min: { amount: '2100.00', currency: 'ILS' },
      max: { amount: '2720.50', currency: 'ILS' },
      median: { amount: '2560.50', currency: 'ILS' },
      priced: cells.filter((c) => c.status === 'priced').length,
      no_offers: 1,
      not_searched: 1,
      error: 1,
    },
    sources: [{ provider_id: 'demo_skyline', provider_name: 'דמו סקייליין', mode: 'DEMO', status: 'OK', message: 'נתוני הדגמה (סינתטיים)' }],
    legend_note: 'הצבעים יחסיים למחירים שבלוח זה בלבד.',
    coverage_note: 'המחירים בלוח מבוססים על ספקי הדגמה. אין התחייבות לכיסוי מלא של השוק — ייתכנו מחירים ואפשרויות נוספים אצל ספקים אחרים.',
    has_demo: true,
    generated_at: '2026-11-12T10:00:00Z',
  };
}

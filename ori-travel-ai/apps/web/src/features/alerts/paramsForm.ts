/** Compact per-category search-parameter model for price alerts (validated again by the server). */
import { todayIso } from '@/features/trips/datetime';
import type { Category } from '@/lib/schemas/common';

export interface ParamsState {
  origin: string;
  destination: string;
  /** depart_date / check_in / date_from */
  start: string;
  /** return_date / check_out / date_to */
  end: string;
  adults: string;
  cabin: string;
  minStars: string;
  pickup: string;
  dropoff: string;
  /** pickup_at / dropoff_at (datetime-local) */
  pickupAt: string;
  dropoffAt: string;
  driverAge: string;
  currency: string;
}

export const EMPTY_PARAMS: ParamsState = {
  origin: '',
  destination: '',
  start: '',
  end: '',
  adults: '2',
  cabin: 'economy',
  minStars: '',
  pickup: '',
  dropoff: '',
  pickupAt: '',
  dropoffAt: '',
  driverAge: '30',
  currency: 'ILS',
};

const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

/** Seed the form from a stored search (`GET /api/search/{id}` params) — keys not shown are preserved via `extra`. */
export function stateFromParams(category: Category, p: Record<string, unknown>): ParamsState {
  const s: ParamsState = { ...EMPTY_PARAMS, currency: str(p.currency) || 'ILS' };
  switch (category) {
    case 'flight':
      s.origin = str(p.origin);
      s.destination = str(p.destination);
      s.start = str(p.depart_date).slice(0, 10);
      s.end = str(p.return_date).slice(0, 10);
      s.adults = str(p.adults) || '1';
      s.cabin = str(p.cabin) || 'economy';
      break;
    case 'hotel': {
      s.destination = str(p.destination);
      s.start = str(p.check_in).slice(0, 10);
      s.end = str(p.check_out).slice(0, 10);
      const rooms = Array.isArray(p.rooms) ? (p.rooms as Array<Record<string, unknown>>) : [];
      s.adults = str(rooms[0]?.adults) || '2';
      s.minStars = str(p.min_stars);
      break;
    }
    case 'car':
      s.pickup = str(p.pickup_location);
      s.dropoff = str(p.dropoff_location);
      s.pickupAt = str(p.pickup_at).slice(0, 16);
      s.dropoffAt = str(p.dropoff_at).slice(0, 16);
      s.driverAge = str(p.driver_age) || '30';
      break;
    case 'activity':
      s.destination = str(p.destination);
      s.start = str(p.date_from).slice(0, 10);
      s.end = str(p.date_to).slice(0, 10);
      s.adults = str(p.adults) || '2';
      break;
  }
  return s;
}

const int = (v: string, fallback: number): number => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
};

/** Build the API `search_params` object. `extra` (unknown keys from a stored search) is kept underneath. */
export function buildSearchParams(category: Category, s: ParamsState, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const base: Record<string, unknown> = { ...extra, category, currency: s.currency };
  switch (category) {
    case 'flight':
      return {
        ...base,
        origin: s.origin.trim().toUpperCase(),
        destination: s.destination.trim().toUpperCase(),
        depart_date: s.start,
        return_date: s.end || null,
        adults: int(s.adults, 1),
        cabin: s.cabin,
      };
    case 'hotel': {
      const rooms = Array.isArray(extra.rooms) ? (extra.rooms as Array<Record<string, unknown>>) : [];
      return {
        ...base,
        destination: s.destination.trim(),
        check_in: s.start,
        check_out: s.end,
        rooms: rooms.length > 1 ? rooms : [{ adults: int(s.adults, 2), children_ages: (rooms[0]?.children_ages as unknown[]) ?? [] }],
        min_stars: s.minStars ? int(s.minStars, 1) : null,
      };
    }
    case 'car':
      return {
        ...base,
        pickup_location: s.pickup.trim(),
        dropoff_location: s.dropoff.trim() || null,
        pickup_at: s.pickupAt,
        dropoff_at: s.dropoffAt,
        driver_age: int(s.driverAge, 30),
      };
    case 'activity':
      return {
        ...base,
        destination: s.destination.trim(),
        date_from: s.start,
        date_to: s.end,
        adults: int(s.adults, 2),
      };
  }
}

export function validateParams(category: Category, s: ParamsState, today: string = todayIso()): Record<string, string> {
  const e: Record<string, string> = {};
  const future = (value: string, key: string, label: string) => {
    if (!value) e[key] = `יש להזין ${label}`;
    else if (value.slice(0, 10) < today) e[key] = `${label} חייב להיות היום או בעתיד`;
  };
  const adults = int(s.adults, 0);
  switch (category) {
    case 'flight':
      if (!/^[A-Za-z]{3}$/.test(s.origin.trim())) e.origin = 'קוד שדה תעופה בן 3 אותיות (למשל TLV)';
      if (!/^[A-Za-z]{3}$/.test(s.destination.trim())) e.destination = 'קוד שדה תעופה בן 3 אותיות (למשל ATH)';
      if (!e.origin && !e.destination && s.origin.trim().toUpperCase() === s.destination.trim().toUpperCase()) e.destination = 'מוצא ויעד חייבים להיות שונים';
      future(s.start, 'start', 'תאריך יציאה');
      if (s.end && !e.start && s.end < s.start) e.end = 'תאריך החזרה חייב להיות אחרי תאריך היציאה';
      if (adults < 1 || adults > 9) e.adults = 'בין 1 ל-9 מבוגרים';
      break;
    case 'hotel':
      if (s.destination.trim().length < 2) e.destination = 'יש להזין יעד';
      future(s.start, 'start', 'תאריך כניסה');
      if (!s.end) e.end = 'יש להזין תאריך יציאה';
      else if (!e.start && s.end <= s.start) e.end = 'תאריך היציאה חייב להיות אחרי הכניסה';
      if (adults < 1 || adults > 6) e.adults = 'בין 1 ל-6 מבוגרים';
      break;
    case 'car':
      if (s.pickup.trim().length < 2) e.pickup = 'יש להזין מקום איסוף';
      future(s.pickupAt, 'pickupAt', 'מועד איסוף');
      if (!s.dropoffAt) e.dropoffAt = 'יש להזין מועד החזרה';
      else if (!e.pickupAt && s.dropoffAt <= s.pickupAt) e.dropoffAt = 'ההחזרה חייבת להיות אחרי האיסוף';
      if (int(s.driverAge, 0) < 18 || int(s.driverAge, 0) > 99) e.driverAge = 'גיל נהג בין 18 ל-99';
      break;
    case 'activity':
      if (s.destination.trim().length < 2) e.destination = 'יש להזין יעד';
      future(s.start, 'start', 'תאריך התחלה');
      if (!s.end) e.end = 'יש להזין תאריך סיום';
      else if (!e.start && s.end < s.start) e.end = 'תאריך הסיום חייב להיות אחרי ההתחלה';
      if (adults < 1 || adults > 9) e.adults = 'בין 1 ל-9 מבוגרים';
      break;
  }
  return e;
}

/** Default alert name from the params, e.g. "TLV → ATH". */
export function defaultAlertName(category: Category, s: ParamsState): string {
  switch (category) {
    case 'flight':
      return `טיסה ${s.origin.trim().toUpperCase()} → ${s.destination.trim().toUpperCase()}`.trim();
    case 'hotel':
      return `מלון ב${s.destination.trim()}`.trim();
    case 'car':
      return `רכב ב${s.pickup.trim()}`.trim();
    case 'activity':
      return `אטרקציות ב${s.destination.trim()}`.trim();
  }
}

export const INTERVAL_PRESETS = [
  { minutes: 360, label: 'כל 6 שעות' },
  { minutes: 720, label: 'כל 12 שעות' },
  { minutes: 1440, label: 'פעם ביום' },
] as const;
export const MIN_INTERVAL_MINUTES = 360;

export function intervalLabel(minutes: number): string {
  const preset = INTERVAL_PRESETS.find((p) => p.minutes === minutes);
  if (preset) return preset.label;
  if (minutes % 1440 === 0) return `כל ${minutes / 1440} ימים`;
  if (minutes % 60 === 0) return `כל ${minutes / 60} שעות`;
  return `כל ${minutes} דקות`;
}

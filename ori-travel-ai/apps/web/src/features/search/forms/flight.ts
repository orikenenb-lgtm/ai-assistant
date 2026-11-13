import { z } from 'zod';
import {
  MAX_TRAVELLERS,
  addDaysIso,
  ages,
  ageSchema,
  currencyOf,
  currencySchema,
  futureDate,
  maxPriceSchema,
  num,
  priceStr,
  str,
  todayIso,
  zodFieldErrors,
  type ValidationResult,
} from './common';

export interface FlightFormState {
  tripType: 'round' | 'oneway';
  origin: string;
  destination: string;
  departDate: string;
  returnDate: string;
  flexDays: number;
  adults: number;
  childrenAges: number[];
  cabin: string;
  /** '' = any */
  maxStops: string;
  checkedBags: number;
  window: string;
  currency: string;
  maxPrice: string;
}

export function defaultFlightState(now: Date = new Date()): FlightFormState {
  const today = todayIso(now);
  return {
    tripType: 'round',
    origin: 'TLV',
    destination: '',
    departDate: addDaysIso(today, 30),
    returnDate: addDaysIso(today, 37),
    flexDays: 0,
    adults: 2,
    childrenAges: [],
    cabin: 'economy',
    maxStops: '',
    checkedBags: 0,
    window: 'any',
    currency: 'ILS',
    maxPrice: '',
  };
}

const IATA = z
  .string()
  .regex(/^[A-Z]{3}$/, 'קוד שדה תעופה בן 3 אותיות לועזיות, למשל TLV');

export function flightSchema(today: string) {
  return z
    .object({
      origin: IATA,
      destination: IATA,
      depart_date: futureDate(today),
      return_date: futureDate(today).nullable(),
      flex_days: z.number().int().min(0, 'גמישות 0–3 ימים').max(3, 'גמישות 0–3 ימים'),
      adults: z.number().int().min(1, 'לפחות מבוגר אחד').max(MAX_TRAVELLERS, `עד ${MAX_TRAVELLERS} נוסעים`),
      children_ages: z.array(ageSchema).max(8, 'עד 8 ילדים'),
      cabin: z.enum(['economy', 'premium_economy', 'business', 'first']),
      max_stops: z.number().int().min(0).max(3).nullable(),
      checked_bags: z.number().int().min(0, '0–3 מזוודות').max(3, '0–3 מזוודות'),
      preferred_departure_window: z.enum(['any', 'morning', 'afternoon', 'evening', 'night']),
      currency: currencySchema,
      max_price: maxPriceSchema.nullable(),
    })
    .superRefine((v, ctx) => {
      if (v.origin && v.origin === v.destination) {
        ctx.addIssue({ code: 'custom', path: ['destination'], message: 'מוצא ויעד חייבים להיות שונים' });
      }
      if (v.return_date && v.depart_date && v.return_date < v.depart_date) {
        ctx.addIssue({ code: 'custom', path: ['return_date'], message: 'תאריך החזרה חייב להיות אחרי תאריך היציאה' });
      }
      const infants = v.children_ages.filter((a) => a < 2).length;
      if (infants > v.adults) {
        ctx.addIssue({ code: 'custom', path: ['children_ages'], message: 'כל תינוק (מתחת לגיל 2) צריך מבוגר מלווה' });
      }
      if (v.adults + v.children_ages.length > MAX_TRAVELLERS) {
        ctx.addIssue({ code: 'custom', path: ['adults'], message: `עד ${MAX_TRAVELLERS} נוסעים בחיפוש אחד` });
      }
    });
}

export function flightBody(s: FlightFormState) {
  return {
    origin: s.origin.trim().toUpperCase(),
    destination: s.destination.trim().toUpperCase(),
    depart_date: s.departDate,
    return_date: s.tripType === 'round' ? s.returnDate || '' : null,
    flex_days: s.flexDays,
    adults: s.adults,
    children_ages: s.childrenAges,
    cabin: s.cabin,
    max_stops: s.maxStops === '' ? null : Number(s.maxStops),
    checked_bags: s.checkedBags,
    preferred_departure_window: s.window,
    currency: s.currency,
    max_price: s.maxPrice.trim() === '' ? null : s.maxPrice.trim(),
  };
}

export function validateFlight(s: FlightFormState, now: Date = new Date()): ValidationResult<Record<string, unknown>> {
  const parsed = flightSchema(todayIso(now)).safeParse(flightBody(s));
  if (!parsed.success) return { ok: false, errors: zodFieldErrors(parsed.error) };
  return { ok: true, body: parsed.data };
}

export function flightFromParams(p: Record<string, unknown>, base: FlightFormState = defaultFlightState()): FlightFormState {
  return {
    ...base,
    tripType: str(p.return_date) ? 'round' : 'oneway',
    origin: str(p.origin, base.origin),
    destination: str(p.destination),
    departDate: str(p.depart_date, base.departDate),
    returnDate: str(p.return_date, base.returnDate),
    flexDays: num(p.flex_days, 0),
    adults: num(p.adults, 1),
    childrenAges: ages(p.children_ages),
    cabin: str(p.cabin, 'economy'),
    maxStops: typeof p.max_stops === 'number' ? String(p.max_stops) : '',
    checkedBags: num(p.checked_bags, 0),
    window: str(p.preferred_departure_window, 'any'),
    currency: currencyOf(p.currency),
    maxPrice: priceStr(p.max_price),
  };
}

import { z } from 'zod';
import {
  currencyOf,
  currencySchema,
  localDateTime,
  maxPriceSchema,
  num,
  priceStr,
  str,
  todayIso,
  zodFieldErrors,
  diffDays,
  MAX_DAYS_AHEAD,
  type ValidationResult,
} from './common';

export interface CarFormState {
  pickupLocation: string;
  dropoffSame: boolean;
  dropoffLocation: string;
  /** datetime-local value "YYYY-MM-DDTHH:mm" (local time at the pickup place). */
  pickupAt: string;
  dropoffAt: string;
  driverAge: string;
  carClass: string;
  transmission: string;
  minSeats: number;
  currency: string;
  maxPrice: string;
}

export const YOUNG_DRIVER_AGE = 25;

export function defaultCarState(now: Date = new Date()): CarFormState {
  return {
    pickupLocation: '',
    dropoffSame: true,
    dropoffLocation: '',
    pickupAt: localDateTime(30, 10, now),
    dropoffAt: localDateTime(37, 10, now),
    driverAge: '30',
    carClass: 'any',
    transmission: 'any',
    minSeats: 5,
    currency: 'ILS',
    maxPrice: '',
  };
}

const DT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export function carSchema(today: string) {
  return z
    .object({
      pickup_location: z.string().trim().min(2, 'מקום איסוף באורך 2 תווים לפחות').max(100, 'עד 100 תווים'),
      dropoff_location: z.string().trim().min(2, 'מקום החזרה באורך 2 תווים לפחות').max(100, 'עד 100 תווים').nullable(),
      pickup_at: z.string().regex(DT_RE, 'יש לבחור תאריך ושעת איסוף'),
      dropoff_at: z.string().regex(DT_RE, 'יש לבחור תאריך ושעת החזרה'),
      driver_age: z.number().int('גיל חייב להיות מספר שלם').min(18, 'גיל נהג מינימלי 18').max(99, 'גיל נהג עד 99'),
      car_class: z.enum(['any', 'mini', 'economy', 'compact', 'midsize', 'fullsize', 'suv', 'van', 'premium']),
      transmission: z.enum(['any', 'manual', 'automatic']),
      min_seats: z.number().int().min(2, '2–9 מקומות').max(9, '2–9 מקומות'),
      currency: currencySchema,
      max_price: maxPriceSchema.nullable(),
    })
    .superRefine((v, ctx) => {
      if (!DT_RE.test(v.pickup_at) || !DT_RE.test(v.dropoff_at)) return;
      const pickupDate = v.pickup_at.slice(0, 10);
      if (pickupDate < today) ctx.addIssue({ code: 'custom', path: ['pickup_at'], message: 'התאריך כבר עבר' });
      else if (diffDays(today, pickupDate) > MAX_DAYS_AHEAD) {
        ctx.addIssue({ code: 'custom', path: ['pickup_at'], message: 'ניתן לחפש עד שנה קדימה' });
      }
      const pickup = new Date(v.pickup_at).getTime();
      const dropoff = new Date(v.dropoff_at).getTime();
      if (dropoff <= pickup + 3_600_000) {
        ctx.addIssue({ code: 'custom', path: ['dropoff_at'], message: 'זמן ההחזרה חייב להיות לפחות שעה אחרי האיסוף' });
      } else if (Math.floor((dropoff - pickup) / 86_400_000) > 60) {
        ctx.addIssue({ code: 'custom', path: ['dropoff_at'], message: 'ניתן לחפש השכרה של עד 60 יום' });
      }
    });
}

export function carBody(s: CarFormState) {
  const driverAge = s.driverAge.trim() === '' ? Number.NaN : Number(s.driverAge);
  return {
    pickup_location: s.pickupLocation.trim().toUpperCase().match(/^[A-Za-z]{3}$/) ? s.pickupLocation.trim().toUpperCase() : s.pickupLocation.trim(),
    dropoff_location: s.dropoffSame || !s.dropoffLocation.trim() ? null : s.dropoffLocation.trim(),
    pickup_at: s.pickupAt,
    dropoff_at: s.dropoffAt,
    driver_age: driverAge,
    car_class: s.carClass,
    transmission: s.transmission,
    min_seats: s.minSeats,
    currency: s.currency,
    max_price: s.maxPrice.trim() === '' ? null : s.maxPrice.trim(),
  };
}

export function validateCar(s: CarFormState, now: Date = new Date()): ValidationResult<Record<string, unknown>> {
  const body = carBody(s);
  // A different drop-off place was requested but left empty.
  const extra: Record<string, string> = {};
  if (!s.dropoffSame && !s.dropoffLocation.trim()) extra.dropoff_location = 'הזינו מקום החזרה או סמנו החזרה באותו מקום';
  const parsed = carSchema(todayIso(now)).safeParse(body);
  if (!parsed.success || Object.keys(extra).length) {
    return { ok: false, errors: { ...(parsed.success ? {} : zodFieldErrors(parsed.error)), ...extra } };
  }
  return { ok: true, body: parsed.data };
}

export function carFromParams(p: Record<string, unknown>, base: CarFormState = defaultCarState()): CarFormState {
  const dropoff = str(p.dropoff_location);
  return {
    ...base,
    pickupLocation: str(p.pickup_location),
    dropoffSame: !dropoff,
    dropoffLocation: dropoff,
    pickupAt: str(p.pickup_at, base.pickupAt).slice(0, 16),
    dropoffAt: str(p.dropoff_at, base.dropoffAt).slice(0, 16),
    driverAge: String(num(p.driver_age, 30)),
    carClass: str(p.car_class, 'any'),
    transmission: str(p.transmission, 'any'),
    minSeats: num(p.min_seats, 2),
    currency: currencyOf(p.currency),
    maxPrice: priceStr(p.max_price),
  };
}

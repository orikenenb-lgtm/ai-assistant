import { z } from 'zod';
import {
  addDaysIso,
  ages,
  ageSchema,
  currencyOf,
  currencySchema,
  diffDays,
  futureDate,
  maxPriceSchema,
  num,
  priceStr,
  str,
  todayIso,
  zodFieldErrors,
  type ValidationResult,
} from './common';

export interface RoomState {
  adults: number;
  childrenAges: number[];
}

export interface HotelFormState {
  destination: string;
  checkIn: string;
  checkOut: string;
  rooms: RoomState[];
  /** '' = any */
  minStars: string;
  board: string;
  freeCancellationOnly: boolean;
  kosherPreference: boolean;
  accessibilityRequired: boolean;
  currency: string;
  maxPrice: string;
}

export const MAX_ROOMS = 5;
export const MAX_CHILDREN_PER_ROOM = 4;
export const MAX_NIGHTS = 30;

export function defaultHotelState(now: Date = new Date()): HotelFormState {
  const today = todayIso(now);
  return {
    destination: '',
    checkIn: addDaysIso(today, 30),
    checkOut: addDaysIso(today, 34),
    rooms: [{ adults: 2, childrenAges: [] }],
    minStars: '',
    board: 'any',
    freeCancellationOnly: false,
    kosherPreference: false,
    accessibilityRequired: false,
    currency: 'ILS',
    maxPrice: '',
  };
}

export function hotelSchema(today: string) {
  return z
    .object({
      destination: z.string().trim().min(2, 'יעד באורך 2 תווים לפחות').max(100, 'עד 100 תווים'),
      check_in: futureDate(today),
      check_out: futureDate(today),
      rooms: z
        .array(
          z.object({
            adults: z.number().int().min(1, 'לפחות מבוגר אחד בחדר').max(6, 'עד 6 מבוגרים בחדר'),
            children_ages: z.array(ageSchema).max(MAX_CHILDREN_PER_ROOM, `עד ${MAX_CHILDREN_PER_ROOM} ילדים בחדר`),
          }),
        )
        .min(1, 'לפחות חדר אחד')
        .max(MAX_ROOMS, `עד ${MAX_ROOMS} חדרים`),
      min_stars: z.number().int().min(1).max(5).nullable(),
      board: z.enum(['any', 'breakfast', 'half_board', 'all_inclusive']),
      free_cancellation_only: z.boolean(),
      kosher_preference: z.boolean(),
      accessibility_required: z.boolean(),
      currency: currencySchema,
      max_price: maxPriceSchema.nullable(),
    })
    .superRefine((v, ctx) => {
      if (v.check_in && v.check_out && /^\d{4}-/.test(v.check_in) && /^\d{4}-/.test(v.check_out)) {
        if (v.check_out <= v.check_in) {
          ctx.addIssue({ code: 'custom', path: ['check_out'], message: 'תאריך היציאה מהמלון חייב להיות אחרי תאריך הכניסה' });
        } else if (diffDays(v.check_in, v.check_out) > MAX_NIGHTS) {
          ctx.addIssue({ code: 'custom', path: ['check_out'], message: `ניתן לחפש שהייה של עד ${MAX_NIGHTS} לילות` });
        }
      }
    });
}

export function hotelBody(s: HotelFormState) {
  return {
    destination: s.destination.trim(),
    check_in: s.checkIn,
    check_out: s.checkOut,
    rooms: s.rooms.map((r) => ({ adults: r.adults, children_ages: r.childrenAges })),
    min_stars: s.minStars === '' ? null : Number(s.minStars),
    board: s.board,
    free_cancellation_only: s.freeCancellationOnly,
    kosher_preference: s.kosherPreference,
    accessibility_required: s.accessibilityRequired,
    currency: s.currency,
    max_price: s.maxPrice.trim() === '' ? null : s.maxPrice.trim(),
  };
}

export function validateHotel(s: HotelFormState, now: Date = new Date()): ValidationResult<Record<string, unknown>> {
  const parsed = hotelSchema(todayIso(now)).safeParse(hotelBody(s));
  if (!parsed.success) return { ok: false, errors: zodFieldErrors(parsed.error) };
  return { ok: true, body: parsed.data };
}

export function hotelFromParams(p: Record<string, unknown>, base: HotelFormState = defaultHotelState()): HotelFormState {
  const rooms = Array.isArray(p.rooms)
    ? p.rooms
        .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
        .map((r) => ({ adults: num(r.adults, 2), childrenAges: ages(r.children_ages) }))
    : [];
  return {
    ...base,
    destination: str(p.destination),
    checkIn: str(p.check_in, base.checkIn),
    checkOut: str(p.check_out, base.checkOut),
    rooms: rooms.length ? rooms : base.rooms,
    minStars: typeof p.min_stars === 'number' ? String(p.min_stars) : '',
    board: str(p.board, 'any'),
    freeCancellationOnly: p.free_cancellation_only === true,
    kosherPreference: p.kosher_preference === true,
    accessibilityRequired: p.accessibility_required === true,
    currency: currencyOf(p.currency),
    maxPrice: priceStr(p.max_price),
  };
}

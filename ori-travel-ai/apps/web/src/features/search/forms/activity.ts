import { z } from 'zod';
import {
  MAX_TRAVELLERS,
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
  strList,
  todayIso,
  zodFieldErrors,
  type ValidationResult,
} from './common';

export const INTERESTS = ['museum', 'tour', 'outdoor', 'family', 'food', 'water', 'nightlife', 'shopping', 'culture', 'adventure'] as const;

export interface ActivityFormState {
  destination: string;
  dateFrom: string;
  dateTo: string;
  interests: string[];
  adults: number;
  childrenAges: number[];
  accessibilityRequired: boolean;
  /** '' = any */
  language: string;
  currency: string;
  maxPrice: string;
}

export function defaultActivityState(now: Date = new Date()): ActivityFormState {
  const today = todayIso(now);
  return {
    destination: '',
    dateFrom: addDaysIso(today, 30),
    dateTo: addDaysIso(today, 34),
    interests: [],
    adults: 2,
    childrenAges: [],
    accessibilityRequired: false,
    language: '',
    currency: 'ILS',
    maxPrice: '',
  };
}

export function activitySchema(today: string) {
  return z
    .object({
      destination: z.string().trim().min(2, 'יעד באורך 2 תווים לפחות').max(100, 'עד 100 תווים'),
      date_from: futureDate(today),
      date_to: futureDate(today),
      interests: z.array(z.enum(INTERESTS)).max(10),
      adults: z.number().int().min(1, 'לפחות מבוגר אחד').max(MAX_TRAVELLERS, `עד ${MAX_TRAVELLERS} מבוגרים`),
      children_ages: z.array(ageSchema).max(8, 'עד 8 ילדים'),
      accessibility_required: z.boolean(),
      language: z.string().max(8).nullable(),
      currency: currencySchema,
      max_price: maxPriceSchema.nullable(),
    })
    .superRefine((v, ctx) => {
      if (/^\d{4}-/.test(v.date_from) && /^\d{4}-/.test(v.date_to)) {
        if (v.date_to < v.date_from) {
          ctx.addIssue({ code: 'custom', path: ['date_to'], message: 'טווח התאריכים אינו תקין' });
        } else if (diffDays(v.date_from, v.date_to) > 30) {
          ctx.addIssue({ code: 'custom', path: ['date_to'], message: 'טווח של עד 30 יום' });
        }
      }
    });
}

export function activityBody(s: ActivityFormState) {
  return {
    destination: s.destination.trim(),
    date_from: s.dateFrom,
    date_to: s.dateTo,
    interests: s.interests,
    adults: s.adults,
    children_ages: s.childrenAges,
    accessibility_required: s.accessibilityRequired,
    language: s.language || null,
    currency: s.currency,
    max_price: s.maxPrice.trim() === '' ? null : s.maxPrice.trim(),
  };
}

export function validateActivity(s: ActivityFormState, now: Date = new Date()): ValidationResult<Record<string, unknown>> {
  const parsed = activitySchema(todayIso(now)).safeParse(activityBody(s));
  if (!parsed.success) return { ok: false, errors: zodFieldErrors(parsed.error) };
  return { ok: true, body: parsed.data };
}

export function activityFromParams(p: Record<string, unknown>, base: ActivityFormState = defaultActivityState()): ActivityFormState {
  return {
    ...base,
    destination: str(p.destination),
    dateFrom: str(p.date_from, base.dateFrom),
    dateTo: str(p.date_to, base.dateTo),
    interests: strList(p.interests),
    adults: num(p.adults, 2),
    childrenAges: ages(p.children_ages),
    accessibilityRequired: p.accessibility_required === true,
    language: str(p.language),
    currency: currencyOf(p.currency),
    maxPrice: priceStr(p.max_price),
  };
}

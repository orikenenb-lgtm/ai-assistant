/** Hebrew labels for offer enums (display only). */
import type { Board } from '@/lib/schemas/offers';

export const CABIN_LABELS: Record<string, string> = {
  economy: 'אקונומי',
  premium_economy: 'פרימיום אקונומי',
  business: 'עסקים',
  first: 'ראשונה',
};

export const BOARD_LABELS: Record<Board | 'any', string> = {
  any: 'לא משנה',
  room_only: 'לינה בלבד',
  breakfast: 'ארוחת בוקר',
  half_board: 'חצי פנסיון',
  full_board: 'פנסיון מלא',
  all_inclusive: 'הכול כלול',
};

export const CAR_CLASS_LABELS: Record<string, string> = {
  any: 'כל הסוגים',
  mini: 'מיני',
  economy: 'חסכוני',
  compact: 'קומפקטי',
  midsize: 'משפחתי קטן',
  fullsize: 'משפחתי גדול',
  suv: 'רכב שטח / SUV',
  van: 'ואן',
  premium: 'פרימיום',
};

export const TRANSMISSION_LABELS: Record<string, string> = {
  any: 'לא משנה',
  manual: 'ידני',
  automatic: 'אוטומטי',
};

export const WINDOW_LABELS: Record<string, string> = {
  any: 'כל שעה',
  morning: 'בוקר (05:00–12:00)',
  afternoon: 'צהריים (12:00–17:00)',
  evening: 'ערב (17:00–21:00)',
  night: 'לילה (21:00–05:00)',
};

export const INTEREST_LABELS: Record<string, string> = {
  museum: 'מוזיאונים',
  tour: 'סיורים',
  outdoor: 'טבע ושטח',
  family: 'למשפחות',
  food: 'אוכל',
  water: 'מים וחופים',
  nightlife: 'חיי לילה',
  shopping: 'קניות',
  culture: 'תרבות',
  adventure: 'הרפתקאות',
};

export const PASSENGER_LABELS: Record<string, string> = { adult: 'מבוגרים', child: 'ילדים', infant: 'תינוקות' };

export const FACTOR_LABELS: Record<string, string> = {
  cost: 'עלות',
  convenience: 'נוחות',
  flexibility: 'גמישות',
  quality: 'איכות',
};
export const FACTOR_ORDER = ['cost', 'convenience', 'flexibility', 'quality'] as const;
export type Factor = (typeof FACTOR_ORDER)[number];

export const FACTOR_HELP: Record<Factor, string> = {
  cost: 'עד כמה המחיר נמוך ביחס להצעה הזולה ביותר באותה קבוצה ובאותו מטבע.',
  convenience: 'עצירות, משך, שעות ונוחות מיקום/איסוף — לפי סוג ההצעה.',
  flexibility: 'ביטול, שינוי והחזר כספי.',
  quality: 'דירוגים, כוכבים, מותג ושירותים.',
};

export const COST_KIND_LABELS: Record<string, string> = {
  base: 'בסיס',
  tax: 'מיסים',
  fee: 'עמלה',
  extra: 'תוספת',
  discount: 'הנחה',
};

export function cabinLabel(cabin: string): string {
  return CABIN_LABELS[cabin] ?? cabin;
}

/** "ישירה" / "עצירה אחת" / "2 עצירות". */
export function stopsLabel(stops: number): string {
  if (stops <= 0) return 'ישירה';
  if (stops === 1) return 'עצירה אחת';
  return `${stops} עצירות`;
}

/** Counted noun: countLabel(1,'חדר אחד','חדרים') → "חדר אחד"; 2 → "2 חדרים". */
export function countLabel(n: number, one: string, many: string): string {
  return n === 1 ? one : `${n} ${many}`;
}

export const PASSENGER_SINGULAR: Record<string, string> = { adult: 'מבוגר אחד', child: 'ילד אחד', infant: 'תינוק אחד' };

/** Hebrew plural helper: plural(1,'לילה','לילות') → "לילה"; 3 → "3 לילות". */
export function plural(n: number, one: string, many: string, two?: string): string {
  if (n === 1) return `${one}`;
  if (n === 2 && two) return two;
  return `${n} ${many}`;
}

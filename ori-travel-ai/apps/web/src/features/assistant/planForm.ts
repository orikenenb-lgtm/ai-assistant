import { z } from 'zod';
import type { PlanTripRequest } from '@/lib/schemas/ai';

export const MAX_PLAN_DAYS = 21;

export interface PlanFormValues {
  destination: string;
  start_date: string;
  end_date: string;
  adults: number;
  children_ages_text: string;
  interests: string[];
}

export function parseChildrenAges(text: string): { ages: number[]; error?: string } {
  const parts = text
    .split(/[,،\s]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const ages: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,2}$/.test(p) || Number(p) > 17) return { ages: [], error: 'גיל ילד חייב להיות מספר בין 0 ל-17' };
    ages.push(Number(p));
  }
  if (ages.length > 8) return { ages: [], error: 'ניתן להזין עד 8 ילדים' };
  return { ages };
}

function dayCount(start: string, end: string): number {
  const a = Date.parse(`${start}T00:00:00Z`);
  const b = Date.parse(`${end}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000) + 1;
}

const Schema = z
  .object({
    destination: z.string().trim().min(2, 'הזינו יעד (לפחות 2 תווים)').max(100, 'היעד ארוך מדי'),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'בחרו תאריך התחלה'),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'בחרו תאריך סיום'),
    adults: z.number().int().min(1).max(9),
  })
  .superRefine((v, ctx) => {
    if (v.start_date && v.end_date && v.end_date < v.start_date) {
      ctx.addIssue({ code: 'custom', path: ['end_date'], message: 'תאריך הסיום חייב להיות אחרי תאריך ההתחלה' });
    } else if (/^\d{4}-/.test(v.start_date) && /^\d{4}-/.test(v.end_date) && dayCount(v.start_date, v.end_date) > MAX_PLAN_DAYS) {
      ctx.addIssue({ code: 'custom', path: ['end_date'], message: `ניתן לתכנן עד ${MAX_PLAN_DAYS} ימים` });
    }
  });

export function validatePlanForm(values: PlanFormValues): { data?: PlanTripRequest; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const parsed = Schema.safeParse(values);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? 'form');
      if (!(key in errors)) errors[key] = issue.message;
    }
  }
  const kids = parseChildrenAges(values.children_ages_text);
  if (kids.error) errors.children_ages_text = kids.error;
  if (Object.keys(errors).length > 0 || !parsed.success) return { errors };
  return {
    errors,
    data: {
      destination: parsed.data.destination,
      start_date: parsed.data.start_date,
      end_date: parsed.data.end_date,
      adults: parsed.data.adults,
      children_ages: kids.ages,
      interests: values.interests,
    },
  };
}

import type { BadgeTone } from '@/components/ui';

export const ALERT_STATUS_LABELS: Record<string, string> = {
  NEVER: 'טרם נבדקה',
  OK: 'נבדקה בהצלחה',
  FAILED: 'הבדיקה נכשלה',
  NO_RESULTS: 'לא נמצאו תוצאות',
  EXPIRED: 'תאריכי החיפוש עברו',
};

export const ALERT_STATUS_TONES: Record<string, BadgeTone> = {
  NEVER: 'muted',
  OK: 'success',
  FAILED: 'danger',
  NO_RESULTS: 'warn',
  EXPIRED: 'warn',
};

export const SNAPSHOT_STATUS_LABELS: Record<string, string> = {
  OK: 'תקין',
  FAILED: 'נכשל',
  NO_RESULTS: 'ללא תוצאות',
  EXPIRED: 'פג תוקף',
};

export const alertStatusLabel = (s: string) => ALERT_STATUS_LABELS[s] ?? s;

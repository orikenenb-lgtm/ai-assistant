/**
 * פונקציות עיצוב טהורות לתצוגה: גדלים, אחוזים, שעה ותאריך עברי לפי Asia/Jerusalem.
 * בלי תלות בשעון — הזמן תמיד מגיע כפרמטר, כדי שהבדיקות יהיו דטרמיניסטיות.
 */
import { UNITS } from '../i18n/he';

export const APP_TIME_ZONE = 'Asia/Jerusalem';

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const;

/** גודל בבתים בבסיס 1024, עם ספרה עשרונית אחת לכל היותר (למשל "1.5 GB"). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${BYTE_UNITS[unit]}`;
}

/** אחוז שלם בטווח 0..100. null או ערך לא חוקי -> "—". */
export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const clamped = Math.min(100, Math.max(0, value));
  return `${Math.round(clamped)}%`;
}

/** חלק 0..1 (למשל רמת סוללה מה-Battery API) לאחוז. */
export function formatFraction(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return formatPercent(value * 100);
}

const numberFmt = new Intl.NumberFormat('he-IL');

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return numberFmt.format(value);
}

const clockFmt = new Intl.DateTimeFormat('he-IL', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  timeZone: APP_TIME_ZONE,
});

const shortTimeFmt = new Intl.DateTimeFormat('he-IL', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: APP_TIME_ZONE,
});

const hebrewDateFmt = new Intl.DateTimeFormat('he-IL', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: APP_TIME_ZONE,
});

const hebrewCalendarFmt = new Intl.DateTimeFormat('he-IL-u-ca-hebrew', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: APP_TIME_ZONE,
});

const shortDateFmt = new Intl.DateTimeFormat('he-IL', {
  day: 'numeric',
  month: 'short',
  timeZone: APP_TIME_ZONE,
});

/** שעון חי בפורמט 24 שעות: "14:05:09" (שעון ישראל). */
export function formatClock(date: Date): string {
  return clockFmt.format(date);
}

/** "14:05" (שעון ישראל). */
export function formatShortTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '';
  return shortTimeFmt.format(d);
}

/** "יום שלישי, 6 באוקטובר 2026" (שעון ישראל). */
export function formatHebrewDate(date: Date): string {
  return hebrewDateFmt.format(date);
}

/** התאריך העברי, למשל "25 בתשרי 5787". */
export function formatHebrewCalendarDate(date: Date): string {
  return hebrewCalendarFmt.format(date);
}

/** תאריך יעד מקומי YYYY-MM-DD -> "6 באוק׳". מחזיר את הקלט כמו שהוא אם הוא לא תקין. */
export function formatDueDate(localDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (!m) return localDate;
  // צהריים UTC — כדי שהמרת אזור הזמן לא תזיז את היום
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
  return shortDateFmt.format(d);
}

/** ספירה לאחור: "1:05" לדקות, "42 שניות" מתחת לדקה, "0 שניות" כשנגמר. */
export function formatCountdown(msLeft: number): string {
  const total = Math.max(0, Math.ceil(msLeft / 1000));
  if (total < 60) return total === 1 ? UNITS.secondOne : UNITS.seconds(total);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** זמן פעילות: "3 ימים, 4 שעות" / "4 שעות, 12 דקות" / "12 דקות". */
export function formatUptime(totalSec: number): string {
  if (!Number.isFinite(totalSec) || totalSec < 0) return '—';
  const days = Math.floor(totalSec / 86_400);
  const hours = Math.floor((totalSec % 86_400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const d = days === 1 ? UNITS.dayOne : UNITS.days(days);
  const h = hours === 1 ? UNITS.hourOne : UNITS.hours(hours);
  const m = minutes === 1 ? UNITS.minuteOne : UNITS.minutes(minutes);
  if (days > 0) return `${d}, ${h}`;
  if (hours > 0) return `${h}, ${m}`;
  return m;
}

/** שניות אודיו לתצוגה בטבלת השימוש (ספרה עשרונית אחת). */
export function formatSeconds(sec: number): string {
  if (!Number.isFinite(sec)) return '—';
  return numberFmt.format(Math.round(sec * 10) / 10);
}

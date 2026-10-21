import { DateTime } from 'luxon';

/**
 * זמן ותאריכים של JARVIS — תמיד לפי שעון ישראל (Asia/Jerusalem), כולל מעברי שעון קיץ/חורף.
 * כל הפונקציות טהורות ומקבלות את "עכשיו" מבחוץ, כדי שהבדיקות יהיו דטרמיניסטיות.
 * החישובים מבוססים על נתוני ה-ICU של סביבת הריצה (Electron/Node), לא על טבלאות קשיחות.
 */

export const ZONE = 'Asia/Jerusalem';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** טווח שנים סביר לתזכורות ומשימות. מחוץ לו — כנראה טעות תמלול או פענוח. */
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{1,2}):(\d{2})$/;

/** בחירה בין שני המופעים של שעה שחוזרת פעמיים (במעבר לשעון חורף). */
export type DstChoice = 'earlier' | 'later';

export interface DstOption {
  /** מזהה האפשרות: 'earlier' / 'later' בשעה כפולה, או שעה 'HH:MM' חלופית בשעה שלא קיימת. */
  id: string;
  label_he: string;
}

export type ResolveLocalResult =
  | { ok: true; utcIso: string; display_he: string; offset: string }
  | {
      ok: false;
      code: 'INVALID_PARAMS' | 'DST_GAP' | 'DST_AMBIGUOUS';
      message_he: string;
      /** הצעות להבהרה (רק ב-DST_GAP / DST_AMBIGUOUS). */
      options?: DstOption[];
    };

/* ------------------------------------------------------------------ */
/* עיצוב בעברית — מתוך Intl 'he-IL' עם אזור הזמן של ישראל              */
/* ------------------------------------------------------------------ */

const FULL_FORMAT = new Intl.DateTimeFormat('he-IL', {
  timeZone: ZONE,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const TIME_FORMAT = new Intl.DateTimeFormat('he-IL', {
  timeZone: ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** תאריך קלנדרי (בלי שעה) — מעוצב ב-UTC כי הוא כבר "מקומי" מעצם הגדרתו. */
const DATE_ONLY_FORMAT = new Intl.DateTimeFormat('he-IL', {
  timeZone: 'UTC',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

const DAY_MONTH_FORMAT = new Intl.DateTimeFormat('he-IL', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'long',
});

type PartMap = Partial<Record<Intl.DateTimeFormatPartTypes, string>>;

function partsOf(format: Intl.DateTimeFormat, date: Date): PartMap {
  const out: PartMap = {};
  for (const p of format.formatToParts(date)) {
    if (p.type !== 'literal') out[p.type] = p.value;
  }
  return out;
}

/** שעה דו-ספרתית. יש גרסאות ICU שמחזירות "24" לחצות — מתקנים ל-"00". */
function twoDigitHour(value: string | undefined): string {
  const n = Number(value ?? '0');
  return String(n === 24 ? 0 : n).padStart(2, '0');
}

function twoDigit(value: string | undefined): string {
  return String(Number(value ?? '0')).padStart(2, '0');
}

/** "יום שלישי" — אם ה-ICU מחזיר רק "שלישי", מוסיפים "יום". */
function weekdayHe(value: string | undefined): string {
  const w = (value ?? '').trim();
  return w.startsWith('יום') ? w : `יום ${w}`;
}

function parseIsoMs(utcIso: string): number {
  const ms = Date.parse(utcIso);
  if (!Number.isFinite(ms)) throw new RangeError(`מועד לא תקין: ${utcIso}`);
  return ms;
}

/**
 * תצוגה מלאה בעברית לפי שעון ישראל, למשל: "יום שלישי, 6 באוקטובר 2026 בשעה 08:00".
 * נבנית מחלקי Intl (ולא מהמחרוזת המוכנה) כדי שהמבנה יהיה זהה בכל גרסת ICU.
 */
export function formatHebrewFull(utcIso: string): string {
  const p = partsOf(FULL_FORMAT, new Date(parseIsoMs(utcIso)));
  return `${weekdayHe(p.weekday)}, ${Number(p.day)} ב${p.month ?? ''} ${p.year ?? ''} בשעה ${twoDigitHour(p.hour)}:${twoDigit(p.minute)}`;
}

/** השעה המקומית בלבד, "08:00". */
export function formatLocalTime(utcIso: string): string {
  const p = partsOf(TIME_FORMAT, new Date(parseIsoMs(utcIso)));
  return `${twoDigitHour(p.hour)}:${twoDigit(p.minute)}`;
}

/** תאריך מקומי YYYY-MM-DD בעברית: "יום שלישי, 6 באוקטובר 2026". זורק אם התאריך לא תקין. */
export function formatHebrewDate(date: string): string {
  const d = parseLocalDate(date);
  if (!d) throw new RangeError(`תאריך לא תקין: ${date}`);
  const p = partsOf(DATE_ONLY_FORMAT, new Date(Date.UTC(d.year, d.month - 1, d.day, 12)));
  return `${weekdayHe(p.weekday)}, ${Number(p.day)} ב${p.month ?? ''} ${p.year ?? ''}`;
}

/** "6 באוקטובר" — לתאריך קצר בתוך משפט. */
export function formatHebrewDayMonth(date: string): string {
  const d = parseLocalDate(date);
  if (!d) throw new RangeError(`תאריך לא תקין: ${date}`);
  const p = partsOf(DAY_MONTH_FORMAT, new Date(Date.UTC(d.year, d.month - 1, d.day, 12)));
  return `${Number(p.day)} ב${p.month ?? ''}`;
}

/* ------------------------------------------------------------------ */
/* תאריכים מקומיים                                                      */
/* ------------------------------------------------------------------ */

/** התאריך המקומי בישראל ברגע now, בפורמט YYYY-MM-DD. */
export function todayLocal(now: Date): string {
  const iso = DateTime.fromJSDate(now, { zone: ZONE }).toISODate();
  if (!iso) throw new RangeError('מועד לא תקין');
  return iso;
}

/** החודש המקומי בישראל ברגע now, בפורמט YYYY-MM. */
export function monthLocal(now: Date): string {
  return todayLocal(now).slice(0, 7);
}

/** הוספת ימים לתאריך מקומי YYYY-MM-DD (קלנדרית — לא תלוי בשעון קיץ). */
export function addDaysLocal(date: string, days: number): string {
  const d = parseLocalDate(date);
  if (!d) throw new RangeError(`תאריך לא תקין: ${date}`);
  const ms = Date.UTC(d.year, d.month - 1, d.day) + days * DAY_MS;
  return new Date(ms).toISOString().slice(0, 10);
}

/** תחילת היום המקומי של now ותחילת היום הבא, כמועדי UTC (ISO). יום של מעבר שעון הוא בן 23/25 שעות. */
export function localDayRangeUtc(now: Date): { startIso: string; endIso: string } {
  const start = DateTime.fromJSDate(now, { zone: ZONE }).startOf('day');
  const end = start.plus({ days: 1 });
  return { startIso: toUtcIso(start), endIso: toUtcIso(end) };
}

/** תחילת החודש המקומי של now ותחילת החודש הבא, כמועדי UTC (ISO). */
export function localMonthRangeUtc(now: Date): { startIso: string; endIso: string } {
  const start = DateTime.fromJSDate(now, { zone: ZONE }).startOf('month');
  const end = start.plus({ months: 1 });
  return { startIso: toUtcIso(start), endIso: toUtcIso(end) };
}

function toUtcIso(dt: DateTime): string {
  return new Date(dt.toMillis()).toISOString();
}

/** האם המועד בעתיד ביחס ל-now. מועד לא תקין — לא בעתיד. */
export function isFuture(utcIso: string, now: Date): boolean {
  const ms = Date.parse(utcIso);
  return Number.isFinite(ms) && ms > now.getTime();
}

/**
 * תיאור קצר להקראה: "היום בשעה 08:00", "מחר בשעה 08:00", אחרת התצוגה המלאה.
 */
export function describeWhenHe(utcIso: string, now: Date): string {
  const ms = parseIsoMs(utcIso);
  const day = todayLocal(new Date(ms));
  const today = todayLocal(now);
  const time = formatLocalTime(utcIso);
  if (day === today) return `היום בשעה ${time}`;
  if (day === addDaysLocal(today, 1)) return `מחר בשעה ${time}`;
  return formatHebrewFull(utcIso);
}

/* ------------------------------------------------------------------ */
/* פענוח תאריך ושעה מקומיים, כולל מעברי שעון                           */
/* ------------------------------------------------------------------ */

/** מפרק YYYY-MM-DD ומוודא שזה תאריך קלנדרי אמיתי (בלי 30 בפברואר) בטווח השנים הנתמך. */
export function parseLocalDate(date: string): { year: number; month: number; day: number } | null {
  const m = date.match(DATE_RE);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < MIN_YEAR || year > MAX_YEAR || month < 1 || month > 12 || day < 1) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return { year, month, day };
}

/** מפרק HH:MM (24 שעות). מקבל גם H:MM. */
export function parseLocalTime(time: string): { hour: number; minute: number } | null {
  const m = time.match(TIME_RE);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/** ההיסט (בדקות) של שעון ישראל ברגע מסוים. */
function offsetAt(ms: number): number {
  return DateTime.fromMillis(ms, { zone: ZONE }).offset;
}

function offsetLabel(ms: number): string {
  return DateTime.fromMillis(ms, { zone: ZONE }).toFormat('ZZ');
}

/** "שעון קיץ"/"שעון חורף" לפי ההיסט (ישראל: ‎+03:00 קיץ, ‎+02:00 חורף). */
function seasonLabel(offsetMinutes: number): string {
  return offsetMinutes >= 180 ? 'שעון קיץ' : 'שעון חורף';
}

/**
 * כל הרגעים (UTC, במילישניות) שבהם השעון בישראל מראה בדיוק את זמן הקיר הנתון.
 * wallMs = זמן הקיר כאילו היה UTC. בודקים כל היסט שהיה בתוקף ביומיים שסביב,
 * ומשאירים רק היסט שבאמת בתוקף ברגע המתקבל:
 * 0 רגעים = השעה לא קיימת (קפיצה קדימה), 2 רגעים = השעה מופיעה פעמיים (חזרה אחורה).
 */
function instantsForWallTime(wallMs: number): number[] {
  const offsets = new Set<number>();
  for (let k = -8; k <= 8; k++) offsets.add(offsetAt(wallMs + k * 6 * HOUR_MS));
  const found = new Set<number>();
  for (const off of offsets) {
    const instant = wallMs - off * MINUTE_MS;
    if (offsetAt(instant) === off) found.add(instant);
  }
  return [...found].sort((a, b) => a - b);
}

function hhmm(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * ממיר תאריך + שעה מקומיים (Asia/Jerusalem) לרגע UTC.
 * מזהה שעה שלא קיימת (DST_GAP) ושעה שמופיעה פעמיים (DST_AMBIGUOUS);
 * בשעה כפולה אפשר להעביר dstChoice כדי לבחור את המופע הראשון/השני.
 */
export function resolveLocalDateTime(
  date: string,
  time: string,
  options?: { dstChoice?: DstChoice },
): ResolveLocalResult {
  const d = parseLocalDate(date);
  if (!d) {
    return {
      ok: false,
      code: 'INVALID_PARAMS',
      message_he: `התאריך "${date}" לא תקין. צריך תאריך אמיתי בפורמט שנה-חודש-יום, למשל 2026-10-06.`,
    };
  }
  const t = parseLocalTime(time);
  if (!t) {
    return {
      ok: false,
      code: 'INVALID_PARAMS',
      message_he: `השעה "${time}" לא תקינה. צריך שעה בפורמט 24 שעות, למשל 08:00 או 20:30.`,
    };
  }

  const wallMs = Date.UTC(d.year, d.month - 1, d.day, t.hour, t.minute);
  const instants = instantsForWallTime(wallMs);
  const wallLabel = hhmm(t.hour, t.minute);
  const dateLabel = formatHebrewDayMonth(date);

  if (instants.length === 0) {
    // השעה "נבלעת" בקפיצה קדימה. מציעים את אותה שעה אחרי ההזזה (למשל 02:30 -> 03:30).
    const offsetBefore = offsetAt(wallMs - DAY_MS);
    const shiftedIso = new Date(wallMs - offsetBefore * MINUTE_MS).toISOString();
    const shifted = formatLocalTime(shiftedIso);
    return {
      ok: false,
      code: 'DST_GAP',
      message_he: `השעה ${wallLabel} לא קיימת ב-${dateLabel} — בלילה הזה השעון מוזז שעה קדימה (מעבר לשעון קיץ). לקבוע ל-${shifted}?`,
      options: [{ id: shifted, label_he: `${shifted} (אחרי הזזת השעון)` }],
    };
  }

  let chosen: number;
  let suffix = '';
  if (instants.length === 1) {
    chosen = instants[0] as number;
  } else {
    const earlier = instants[0] as number;
    const later = instants[instants.length - 1] as number;
    if (!options?.dstChoice) {
      const earlierLabel = `${wallLabel} בפעם הראשונה (${seasonLabel(offsetAt(earlier))}, ${offsetLabel(earlier)})`;
      const laterLabel = `${wallLabel} בפעם השנייה (${seasonLabel(offsetAt(later))}, ${offsetLabel(later)})`;
      return {
        ok: false,
        code: 'DST_AMBIGUOUS',
        message_he: `השעה ${wallLabel} מופיעה פעמיים ב-${dateLabel} בגלל המעבר לשעון חורף. להתכוון לפעם הראשונה (לפני הזזת השעון) או לשנייה (אחריה)?`,
        options: [
          { id: 'earlier', label_he: earlierLabel },
          { id: 'later', label_he: laterLabel },
        ],
      };
    }
    chosen = options.dstChoice === 'earlier' ? earlier : later;
    suffix = ` (${seasonLabel(offsetAt(chosen))})`;
  }

  const utcIso = new Date(chosen).toISOString();
  return { ok: true, utcIso, display_he: `${formatHebrewFull(utcIso)}${suffix}`, offset: offsetLabel(chosen) };
}

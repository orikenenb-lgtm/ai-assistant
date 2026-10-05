import { DateTime } from 'luxon';
import type { Settings } from '../../shared/settings-schema';
import type { ToolName, ToolResult } from '../../shared/types';
import { matchScore, stripAddressing } from '../../shared/text-normalize';

/**
 * פענוח מקומי ודטרמיניסטי של פקודות — בלי ענן.
 * משמש כש-Claude לא זמין (אין מפתח / אין רשת) או במצב "מקומי בלבד".
 * הפלט הוא תמיד בקשה לכלי (שעוברת את אותו צינור אימות/אישור/ביצוע), שאלת הבהרה, ביטול, תשובה קצרה או "לא הבנתי".
 * תאריכים ושעות מחושבים ב-luxon לפי Asia/Jerusalem (כולל מעבר שעון קיץ/חורף).
 */

const ZONE = 'Asia/Jerusalem';

export type DayPeriod = 'morning' | 'noon' | 'afternoon' | 'evening' | 'night';

/** טיוטת תזכורת — נשמרת בהבהרה עד שכל החלקים ידועים. */
export interface ReminderDraft {
  text: string | null;
  /** תאריך מקומי YYYY-MM-DD אם נאמר יום. */
  date: string | null;
  /** רמז לחלק היום מתוך "הערב"/"הלילה". */
  dayHint: DayPeriod | null;
  /** השעה כפי שנאמרה (1-12 כשאין סימון 24 שעות). */
  hour: number | null;
  minute: number;
  /** השעה נאמרה בפורמט 24 שעות מפורש (למשל 20:30). */
  is24h: boolean;
  period: DayPeriod | null;
  /** מועד שכבר חושב במלואו (למשל "בעוד 10 דקות"). */
  absolute: { date: string; time: string } | null;
}

export type PendingClarification =
  | { kind: 'reminder'; awaiting: 'ampm' | 'time' | 'when' | 'text'; draft: ReminderDraft }
  | {
      kind: 'choose-option';
      tool: ToolName;
      field: string;
      options: Array<{ id: string; label: string }>;
      /** פרמטרים מהבקשה המקורית שנשלחים שוב יחד עם הבחירה (למשל טקסט/תאריך של תזכורת בבחירת שעון קיץ/חורף). */
      baseInput?: Record<string, unknown>;
    };

export type LocalIntent =
  | { kind: 'tool'; tool: ToolName; input: Record<string, unknown>; ack_he?: string }
  | { kind: 'clarify'; question_he: string; pending: PendingClarification }
  | { kind: 'cancel' }
  | { kind: 'reply'; reply_he: string }
  | { kind: 'none' };

/** הערה שמצורפת לסיכום המאומת כשמבקשים מוזיקה (לא מחליפה אותו). */
export const MUSIC_ACK_HE = 'שליטה בניגון מוזיקה עדיין לא מחוברת בגרסה הזו — את השיר בוחרים ישירות ב-Spotify.';

/* ------------------------------------------------------------------ */
/* הכנת טקסט                                                            */
/* ------------------------------------------------------------------ */

const NIQQUD = /[֑-ׇ]/g;
const QUOTES = /[׳״'"`‘’“”]/g;
const FINALS: Record<string, string> = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };

/** ניקוי קל ששומר אותיות סופיות ורישיות (לטקסט של משימות/תזכורות), ו-:/. בין ספרות (20:30, 12/10). */
function prep(text: string): string {
  const base = text.normalize('NFKC').replace(NIQQUD, '').replace(QUOTES, '');
  return base
    .replace(/[^\p{L}\p{N}\s]/gu, (ch, offset: number, str: string) =>
      (ch === ':' || ch === '/' || ch === '.') && /\d/.test(str[offset - 1] ?? '') && /\d/.test(str[offset + 1] ?? '') ? ch : ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
}

function foldToken(token: string): string {
  return token.toLowerCase().replace(/[ךםןףץ]/g, (ch) => FINALS[ch] ?? ch);
}

/** מסיר פנייה ל-JARVIS ומילות נימוס (בעזרת stripAddressing המשותף) ומחזיר את שאר המשפט בכתיב המקורי. */
function stripAddress(body: string): string {
  const tokens = body.split(' ').filter(Boolean);
  if (!tokens.length) return '';
  const folded = tokens.map(foldToken);
  const rest = stripAddressing(folded.join(' '));
  if (!rest) return '';
  const restTokens = rest.split(' ');
  for (let i = 0; i + restTokens.length <= folded.length; i++) {
    if (restTokens.every((t, j) => folded[i + j] === t)) return tokens.slice(i, i + restTokens.length).join(' ');
  }
  return body;
}

interface Prepared {
  /** הטקסט אחרי ניקוי והסרת פנייה, בכתיב המקורי. */
  body: string;
  /** אותו טקסט באותיות קטנות (לזיהוי). */
  low: string;
}

function prepare(text: string): Prepared {
  const body = stripAddress(prep(text));
  const low = body.toLowerCase();
  // אם המרת האותיות שינתה אורך (תווים נדירים) — עובדים על הגרסה הקטנה בלבד כדי לשמור יישור אינדקסים
  return low.length === body.length ? { body, low } : { body: low, low };
}

/* ------------------------------------------------------------------ */
/* ביטול                                                                */
/* ------------------------------------------------------------------ */

const CANCEL_PHRASES = new Set(
  [
    'עצור', 'תעצור', 'עצרי', 'תעצרי', 'בטל', 'תבטל', 'בטלי', 'תבטלי', 'ביטול', 'די', 'מספיק', 'תפסיק', 'הפסק', 'תפסיקי',
    'עזוב', 'עזבי', 'עזוב את זה', 'בטל את זה', 'תבטל את זה', 'עצור את זה', 'תעצור את זה', 'שקט', 'לא משנה',
    'stop', 'cancel', 'stop it', 'never mind', 'nevermind', 'abort',
  ].map((p) => p.split(' ').map(foldToken).join(' ')),
);

function isCancelLow(low: string): boolean {
  const folded = low.split(' ').map(foldToken).join(' ');
  return CANCEL_PHRASES.has(folded.replace(/\s+(עכשיו|now)$/, ''));
}

/** "עצור" / "בטל" / "stop" / "cancel" לבד (אחרי הסרת פנייה). */
export function isCancelCommand(text: string): boolean {
  const { low } = prepare(text);
  return low !== '' && isCancelLow(low);
}

/* ------------------------------------------------------------------ */
/* מספרים ושעות                                                         */
/* ------------------------------------------------------------------ */

const B = '(?<=^|\\s)';
const E = '(?=\\s|$)';

const HOUR_WORDS: Array<[string, number]> = [
  ['אחת עשרה', 11],
  ['אחד עשר', 11],
  ['שתים עשרה', 12],
  ['שתיים עשרה', 12],
  ['שתים', 2],
  ['שתיים', 2],
  ['אחת', 1],
  ['שלוש', 3],
  ['ארבע', 4],
  ['חמש', 5],
  ['שש', 6],
  ['שבע', 7],
  ['שמונה', 8],
  ['תשע', 9],
  ['עשר', 10],
];
const HOUR_WORD_ALT = HOUR_WORDS.map(([w]) => w.replace(' ', '\\s+')).join('|');

const COUNT_WORDS: Array<[string, number]> = [
  ['עשרים וחמש', 25],
  ['עשרים וחמישה', 25],
  ['ארבעים וחמש', 45],
  ['ארבעים וחמישה', 45],
  ['חמש עשרה', 15],
  ['חמישה עשר', 15],
  ['אחת עשרה', 11],
  ['אחד עשר', 11],
  ['שתים עשרה', 12],
  ['שתיים עשרה', 12],
  ['עשרים', 20],
  ['שלושים', 30],
  ['ארבעים', 40],
  ['חמישים', 50],
  ['אחד', 1],
  ['אחת', 1],
  ['שתיים', 2],
  ['שתים', 2],
  ['שתי', 2],
  ['שני', 2],
  ['שניים', 2],
  ['שלושה', 3],
  ['שלוש', 3],
  ['ארבעה', 4],
  ['ארבע', 4],
  ['חמישה', 5],
  ['חמש', 5],
  ['שישה', 6],
  ['שש', 6],
  ['שבעה', 7],
  ['שבע', 7],
  ['שמונה', 8],
  ['תשעה', 9],
  ['תשע', 9],
  ['עשרה', 10],
  ['עשר', 10],
];
const COUNT_WORD_ALT = COUNT_WORDS.map(([w]) => w.replace(' ', '\\s+')).join('|');

const MINUTE_SUFFIX: Array<[string, number]> = [
  ['ועשרים וחמש', 25],
  ['ועשרים וחמישה', 25],
  ['וארבעים וחמש', 45],
  ['וארבעים וחמישה', 45],
  ['וחצי', 30],
  ['ורבע', 15],
  ['ועשרים', 20],
  ['ועשרה', 10],
  ['ועשר', 10],
  ['וחמישה', 5],
  ['וחמש', 5],
  ['ושלושים', 30],
  ['וארבעים', 40],
  ['וחמישים', 50],
];
const MINUTE_SUFFIX_ALT = MINUTE_SUFFIX.map(([w]) => w.replace(' ', '\\s+')).join('|');

const PERIOD_WORDS: Array<[string, DayPeriod]> = [
  ['לפנות בוקר', 'morning'],
  ['לפני הצהריים', 'morning'],
  ['לפני הצהרים', 'morning'],
  ['אחר הצהריים', 'afternoon'],
  ['אחרי הצהריים', 'afternoon'],
  ['אחר הצהרים', 'afternoon'],
  ['אחרי הצהרים', 'afternoon'],
  ['אחהצ', 'afternoon'],
  ['אחה צ', 'afternoon'],
  ['בבוקר', 'morning'],
  ['בצהריים', 'noon'],
  ['בצהרים', 'noon'],
  ['בערב', 'evening'],
  ['בלילה', 'night'],
];
const PERIOD_ALT = PERIOD_WORDS.map(([w]) => w.replace(' ', '\\s+')).join('|');

/** תשובות קצרות להבהרת בוקר/ערב. */
const BARE_PERIODS: Record<string, DayPeriod> = {
  בוקר: 'morning',
  'בבוקר': 'morning',
  ערב: 'evening',
  'בערב': 'evening',
  לילה: 'night',
  'בלילה': 'night',
  צהריים: 'noon',
  צהרים: 'noon',
  'בצהריים': 'noon',
  'בצהרים': 'noon',
  'אחר הצהריים': 'afternoon',
  'אחרי הצהריים': 'afternoon',
  morning: 'morning',
  evening: 'evening',
  night: 'night',
  am: 'morning',
  pm: 'evening',
};

function lookupWord(table: Array<[string, number]>, raw: string): number | null {
  const norm = raw.replace(/\s+/g, ' ').trim();
  for (const [w, n] of table) if (w === norm) return n;
  return null;
}

function parseNumber(raw: string, table: Array<[string, number]>): number | null {
  if (/^\d+$/.test(raw)) return Number(raw);
  return lookupWord(table, raw);
}

function periodOf(raw: string): DayPeriod | null {
  const norm = raw.replace(/\s+/g, ' ').trim();
  for (const [w, p] of PERIOD_WORDS) if (w === norm) return p;
  return null;
}

const HEBREW_WEEKDAYS: Record<string, number> = { ראשון: 7, שני: 1, שלישי: 2, רביעי: 3, חמישי: 4, שישי: 5, שבת: 6 };
const ENGLISH_WEEKDAYS: Record<string, number> = {
  monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 7,
};
const HEBREW_MONTHS: Record<string, number> = {
  ינואר: 1, פברואר: 2, מרץ: 3, מרס: 3, אפריל: 4, מאי: 5, יוני: 6, יולי: 7, אוגוסט: 8, ספטמבר: 9, אוקטובר: 10, נובמבר: 11, דצמבר: 12,
};

const HOUR_NAMES: Record<number, string> = {
  1: 'אחת', 2: 'שתיים', 3: 'שלוש', 4: 'ארבע', 5: 'חמש', 6: 'שש', 7: 'שבע', 8: 'שמונה', 9: 'תשע', 10: 'עשר', 11: 'אחת עשרה', 12: 'שתים עשרה',
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function localNow(now: Date): DateTime {
  return DateTime.fromJSDate(now).setZone(ZONE);
}

function toDateString(dt: DateTime): string {
  return dt.toFormat('yyyy-MM-dd');
}

/* ------------------------------------------------------------------ */
/* חילוץ מועד מתוך משפט                                                 */
/* ------------------------------------------------------------------ */

interface WhenParts {
  date: string | null;
  dayHint: DayPeriod | null;
  hour: number | null;
  minute: number;
  is24h: boolean;
  period: DayPeriod | null;
  absolute: { date: string; time: string } | null;
  /** הטקסט שנשאר אחרי הסרת ביטויי הזמן (בכתיב המקורי). */
  rest: string;
  found: boolean;
}

function extractWhen(p: Prepared, now: Date): WhenParts {
  let work = p.low;
  let orig = p.body;
  const nowL = localNow(now);
  const out: WhenParts = { date: null, dayHint: null, hour: null, minute: 0, is24h: false, period: null, absolute: null, rest: '', found: false };

  const take = (re: RegExp): RegExpMatchArray | null => {
    const m = work.match(re);
    if (!m) return null;
    const at = m.index ?? 0;
    const blank = ' '.repeat(m[0].length);
    work = work.slice(0, at) + blank + work.slice(at + m[0].length);
    orig = orig.slice(0, at) + blank + orig.slice(at + m[0].length);
    out.found = true;
    return m;
  };

  // 1) זמן יחסי: "בעוד 10 דקות", "בעוד חצי שעה", "בעוד שעתיים", "in 10 minutes"
  let offsetMinutes: number | null = null;
  let offsetDays: number | null = null;
  let m: RegExpMatchArray | null;
  if ((m = take(new RegExp(`${B}(?:ב)?עוד\\s+(חצי|רבע)\\s+שעה${E}`)))) {
    offsetMinutes = m[1] === 'חצי' ? 30 : 15;
  } else if ((m = take(new RegExp(`${B}(?:ב)?עוד\\s+(שעה|שעתיים)(?:\\s+ו(חצי|רבע))?${E}`)))) {
    offsetMinutes = (m[1] === 'שעה' ? 60 : 120) + (m[2] === 'חצי' ? 30 : m[2] === 'רבע' ? 15 : 0);
  } else if ((m = take(new RegExp(`${B}(?:ב)?עוד\\s+(דקה|דקותיים)${E}`)))) {
    offsetMinutes = m[1] === 'דקה' ? 1 : 2;
  } else if ((m = take(new RegExp(`${B}(?:ב)?עוד\\s+(יומיים|שבועיים|שבוע)${E}`)))) {
    offsetDays = m[1] === 'יומיים' ? 2 : m[1] === 'שבוע' ? 7 : 14;
  } else if (
    (m = take(new RegExp(`${B}(?:ב)?עוד\\s+(\\d{1,3}|${COUNT_WORD_ALT})\\s+(דקות|דקה|שעות|שעה|ימים|יום|שבועות|שבוע)(?:\\s+ו(חצי|רבע))?${E}`)))
  ) {
    const n = parseNumber(m[1] ?? '', COUNT_WORDS) ?? 0;
    const unit = m[2] ?? '';
    const extra = m[3] === 'חצי' ? 0.5 : m[3] === 'רבע' ? 0.25 : 0;
    if (unit.startsWith('דק')) offsetMinutes = n;
    else if (unit.startsWith('שע')) offsetMinutes = Math.round((n + extra) * 60);
    else if (unit.startsWith('יו') || unit.startsWith('ימ')) offsetDays = n;
    else offsetDays = n * 7;
  } else if ((m = take(new RegExp(`${B}in\\s+(\\d{1,3}|an|a|one|two|three|five|ten|fifteen|twenty|thirty)\\s+(minutes?|mins?|hours?|days?)${E}`)))) {
    const words: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, five: 5, ten: 10, fifteen: 15, twenty: 20, thirty: 30 };
    const n = /^\d+$/.test(m[1] ?? '') ? Number(m[1]) : (words[m[1] ?? ''] ?? 0);
    const unit = m[2] ?? '';
    if (unit.startsWith('min')) offsetMinutes = n;
    else if (unit.startsWith('hour')) offsetMinutes = n * 60;
    else offsetDays = n;
  }

  if (offsetMinutes !== null && offsetMinutes > 0) {
    let target = nowL.plus({ minutes: offsetMinutes });
    // מעגלים כלפי מעלה לדקה שלמה — כדי שהתזכורת לא תקדים את הזמן שביקשו
    if (target.second > 0 || target.millisecond > 0) target = target.startOf('minute').plus({ minutes: 1 });
    out.absolute = { date: toDateString(target), time: `${pad2(target.hour)}:${pad2(target.minute)}` };
  }
  if (offsetDays !== null && offsetDays > 0) out.date = toDateString(nowL.plus({ days: offsetDays }));

  // 2) יום: מחרתיים / מחר / היום / הערב / הלילה
  if ((m = take(new RegExp(`${B}(?:ל|ב)?(מחרתיים|מחר|היום|הערב|הלילה)${E}|${B}(tomorrow|today|tonight)${E}`)))) {
    const w = m[1] ?? m[2] ?? '';
    if (w === 'מחרתיים') out.date = toDateString(nowL.plus({ days: 2 }));
    else if (w === 'מחר' || w === 'tomorrow') out.date = toDateString(nowL.plus({ days: 1 }));
    else {
      out.date = toDateString(nowL);
      if (w === 'הערב') out.dayHint = 'evening';
      if (w === 'הלילה' || w === 'tonight') out.dayHint = 'night';
    }
  }

  // ימי שבוע: "ביום חמישי", "בחמישי", "יום שני הבא"
  const weekdayAlt = Object.keys(HEBREW_WEEKDAYS).join('|');
  if (
    (m = take(
      new RegExp(
        `${B}(?:(?:ב|ל)?יום\\s+(${weekdayAlt})|(?:ב|ל)(${weekdayAlt})|(?:on\\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday))(?:\\s+(?:הבא|הקרוב|next))?${E}`,
      ),
    ))
  ) {
    const name = m[1] ?? m[2];
    const target = name ? HEBREW_WEEKDAYS[name] : ENGLISH_WEEKDAYS[m[3] ?? ''];
    if (target) {
      let diff = (target - nowL.weekday + 7) % 7;
      // אותו יום בשבוע = השבוע הבא (כך נוהגים לומר "ביום שני" כשהיום כבר שני)
      if (diff === 0) diff = 7;
      out.date = toDateString(nowL.plus({ days: diff }));
    }
  }

  // תאריך יום/חודש (סדר ישראלי): "ב-12/10", "12.10.2026"
  const dm = work.match(new RegExp(`${B}(?:ב|ל)?\\s?(\\d{1,2})[/.](\\d{1,2})(?:[/.](\\d{2,4}))?${E}`));
  if (dm) {
    const resolved = resolveDayMonth(Number(dm[1]), Number(dm[2]), dm[3], nowL);
    if (resolved) {
      take(new RegExp(`${B}(?:ב|ל)?\\s?${dm[1]}[/.]${dm[2]}(?:[/.]${dm[3] ?? ''})?${E}`));
      out.date = resolved;
    }
  }
  // "ב-12 באוקטובר"
  const monthAlt = Object.keys(HEBREW_MONTHS).join('|');
  const dmonth = work.match(new RegExp(`${B}(?:ב|ל)?\\s?(\\d{1,2})\\s+(?:ב|ל)?(${monthAlt})(?:\\s+(\\d{4}))?${E}`));
  if (dmonth) {
    const resolved = resolveDayMonth(Number(dmonth[1]), HEBREW_MONTHS[dmonth[2] ?? ''] ?? 0, dmonth[3], nowL);
    if (resolved) {
      take(new RegExp(`${B}(?:ב|ל)?\\s?${dmonth[1]}\\s+(?:ב|ל)?${dmonth[2]}(?:\\s+${dmonth[3] ?? ''})?${E}`));
      out.date = resolved;
    }
  }

  // 3) שעה
  if ((m = take(new RegExp(`${B}(?:(?:בשעה|at)\\s+|ב\\s?)?(\\d{1,2}):(\\d{2})(?:\\s*(am|pm))?${E}`)))) {
    out.hour = Number(m[1]);
    out.minute = Number(m[2]);
    out.is24h = true;
    if (m[3]) out.period = m[3] === 'am' ? 'morning' : 'evening';
  } else if ((m = take(new RegExp(`${B}(?:בשעה\\s+)?(?:ב)?רבע\\s+ל\\s?(\\d{1,2}|${HOUR_WORD_ALT})${E}`)))) {
    const h = parseNumber(m[1] ?? '', HOUR_WORDS);
    if (h !== null) {
      out.hour = h === 1 ? 12 : h === 0 ? 23 : h - 1;
      out.minute = 45;
      out.is24h = h >= 13;
    }
  } else if (
    (m = take(
      new RegExp(`${B}(?:(?:בשעה|at)\\s+|ב\\s?)(\\d{1,2}|${HOUR_WORD_ALT})(?:\\s+(${MINUTE_SUFFIX_ALT}))?(?:\\s*(am|pm))?${E}`),
    ))
  ) {
    applyHour(out, m[1] ?? '', m[2], m[3]);
  } else if (
    (m = take(
      new RegExp(`${B}(\\d{1,2}|${HOUR_WORD_ALT})(?:\\s+(${MINUTE_SUFFIX_ALT}))?(?:\\s*(am|pm)|(?=\\s+(?:${PERIOD_ALT})${E}))`),
    ))
  ) {
    applyHour(out, m[1] ?? '', m[2], m[3]);
  }

  // חלק היום: בבוקר / בצהריים / אחר הצהריים / בערב / בלילה
  if ((m = take(new RegExp(`${B}(${PERIOD_ALT})${E}`)))) {
    out.period = periodOf(m[1] ?? '') ?? out.period;
  }

  out.rest = orig.replace(/\s+/g, ' ').trim();
  return out;
}

function applyHour(out: WhenParts, rawHour: string, rawMinutes: string | undefined, ampm: string | undefined): void {
  const h = parseNumber(rawHour, HOUR_WORDS);
  if (h === null) return;
  out.hour = h;
  out.minute = rawMinutes ? (lookupWord(MINUTE_SUFFIX, rawMinutes) ?? 0) : 0;
  out.is24h = /^\d+$/.test(rawHour) && (h >= 13 || h === 0);
  if (ampm) out.period = ampm === 'am' ? 'morning' : 'evening';
}

function resolveDayMonth(day: number, month: number, yearRaw: string | undefined, nowL: DateTime): string | null {
  if (!(month >= 1 && month <= 12 && day >= 1 && day <= 31)) return null;
  let year = nowL.year;
  if (yearRaw) {
    year = Number(yearRaw);
    if (yearRaw.length === 2) year += 2000;
  }
  let dt = DateTime.fromObject({ year, month, day }, { zone: ZONE });
  if (!dt.isValid) return null;
  // בלי שנה ותאריך שכבר עבר — הכוונה לשנה הבאה
  if (!yearRaw && dt.startOf('day') < nowL.startOf('day')) {
    dt = DateTime.fromObject({ year: year + 1, month, day }, { zone: ZONE });
    if (!dt.isValid) return null;
  }
  return toDateString(dt);
}

/** המרה ל-24 שעות לפי חלק היום. plusDay = השעה שייכת ללילה שאחרי היום שנאמר. */
function hourWithPeriod(h: number, period: DayPeriod): { hour: number; plusDay: boolean } {
  switch (period) {
    case 'morning':
      return { hour: h === 12 ? 12 : h, plusDay: false };
    case 'noon':
      return { hour: h === 12 ? 12 : h <= 5 ? h + 12 : h, plusDay: false };
    case 'afternoon':
      return { hour: h === 12 ? 12 : h + 12, plusDay: false };
    case 'evening':
      return h === 12 ? { hour: 0, plusDay: true } : { hour: h + 12, plusDay: false };
    case 'night':
      if (h === 12) return { hour: 0, plusDay: true };
      if (h <= 5) return { hour: h, plusDay: true };
      return { hour: h + 12, plusDay: false };
  }
}

/* ------------------------------------------------------------------ */
/* תזכורות                                                              */
/* ------------------------------------------------------------------ */

function emptyDraft(): ReminderDraft {
  return { text: null, date: null, dayHint: null, hour: null, minute: 0, is24h: false, period: null, absolute: null };
}

function mergeWhen(draft: ReminderDraft, w: WhenParts): ReminderDraft {
  const next = { ...draft };
  if (w.absolute) next.absolute = w.absolute;
  if (w.date) next.date = w.date;
  if (w.dayHint) next.dayHint = w.dayHint;
  if (w.hour !== null) {
    next.hour = w.hour;
    next.minute = w.minute;
    next.is24h = w.is24h;
  }
  if (w.period) next.period = w.period;
  return next;
}

function cleanReminderText(raw: string): string | null {
  let t = raw.replace(/\s+/g, ' ').trim();
  t = t.replace(/^(?:על|ש|that|to)\s+/i, '').trim();
  return t ? t.slice(0, 300) : null;
}

function spokenTime(hour: number, minute: number): string {
  const name = HOUR_NAMES[hour];
  if (!name) return `ב-${hour}:${pad2(minute)}`;
  if (minute === 0) return `ב${name}`;
  if (minute === 30) return `ב${name} וחצי`;
  if (minute === 15) return `ב${name} ורבע`;
  return `ב-${hour}:${pad2(minute)}`;
}

function finalizeReminder(draft: ReminderDraft, now: Date): LocalIntent {
  const ask = (awaiting: 'ampm' | 'time' | 'when' | 'text', question_he: string, d: ReminderDraft = draft): LocalIntent => ({
    kind: 'clarify',
    question_he,
    pending: { kind: 'reminder', awaiting, draft: d },
  });

  if (draft.absolute) {
    if (!draft.text) return ask('text', 'על מה להזכיר לך?');
    return { kind: 'tool', tool: 'create_reminder', input: { text: draft.text, date: draft.absolute.date, time: draft.absolute.time } };
  }

  let hour = draft.hour;
  let minute = draft.minute;
  let is24h = draft.is24h;
  if (hour === null) {
    if (draft.period === 'noon') {
      hour = 12;
      minute = 0;
      is24h = true;
    } else if (draft.date === null && draft.period === null) {
      return ask('when', 'מתי להזכיר לך?');
    } else {
      return ask('time', 'באיזו שעה להזכיר לך?');
    }
  }

  let hour24: number;
  let plusDay = false;
  if (is24h && !(draft.period && hour <= 12)) {
    hour24 = hour;
  } else if (hour >= 13 || hour === 0) {
    hour24 = hour;
  } else {
    const period = draft.period ?? draft.dayHint;
    if (!period) {
      const phrase = spokenTime(hour, minute);
      const question = hour === 12 ? `${phrase} בצהריים או בלילה?` : `${phrase} בבוקר או בערב?`;
      return ask('ampm', question);
    }
    const r = hourWithPeriod(hour, period);
    hour24 = r.hour;
    plusDay = r.plusDay;
  }
  if (!(hour24 >= 0 && hour24 <= 23 && minute >= 0 && minute <= 59)) {
    return { kind: 'reply', reply_he: 'השעה שנאמרה לא תקינה. נסה למשל "מחר ב-20:30".' };
  }

  const nowL = localNow(now);
  let dateStr: string;
  if (draft.date) {
    let base = DateTime.fromISO(draft.date, { zone: ZONE });
    if (plusDay) base = base.plus({ days: 1 });
    dateStr = toDateString(base);
  } else {
    // לא נאמר יום: היום, ואם השעה כבר עברה — המופע הבא (מחר)
    let candidate = nowL.set({ hour: hour24, minute, second: 0, millisecond: 0 });
    if (candidate <= nowL) candidate = candidate.plus({ days: 1 }).set({ hour: hour24, minute });
    dateStr = toDateString(candidate);
  }
  const time = `${pad2(hour24)}:${pad2(minute)}`;

  if (!draft.text) {
    return ask('text', 'על מה להזכיר לך?', {
      ...draft,
      date: dateStr,
      hour: hour24,
      minute,
      is24h: true,
      period: null,
      dayHint: null,
    });
  }
  return { kind: 'tool', tool: 'create_reminder', input: { text: draft.text, date: dateStr, time } };
}

const REMINDER_CREATE_RES: RegExp[] = [
  /^(?:תזכיר|תזכירי|הזכר|הזכירי|להזכיר|תזכרי)\s+(?:לי\s+)?(.*)$/,
  /^(?:תקבע|קבע|תקבעי|קבעי|לקבוע|תיצור|צור|ליצור|תוסיף|הוסף|תוסיפי|להוסיף|תרשום|רשום|לרשום)\s+(?:לי\s+)?(?:(?:את\s+)?ה)?תזכורת\s*(.*)$/,
  /^remind\s+me\s*(.*)$/,
  /^(?:set|create|add)\s+(?:a\s+)?reminder\s*(.*)$/,
  /^תזכורת\s+(.+)$/,
];

function parseReminderCreate(p: Prepared, now: Date): LocalIntent | null {
  for (const re of REMINDER_CREATE_RES) {
    const m = p.low.match(re);
    if (!m) continue;
    const start = p.low.length - (m[1] ?? '').length;
    const sub: Prepared = { body: p.body.slice(start).trim(), low: p.low.slice(start).trim() };
    const when = extractWhen(sub, now);
    const draft = mergeWhen({ ...emptyDraft(), text: cleanReminderText(when.rest) }, when);
    if (re.source.startsWith('^תזכורת') && !when.found) return null;
    return finalizeReminder(draft, now);
  }
  return null;
}

function parseReminderCancel(p: Prepared): LocalIntent | null {
  const m = p.low.match(/^(?:בטל|תבטל|בטלי|תבטלי|לבטל|מחק|תמחק|תמחקי|למחוק|הסר|תסיר|להסיר|cancel|delete|remove)\s+(?:לי\s+)?(?:את\s+)?(?:ה)?(?:תזכורת|reminder|the\s+reminder)(?:\s+(.*))?$/);
  if (!m) return null;
  const queryLow = (m[1] ?? '').trim();
  const query = queryLow ? p.body.slice(p.low.length - queryLow.length).trim() : '';
  const cleaned = query.replace(/^(?:על|של|ש|about|to)\s+/i, '').trim();
  if (!cleaned) {
    return { kind: 'reply', reply_he: 'איזו תזכורת לבטל? אפשר להגיד למשל "בטל את התזכורת לשתות מים".' };
  }
  return { kind: 'tool', tool: 'cancel_reminder', input: { text_query: cleaned.slice(0, 200) } };
}

function parseReminderList(p: Prepared): LocalIntent | null {
  const low = p.low;
  if (!/(?:^|\s)(?:ה)?(?:תזכורות|תזכורת)(?:\s|$)|(?:^|\s)reminders(?:\s|$)/.test(low)) return null;
  const listy =
    /^(?:ה)?תזכורות(?:\s+שלי)?$/.test(low) ||
    /^(?:ה)?תזכורת$/.test(low) ||
    /^(?:מה|אילו|איזה|יש)\s/.test(low) ||
    /^(?:הצג|תציג|תציגי|תראה|תראי|הראה|תקריא|תקריאי|תגיד|תגידי|רשימת)\s/.test(low) ||
    /^(?:my\s+|list\s+|show\s+(?:my\s+)?)?reminders$/.test(low);
  if (!listy) return null;
  const filter = /הוחמצו|שהוחמצו|פספסתי|שפספסתי|החמצתי|missed/.test(low) ? 'missed' : /(?:^|\s)כל(?:\s|$)|(?:^|\s)all(?:\s|$)/.test(low) ? 'all' : 'upcoming';
  return { kind: 'tool', tool: 'list_reminders', input: { filter } };
}

/* ------------------------------------------------------------------ */
/* משימות                                                               */
/* ------------------------------------------------------------------ */

function sliceTail(p: Prepared, tailLow: string): string {
  return p.body.slice(p.low.length - tailLow.length).trim();
}

function parseTaskComplete(p: Prepared): LocalIntent | null {
  let m = p.low.match(/^(?:סיימתי|גמרתי|ביצעתי|השלמתי|עשיתי)(?:\s+(?:את\s+)?(?:(?:ה)?(?:משימה|מטלה)\s+)?(?:של\s+)?(.+))?$/);
  if (!m) {
    m = p.low.match(/^(?:סמן|תסמן|תסמני|סמני|לסמן)\s+(?:את\s+)?(?:(?:ה)?(?:משימה|מטלה)\s+)?(.+?)\s+(?:כבוצעה|כבוצע|כגמורה|כהושלמה|כסגורה|שבוצעה|שהסתיימה)$/);
  }
  if (!m) m = p.low.match(/^(?:mark|complete)\s+(?:the\s+)?(?:task\s+)?(.+?)(?:\s+as\s+done)?$/);
  if (!m) return null;
  const tailLow = (m[1] ?? '').trim();
  if (!tailLow) return { kind: 'reply', reply_he: 'איזו משימה סיימת? אפשר להגיד למשל "סיימתי את המשימה לסיים את השרטוט".' };
  // מוצאים את הזנב בכתיב המקורי לפי מיקום
  const idx = p.low.lastIndexOf(tailLow);
  const query = idx >= 0 ? p.body.slice(idx, idx + tailLow.length).trim() : tailLow;
  return { kind: 'tool', tool: 'complete_task', input: { title_query: query.slice(0, 200) } };
}

function parseTaskCreate(p: Prepared, now: Date): LocalIntent | null {
  const m =
    p.low.match(/^(?:תוסיף|הוסף|תוסיפי|הוסיפי|להוסיף|תרשום|רשום|תרשמי|רשמי|לרשום|צור|תיצור|תיצרי|ליצור|add|create)\s+(?:לי\s+)?(?:(?:a\s+)?(?:new\s+)?)(?:משימה|מטלה|task|todo)(?:\s+(?:חדשה|new))?(?:\s+(.+))?$/) ??
    p.low.match(/^(?:משימה|מטלה)\s+חדשה(?:\s+(.+))?$/);
  if (!m) return null;
  const tailLow = (m[1] ?? '').trim();
  if (!tailLow) return { kind: 'reply', reply_he: 'מה לרשום במשימה? אפשר להגיד למשל "תוסיף משימה לסיים את השרטוט".' };
  let title = sliceTail(p, tailLow);
  let dueDate: string | null = null;
  // תאריך יעד פשוט בסוף: "עד מחר", "למחר", "להיום"
  const due = title.match(/\s+(?:עד\s+|ל)(היום|מחר|מחרתיים)$/);
  if (due) {
    const nowL = localNow(now);
    const days = due[1] === 'היום' ? 0 : due[1] === 'מחר' ? 1 : 2;
    dueDate = toDateString(nowL.plus({ days }));
    title = title.slice(0, due.index ?? title.length).trim();
  }
  title = title.replace(/^(?:ש)\s+/, '').trim().slice(0, 200);
  if (!title) return { kind: 'reply', reply_he: 'מה לרשום במשימה?' };
  return { kind: 'tool', tool: 'create_task', input: dueDate ? { title, due_date: dueDate } : { title } };
}

function parseTaskList(p: Prepared): LocalIntent | null {
  const low = p.low;
  const today = /(?:^|\s)(?:ל|ש)?היום(?:\s|$)|(?:^|\s)today(?:\s|$)/.test(low);
  const isList =
    /(?:^|\s)(?:ה)?(?:משימות|מטלות)(?:\s|$)/.test(low) ||
    /^מה\s+יש\s+לי(?:\s+לעשות)?(?:\s+(?:ל|ש)?היום)?$/.test(low) ||
    /^מה\s+(?:אני\s+)?צריך\s+לעשות/.test(low) ||
    /^(?:my\s+)?(?:tasks|todos?|to\s+do\s+list)(?:\s+(?:for\s+)?today)?$/.test(low) ||
    /^what\s+do\s+i\s+have\s+to\s+do/.test(low);
  if (!isList) return null;
  const filter = today ? 'today' : /(?:^|\s)כל(?:\s|$)|(?:^|\s)all(?:\s|$)/.test(low) ? 'all' : 'open';
  return { kind: 'tool', tool: 'list_tasks', input: { filter } };
}

/* ------------------------------------------------------------------ */
/* מסך, מצב מערכת, מוזיקה                                              */
/* ------------------------------------------------------------------ */

function parseScreen(p: Prepared): LocalIntent | null {
  const low = p.low;
  const mentionsScreen = /(?:^|\s)(?:על\s+|את\s+)?(?:ב|ה|בה|ל|לה)?מסך(?:\s|$)/.test(low) || /(?:^|\s)screen(?:\s|$)/.test(low);
  const verb =
    /(?:^|\s)(?:תסתכל|תסתכלי|הסתכל|להסתכל|תביט|תביטי|תבדוק|תבדקי|לבדוק|תנתח|תנתחי|נתח|לנתח|תצלם|תצלמי|צלם|לצלם|תראה|תגיד|מה\s+(?:יש|רואים|קורה|לא\s+בסדר|הבעיה))(?:\s|$)/.test(
      low,
    ) || /(?:^|\s)(?:look|check|analy[sz]e|what)(?:\s|$)/.test(low);
  const explicit = /צילום\s+מסך|screenshot/.test(low);
  if (!((mentionsScreen && verb) || explicit)) return null;
  const question = p.body.slice(0, 500).trim() || 'מה רואים במסך?';
  return { kind: 'tool', tool: 'capture_screen_for_analysis', input: { question } };
}

function parseSystemStatus(p: Prepared): LocalIntent | null {
  const low = p.low;
  const hit =
    /(?:^|\s)(?:מצב|סטטוס|סטאטוס)\s+(?:ה)?(?:מערכת|מחשב)(?:\s|$)/.test(low) ||
    /^(?:סטטוס|סטאטוס|status|system\s+status)$/.test(low) ||
    /(?:^|\s)(?:בדיקת|ביצועי|עומס\s+(?:על\s+)?)(?:ה)?(?:מערכת|מחשב|מעבד)(?:\s|$)/.test(low) ||
    /^(?:כמה|מה)\s+(?:ה)?(?:זיכרון|זכרון|ram|מעבד|cpu|סוללה|מקום\s+(?:פנוי|בדיסק|בכונן))/.test(low) ||
    /^איך\s+(?:ה)?מחשב/.test(low);
  return hit ? { kind: 'tool', tool: 'get_system_status', input: {} } : null;
}

function parseMusic(p: Prepared, settings: Settings): LocalIntent | null {
  const low = p.low;
  const control =
    /(?:^|\s)(?:עצור|תעצור|השהה|תשהה|pause|resume|הבא|next|דלג|תדלג|תגביר|תנמיך|ווליום)(?:\s|$)/.test(low) &&
    /(?:מוזיקה|מוסיקה|שיר|ניגון|music|song|track|spotify|ספוטיפיי)/.test(low);
  if (control) {
    return { kind: 'reply', reply_he: 'שליטה בניגון (עצירה, שיר הבא, ווליום) עדיין לא מחוברת בגרסה הזו. אפשר לשלוט בזה ישירות ב-Spotify.' };
  }
  const play =
    /^(?:תנגן|נגן|תנגני|לנגן|תשמיע|השמע|תשמיעי|להשמיע|תשים|שים|תפעיל|תדליק|play)\s+(?:לי\s+)?(?:קצת\s+)?(?:(?:את\s+)?(?:ה)?(?:מוזיקה|מוסיקה|שיר|שירים)|משהו|music|some\s+music|a\s+song)/.test(low) ||
    /^(?:מוזיקה|מוסיקה|music)$/.test(low) ||
    /^(?:תנגן|נגן|תנגני|play)$/.test(low);
  if (!play) return null;
  const spotify = settings.launcher.apps.find((a) => a.id === 'spotify' && a.enabled);
  if (!spotify) {
    return {
      kind: 'reply',
      reply_he: 'שליטה בניגון מוזיקה לא מחוברת בגרסה הזו, ו-Spotify לא מופיע ברשימת התוכנות המאושרות. אפשר להוסיף אותו בהגדרות ← תוכנות ופרויקטים.',
    };
  }
  return { kind: 'tool', tool: 'open_application', input: { app_id: 'spotify' }, ack_he: MUSIC_ACK_HE };
}

/* ------------------------------------------------------------------ */
/* פתיחת תוכנות ופרויקטים                                               */
/* ------------------------------------------------------------------ */

const MATCH_THRESHOLD = 0.75;

interface Candidate {
  id: string;
  name: string;
  aliases: string[];
}

function rankCandidates(query: string, entries: Candidate[]): Array<{ id: string; score: number }> {
  return entries
    .map((e) => ({ id: e.id, score: Math.max(...[e.id, e.name, ...e.aliases].map((c) => matchScore(query, c))) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
}

/** מזהה מועמד יחיד וברור (בלי ניחוש בין כמה). */
function uniqueBest(ranked: Array<{ id: string; score: number }>): string | null {
  const top = ranked[0];
  if (!top || top.score < MATCH_THRESHOLD) return null;
  const second = ranked[1];
  if (second && second.score >= top.score - 0.05) return null;
  return top.id;
}

function isGenericProjectQuery(query: string): boolean {
  const words = query
    .split(' ')
    .map(foldToken)
    .filter((w) => !['את', 'שלי', 'my', 'the', 'a'].includes(w));
  if (words.length !== 1) return false;
  return /^(?:ה|ל|לה)?פרויקט$/.test(words[0] ?? '') || words[0] === 'project';
}

const OPEN_RE =
  /^(?:תפתח|פתח|תפתחי|פתחי|לפתוח|תפעיל|הפעל|תפעילי|הפעילי|להפעיל|תריץ|הרץ|תריצי|להריץ|תעלה|open|launch|start|run)(?:\s+(.*))?$/;

function parseOpen(p: Prepared, settings: Settings): LocalIntent | null {
  const m = p.low.match(OPEN_RE);
  if (!m) return null;
  let restLow = (m[1] ?? '').trim();
  let rest = restLow ? sliceTail(p, restLow) : '';
  // הסרת מילות קישור: "לי", "את", "the", "my", ומילים בסוף כמו "עכשיו"
  const leading = /^(?:לי\s+|את\s+|the\s+|my\s+)+/;
  const lm = restLow.match(leading);
  if (lm) {
    restLow = restLow.slice(lm[0].length);
    rest = rest.slice(lm[0].length);
  }
  const trailing = restLow.match(/\s+(?:עכשיו|now|לי)$/);
  if (trailing) rest = rest.slice(0, trailing.index ?? rest.length);
  rest = rest.trim();
  if (!rest) return { kind: 'reply', reply_he: 'מה לפתוח? אפשר להגיד למשל "תפתח את EPLAN" או "תפתח את הפרויקט".' };

  const projects: Candidate[] = settings.launcher.projects.filter((x) => x.enabled);
  const apps: Candidate[] = settings.launcher.apps.filter((x) => x.enabled);
  const mentionsProject = rest
    .split(' ')
    .map(foldToken)
    .some((w) => /^(?:ה|ל|לה)?פרויקט$/.test(w) || w === 'project');

  const defaultProject = (): LocalIntent => {
    const def = settings.launcher.projects.find((x) => x.id === settings.launcher.defaultProjectId && x.enabled);
    return { kind: 'tool', tool: 'open_project', input: def ? { project_id: def.id } : {} };
  };

  if (mentionsProject) {
    const best = uniqueBest(rankCandidates(rest, projects));
    if (best) return { kind: 'tool', tool: 'open_project', input: { project_id: best } };
    if (isGenericProjectQuery(rest)) return defaultProject();
    // כמה התאמות או אף אחת — הכלי יחזיר בקשת הבהרה / "לא נמצא" (לא מנחשים)
    return { kind: 'tool', tool: 'open_project', input: { project_name: rest.slice(0, 80) } };
  }

  const app = uniqueBest(rankCandidates(rest, apps));
  if (app) return { kind: 'tool', tool: 'open_application', input: { app_id: app } };
  const project = uniqueBest(rankCandidates(rest, projects));
  if (project) return { kind: 'tool', tool: 'open_project', input: { project_id: project } };
  // לא ברשימה / לא חד-משמעי: הכלי יענה (NOT_ALLOWLISTED עם רשימת התוכנות, או בקשת הבהרה)
  return { kind: 'tool', tool: 'open_application', input: { app_name: rest.slice(0, 80) } };
}

/* ------------------------------------------------------------------ */
/* תשובות קצרות                                                         */
/* ------------------------------------------------------------------ */

function parseSmallTalk(p: Prepared, now: Date): LocalIntent | null {
  const low = p.low;
  if (/^(?:מה\s+השעה|כמה\s+השעה|what\s+time\s+is\s+it)(?:\s+עכשיו)?$/.test(low)) {
    const t = localNow(now);
    return { kind: 'reply', reply_he: `השעה ${pad2(t.hour)}:${pad2(t.minute)}.` };
  }
  if (/^(?:מה\s+(?:ה)?תאריך|איזה\s+יום|מה\s+היום|איזה\s+תאריך)(?:\s+היום)?$/.test(low)) {
    const label = new Intl.DateTimeFormat('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: ZONE }).format(now);
    return { kind: 'reply', reply_he: `היום ${label}.` };
  }
  if (/^(?:תודה(?:\s+רבה)?|thanks|thank\s+you)$/.test(low)) return { kind: 'reply', reply_he: 'בשמחה.' };
  if (/^(?:שלום|היי|הי|hello|hi|hey|בוקר\s+טוב|ערב\s+טוב)$/.test(low)) return { kind: 'reply', reply_he: 'שלום! במה אפשר לעזור?' };
  return null;
}

/* ------------------------------------------------------------------ */
/* API                                                                  */
/* ------------------------------------------------------------------ */

export function parseLocalIntent(text: string, settings: Settings, now: Date): LocalIntent {
  const p = prepare(text);
  if (!p.low) {
    // רק "ג'רוויס" — מאשרים שמקשיבים
    return prep(text) ? { kind: 'reply', reply_he: 'כן? במה אפשר לעזור?' } : { kind: 'none' };
  }
  if (isCancelLow(p.low)) return { kind: 'cancel' };

  return (
    parseReminderCancel(p) ??
    parseReminderCreate(p, now) ??
    parseReminderList(p) ??
    parseTaskComplete(p) ??
    parseTaskCreate(p, now) ??
    parseScreen(p) ??
    parseTaskList(p) ??
    parseSystemStatus(p) ??
    parseMusic(p, settings) ??
    parseOpen(p, settings) ??
    parseSmallTalk(p, now) ?? { kind: 'none' }
  );
}

const ORDINALS: Array<[RegExp, number]> = [
  [/^(?:ה)?(?:ראשון|ראשונה)$|^(?:1|אחד|אחת|first|one)$/, 0],
  [/^(?:ה)?(?:שני|שנייה|שניה)$|^(?:2|שתיים|שתים|second|two)$/, 1],
  [/^(?:ה)?(?:שלישי|שלישית)$|^(?:3|שלוש|third|three)$/, 2],
  [/^(?:ה)?(?:רביעי|רביעית)$|^(?:4|ארבע|fourth|four)$/, 3],
];

const AFFIRMATIVE = /^(?:כן|yes|אוקיי|אוקי|ok|okay|בסדר|נכון)$/;

function resolveChoice(pending: Extract<PendingClarification, { kind: 'choose-option' }>, p: Prepared): LocalIntent {
  // "כן" כשיש אפשרות אחת בלבד (למשל הזזת שעה במעבר שעון) = בחירה בה
  if (AFFIRMATIVE.test(p.low) && pending.options.length === 1) {
    const only = pending.options[0]!;
    return { kind: 'tool', tool: pending.tool, input: { ...(pending.baseInput ?? {}), [pending.field]: only.id } };
  }
  const answer = p.low
    .replace(/^(?:כן|yes|אוקיי|אוקי|ok|okay|בסדר)\s+/, '')
    .replace(/^(?:את\s+)?/, '')
    .replace(/^(?:ה)?(?:פרויקט|משימה|תזכורת|תוכנה)\s+/, '');
  // מילות הסדר כתובות עם אותיות סופיות — משווים לטקסט הלא-מקופל
  let index: number | null = null;
  for (const [re, i] of ORDINALS) if (re.test(answer)) index = i;
  if (/^(?:ה)?אחרון$|^(?:ה)?אחרונה$|^last$/.test(answer)) index = pending.options.length - 1;
  let option = index !== null ? pending.options[index] : undefined;
  if (!option) {
    const ranked = pending.options
      .map((o) => ({ o, score: Math.max(matchScore(p.body, o.label), matchScore(answer, o.label), matchScore(answer, o.id)) }))
      .sort((a, b) => b.score - a.score);
    const top = ranked[0];
    const second = ranked[1];
    if (top && top.score >= 0.6 && !(second && second.score >= top.score - 0.05)) option = top.o;
  }
  if (!option) return { kind: 'none' };
  return { kind: 'tool', tool: pending.tool, input: { ...(pending.baseInput ?? {}), [pending.field]: option.id } };
}

export function resolveClarification(pending: PendingClarification, answer: string, settings: Settings, now: Date): LocalIntent {
  void settings;
  const p = prepare(answer);
  if (!p.low) return { kind: 'none' };
  if (isCancelLow(p.low)) return { kind: 'cancel' };

  if (pending.kind === 'choose-option') return resolveChoice(pending, p);

  const draft = pending.draft;
  switch (pending.awaiting) {
    case 'ampm': {
      const bare = BARE_PERIODS[p.low.replace(/\s+/g, ' ')];
      if (bare) return finalizeReminder({ ...draft, period: bare }, now);
      const w = extractWhen(p, now);
      if (w.period || w.is24h || (w.hour !== null && (w.hour >= 13 || w.hour === 0))) {
        return finalizeReminder(mergeWhen(draft, w), now);
      }
      return { kind: 'none' };
    }
    case 'time':
    case 'when': {
      const w = extractWhen(p, now);
      if (!w.found) {
        const bare = BARE_PERIODS[p.low.replace(/\s+/g, ' ')];
        if (bare) return finalizeReminder({ ...draft, period: bare }, now);
        return { kind: 'none' };
      }
      return finalizeReminder(mergeWhen(draft, w), now);
    }
    case 'text': {
      const text = cleanReminderText(p.body);
      if (!text) return { kind: 'none' };
      return finalizeReminder({ ...draft, text }, now);
    }
  }
}

/** שדה המזהה לכל כלי שיכול להחזיר אפשרויות לבחירה. */
const CHOICE_FIELDS: Partial<Record<ToolName, string>> = {
  open_project: 'project_id',
  open_application: 'app_id',
  complete_task: 'task_id',
  cancel_reminder: 'reminder_id',
};

/**
 * כשכלי ביקש הבהרה עם אפשרויות — שומרים אותן כדי שהתשובה הבאה ("הראשון" / שם) תמשיך את הפעולה.
 * בתזכורת שנופלת על מעבר שעון: DST_AMBIGUOUS -> dst_choice, DST_GAP -> time (עם שאר הפרמטרים המקוריים).
 */
export function pendingFromToolResult(tool: ToolName, result: ToolResult, input: Record<string, unknown> = {}): PendingClarification | null {
  if (result.status !== 'needs_clarification' || !result.options?.length) return null;
  let field = CHOICE_FIELDS[tool];
  let baseInput: Record<string, unknown> | undefined;
  if (tool === 'create_reminder') {
    if (result.error_code === 'DST_AMBIGUOUS') field = 'dst_choice';
    else if (result.error_code === 'DST_GAP') field = 'time';
    else return null;
    baseInput = { ...input };
    delete baseInput[field];
  }
  if (!field) return null;
  return {
    kind: 'choose-option',
    tool,
    field,
    options: result.options.slice(0, 10).map((o) => ({ id: o.id, label: o.label })),
    ...(baseInput ? { baseInput } : {}),
  };
}

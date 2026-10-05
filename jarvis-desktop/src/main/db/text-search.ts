import { editDistance, matchScore, normalizeForMatch, stripHebrewPrefixes } from '../../shared/text-normalize';

/**
 * חיפוש טקסט חופשי במשימות ובתזכורות ("סיימתי את הדוח", "בטל את התזכורת לשתות מים").
 * מבוסס על normalizeForMatch + matchScore המשותפים, ועוד התאמת מילים
 * (כולל תחיליות עבריות נפוצות) כדי ש"הדוח החודשי" ימצא את "לשלוח דוח חודשי".
 */

/** ציון מינימלי כדי שפריט ייחשב תוצאת חיפוש בכלל. */
export const MIN_SEARCH_SCORE = 0.2;
/** ציון שמעליו התאמה יחידה נחשבת ודאית מספיק לביצוע פעולה בלי לשאול. */
export const STRONG_MATCH_SCORE = 0.5;
/**
 * התאמה "מטושטשת" (מרחק עריכה — של המחרוזת כולה או של מילה בודדת, או הכלה שלא על גבול מילה)
 * מוגבלת מתחת לסף החזק: "להתקשר לאמא" מול "להתקשר לאבא", "לשלוח לאורי" מול "לשלוח לאורית",
 * "לנועה" מול "לנועם" — שונות באות אחת אבל במשמעות. מציעים ("התכוונת ל...?"), לעולם לא מבצעים לבד.
 */
export const FUZZY_CAP = 0.45;

/** מילים שלא מבדילות בין משימות. */
const STOP_WORDS = new Set([
  'את',
  'של',
  'על',
  'עם',
  'שלי',
  'לגבי',
  'משימה',
  'המשימה',
  'משימת',
  'תזכורת',
  'התזכורת',
  'the',
  'a',
  'an',
  'to',
  'my',
  'task',
  'reminder',
]);

const CLITIC_PREFIX = /^[הוכלבמש]/u;

function tokens(normalized: string): string[] {
  return normalized.split(' ').filter((t) => t.length > 0);
}

/** הסרת אות-תחילית אחת (ה/ו/כ/ל/ב/מ/ש) כשנשאר שורש של 3 אותיות לפחות. */
function stripClitic(token: string): string {
  return CLITIC_PREFIX.test(token) && token.length >= 4 ? token.slice(1) : token;
}

/** 'exact' = אותה מילה (גם אחרי הסרת תחילית), 'fuzzy' = שונה באות אחת, null = לא תואמת. */
function tokenMatch(q: string, c: string): 'exact' | 'fuzzy' | null {
  if (q === c) return 'exact';
  if (stripClitic(q) === c || q === stripClitic(c) || stripClitic(q) === stripClitic(c)) return 'exact';
  return q.length >= 5 && c.length >= 5 && editDistance(q, c) <= 1 ? 'fuzzy' : null;
}

/**
 * כיסוי מילים: כמה ממילות השאילתה מופיעות בטקסט.
 * מילה שנמצאה רק בקירוב (אות אחת שונה — "לאורי"/"לאורית", "לנועה"/"לנועם") מגבילה את הציון
 * ל-FUZZY_CAP: זו עלולה להיות משימה אחרת לגמרי, ולכן היא מוצעת בלבד.
 */
function tokenCoverageScore(normQuery: string, normCandidate: string): number {
  const q = tokens(normQuery).filter((t) => !STOP_WORDS.has(t));
  const c = tokens(normCandidate);
  if (q.length === 0 || c.length === 0) return 0;
  let matched = 0;
  let fuzzy = false;
  for (const qt of q) {
    let best: 'exact' | 'fuzzy' | null = null;
    for (const ct of c) {
      const m = tokenMatch(qt, ct);
      if (m === 'exact') {
        best = 'exact';
        break;
      }
      if (m === 'fuzzy') best = 'fuzzy';
    }
    if (best !== null) matched++;
    if (best === 'fuzzy') fuzzy = true;
  }
  let score = 0;
  if (matched === q.length) score = q.length === 1 ? 0.6 : 0.7;
  else if (q.length >= 2 && matched / q.length >= 0.5) score = 0.1 + 0.3 * (matched / q.length);
  return fuzzy ? Math.min(score, FUZZY_CAP) : score;
}

/** הכלה של מילים שלמות בלבד: "לשלוח דוח" בתוך "לשלוח דוח חודשי" — כן; "לאורי" בתוך "לאורית" — לא. */
function containsWholeWords(haystack: string, needle: string): boolean {
  return ` ${haystack} `.includes(` ${needle} `);
}

/** ציון 0..1 בין שאילתה לטקסט של פריט. 1 = זהה אחרי נרמול. */
export function scoreText(query: string, candidate: string): number {
  const nq = normalizeForMatch(query);
  const nc = normalizeForMatch(candidate);
  if (!nq || !nc) return 0;
  if (nq === nc) return 1;
  const sq = stripHebrewPrefixes(nq);
  const sc = stripHebrewPrefixes(nc);
  // בונוס ההכלה של matchScore רק כשההכלה היא על גבולות מילים; אחרת (הכלה חלקית או מרחק עריכה) — תקרה
  const wholeWord = sq.length >= 3 && sc.length >= 3 && (containsWholeWords(sc, sq) || containsWholeWords(sq, sc));
  let base = matchScore(nq, nc);
  if (base > 0 && base < 1 && !wholeWord) base = Math.min(base, FUZZY_CAP);
  return Math.max(base, tokenCoverageScore(nq, nc));
}

export interface Ranked<T> {
  item: T;
  score: number;
}

/** מדרג פריטים לפי ציון (יורד), משאיר רק מעל הסף. מיון יציב — שוויון שומר על הסדר המקורי. */
export function rankByText<T>(query: string, items: readonly T[], textOf: (item: T) => string): Ranked<T>[] {
  return items
    .map((item, index) => ({ item, score: scoreText(query, textOf(item)), index }))
    .filter((r) => r.score >= MIN_SEARCH_SCORE)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ item, score }) => ({ item, score }));
}

export type SingleMatch<T> =
  | { kind: 'one'; item: T }
  | { kind: 'none' }
  /** כמה התאמות חזקות — חייבים לשאול. */
  | { kind: 'many'; items: T[] }
  /** רק התאמות חלשות — מציעים אותן כ"התכוונת ל...?" ולא מבצעים. */
  | { kind: 'weak'; items: T[] };

/**
 * בחירת פריט יחיד לפעולה עם תופעת לוואי (סימון כבוצע / ביטול).
 * לעולם לא מנחשים: רק התאמה מדויקת יחידה, או התאמה חזקה יחידה, נבחרות אוטומטית.
 * מאחר ש-FUZZY_CAP < STRONG_MATCH_SCORE, "חזקה" פירושה תמיד התאמה של מילים שלמות (כולל תחילית ה/ו/כ/ל/ב/מ/ש);
 * מועמד מוביל שאינו מדויק ואינו של מילים שלמות מחזיר 'weak' — והכלי שואל הבהרה עם אפשרויות.
 */
export function pickSingle<T>(ranked: readonly Ranked<T>[], maxOptions = 5): SingleMatch<T> {
  if (ranked.length === 0) return { kind: 'none' };
  const exact = ranked.filter((r) => r.score >= 1);
  if (exact.length === 1) return { kind: 'one', item: (exact[0] as Ranked<T>).item };
  if (exact.length > 1) return { kind: 'many', items: exact.slice(0, maxOptions).map((r) => r.item) };
  const strong = ranked.filter((r) => r.score >= STRONG_MATCH_SCORE);
  if (strong.length === 1) return { kind: 'one', item: (strong[0] as Ranked<T>).item };
  if (strong.length > 1) return { kind: 'many', items: strong.slice(0, maxOptions).map((r) => r.item) };
  return { kind: 'weak', items: ranked.slice(0, maxOptions).map((r) => r.item) };
}

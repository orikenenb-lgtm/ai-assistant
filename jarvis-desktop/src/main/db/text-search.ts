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
 * התאמה "מטושטשת" של המחרוזת כולה (מרחק עריכה) מוגבלת מתחת לסף החזק:
 * "להתקשר לאמא" מול "להתקשר לאבא" שונות באות אחת אבל במשמעות — מציעים, לא מבצעים.
 */
const FUZZY_CAP = 0.45;

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

function tokenMatches(q: string, c: string): boolean {
  if (q === c) return true;
  if (stripClitic(q) === c || q === stripClitic(c) || stripClitic(q) === stripClitic(c)) return true;
  return q.length >= 5 && c.length >= 5 && editDistance(q, c) <= 1;
}

/** כיסוי מילים: כמה ממילות השאילתה מופיעות בטקסט. */
function tokenCoverageScore(normQuery: string, normCandidate: string): number {
  const q = tokens(normQuery).filter((t) => !STOP_WORDS.has(t));
  const c = tokens(normCandidate);
  if (q.length === 0 || c.length === 0) return 0;
  const matched = q.filter((qt) => c.some((ct) => tokenMatches(qt, ct))).length;
  if (matched === q.length) return q.length === 1 ? 0.6 : 0.7;
  const ratio = matched / q.length;
  if (q.length >= 2 && ratio >= 0.5) return 0.1 + 0.3 * ratio;
  return 0;
}

/** ציון 0..1 בין שאילתה לטקסט של פריט. 1 = זהה אחרי נרמול. */
export function scoreText(query: string, candidate: string): number {
  const nq = normalizeForMatch(query);
  const nc = normalizeForMatch(candidate);
  if (!nq || !nc) return 0;
  if (nq === nc) return 1;
  const sq = stripHebrewPrefixes(nq);
  const sc = stripHebrewPrefixes(nc);
  const substring = sq.length >= 3 && sc.length >= 3 && (sq.includes(sc) || sc.includes(sq));
  let base = matchScore(nq, nc);
  if (base > 0 && base < 1 && !substring) base = Math.min(base, FUZZY_CAP);
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

/**
 * נרמול טקסט להתאמה בין מה שהמשתמש אמר/כתב לבין שמות תוכנות, פרויקטים ומשימות.
 * עברית: מסיר ניקוד, מאחד אותיות סופיות וגרשיים. אנגלית: אותיות קטנות.
 * טהור — בלי תלויות, שמיש גם ב-main וגם ב-renderer.
 */

const NIQQUD = /[֑-ׇ]/g;
const FINAL_LETTERS: Record<string, string> = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
const GERESH = /[׳״'"`‘’“”]/g;

export function normalizeForMatch(text: string): string {
  return text
    .normalize('NFKC')
    .replace(NIQQUD, '')
    .replace(GERESH, '')
    .toLowerCase()
    .replace(/[ךםןףץ]/g, (ch) => FINAL_LETTERS[ch] ?? ch)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** וריאציות נפוצות של "ג'רוויס" בתמלול/הקלדה, אחרי נרמול. */
const WAKE_PREFIXES = ['jarvis', 'גרוויס', 'גארוויס', 'גרביס', 'גארביס', 'גירוויס', 'גרויס', 'הי גרוויס', 'היי גרוויס', 'hey jarvis'];

/** מסיר פנייה ל-JARVIS ומילות נימוס מתחילת המשפט. מקבל טקסט מנורמל. */
export function stripAddressing(normalized: string): string {
  let out = normalized;
  let changed = true;
  while (changed) {
    changed = false;
    for (const prefix of WAKE_PREFIXES) {
      if (out === prefix) return '';
      if (out.startsWith(prefix + ' ')) {
        out = out.slice(prefix.length + 1);
        changed = true;
      }
    }
    for (const polite of ['בבקשה', 'please', 'אפשר', 'תוכל', 'תוכלי']) {
      if (out.startsWith(polite + ' ')) {
        out = out.slice(polite.length + 1);
        changed = true;
      }
    }
  }
  return out.replace(/\s*(בבקשה|please)$/u, '').trim();
}

/** מרחק לבנשטיין קטן להתאמה סלחנית לשגיאות תמלול קצרות. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    prev = cur;
  }
  return prev[b.length] ?? 0;
}

/**
 * ציון התאמה בין שאילתה לשם/כינוי (0..1). 1 = זהה אחרי נרמול.
 * מתחשב בתחיליות עבריות נפוצות (ה, את ה, ל, ב).
 */
export function matchScore(query: string, candidate: string): number {
  const q = stripHebrewPrefixes(normalizeForMatch(query));
  const c = stripHebrewPrefixes(normalizeForMatch(candidate));
  if (!q || !c) return 0;
  if (q === c) return 1;
  if (q.length >= 3 && c.length >= 3 && (q.includes(c) || c.includes(q))) {
    return 0.85 * (Math.min(q.length, c.length) / Math.max(q.length, c.length)) + 0.1;
  }
  const dist = editDistance(q, c);
  const maxLen = Math.max(q.length, c.length);
  if (maxLen >= 4 && dist <= Math.max(1, Math.floor(maxLen / 6))) {
    return 0.8 - dist * 0.05;
  }
  return 0;
}

export function stripHebrewPrefixes(normalized: string): string {
  return normalized
    .replace(/^את /u, '')
    .replace(/^ה(?=\p{L}{3,})/u, '')
    .trim();
}

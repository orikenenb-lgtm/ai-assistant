/**
 * ניסוח עברי טבעי לסיכומים שמוקראים בקול: רשימות, ספירות וקיצור.
 * טהור — בלי תלויות.
 */

const HEBREW_LETTER = /^[א-ת]/u;

/** "ו" החיבור: צמודה למילה עברית ("ולשלוח"), ועם מקף לפני לועזית/מספר ("ו-EPLAN"). */
function withVav(item: string): string {
  return HEBREW_LETTER.test(item) ? `ו${item}` : `ו-${item}`;
}

/** "א", "א וב", "א, ב וג". separator מאפשר "; " כשהפריטים עצמם מכילים פסיקים. */
export function joinHebrew(items: readonly string[], separator = ', '): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0] as string;
  const head = items.slice(0, -1).join(separator);
  return `${head}${separator === ', ' ? ' ' : separator}${withVav(items[items.length - 1] as string)}`;
}

/**
 * רשימה להקראה עם תקרה: "א, ב וג" או "א, ב, ג, ד, ה ועוד 3".
 */
export function joinHebrewCapped(items: readonly string[], max: number, separator = ', '): string {
  if (items.length <= max) return joinHebrew(items, separator);
  const shown = items.slice(0, max).join(separator);
  return `${shown} ועוד ${items.length - max}`;
}

/** ספירה של שם עצם נקבה: 1 -> "משימה אחת", אחרת "3 משימות". */
export function countFeminine(n: number, singular: string, plural: string): string {
  return n === 1 ? `${singular} אחת` : `${n} ${plural}`;
}

/** קיצור טקסט ארוך להקראה/כותרת. */
export function clip(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length <= max ? t : `${t.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

/** הסרת נקודה/סימן קריאה בסוף, כדי שהטקסט ישתלב באמצע משפט. */
export function stripTrailingPunctuation(text: string): string {
  return text.trim().replace(/[.!?。,;:]+$/u, '').trim();
}

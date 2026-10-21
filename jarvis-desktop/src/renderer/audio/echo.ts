import { normalizeForMatch } from '../../shared/text-normalize';
import type { EchoCheck } from './types';

/**
 * הגנת הד: האם התמלול החדש הוא כנראה JARVIS ששמע את עצמו (במיוחד בקול מערכת,
 * שעובר ישירות דרך Windows ולכן ביטול ההד של Chromium לא מכיר אותו).
 *
 * true רק אם:
 * 1. עברו לכל היותר 8 שניות מסוף ההקראה (ערך שלילי = עדיין מקריא -> בתוך החלון), וגם
 * 2. אחרי נרמול (ניקוד, אותיות סופיות, פיסוק): התמלול מופיע ברצף מילים שלמות בתוך הטקסט
 *    שהוקרא, או שדמיון ז'קארד בין קבוצות המילים ≥ 0.6.
 *
 * הגנה מפני "בליעת" פקודות קצרות לגיטימיות (סטייה מכוונת ומחמירה מהגדרת "מוכל" הגולמית):
 * - ההכלה נבדקת ברמת מילים שלמות, לא תווים — "כן" לא "מוכל" ב"כנראה".
 * - הכלה נחשבת הד רק מ-3 מילים ומעלה. משתמש שעונה "פרויקט הגמר" לשאלה
 *   "פרויקט הגמר או פרויקט המעבדה?" חוזר על חלק מהשאלה — זה לא הד.
 * - ז'קארד נחשב רק מ-2 מילים בתמלול, כדי ש"כן"/"לא"/"עצור" לעולם לא ייזרקו.
 */

export const ECHO_WINDOW_MS = 8_000;
export const ECHO_JACCARD_THRESHOLD = 0.6;
export const ECHO_MIN_CONTAINED_TOKENS = 3;
export const ECHO_MIN_JACCARD_TOKENS = 2;

function tokens(text: string): string[] {
  const normalized = normalizeForMatch(text);
  return normalized ? normalized.split(' ').filter(Boolean) : [];
}

/** האם needle מופיע כרצף מילים צמוד בתוך haystack. */
function containsSequence(haystack: readonly string[], needle: readonly string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

function jaccard(a: readonly string[], b: readonly string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const t of setA) if (setB.has(t)) intersection++;
  return intersection / (setA.size + setB.size - intersection);
}

export const isLikelyEcho: EchoCheck = (transcript, lastSpokenText, msSinceSpeechEnded) => {
  if (!lastSpokenText) return false;
  if (typeof msSinceSpeechEnded !== 'number' || Number.isNaN(msSinceSpeechEnded)) return false;
  if (msSinceSpeechEnded > ECHO_WINDOW_MS) return false;

  const heard = tokens(transcript);
  const spoken = tokens(lastSpokenText);
  if (heard.length === 0 || spoken.length === 0) return false;

  if (heard.length >= ECHO_MIN_CONTAINED_TOKENS && containsSequence(spoken, heard)) return true;
  // סופרים מילים שונות: "כן כן" הוא עדיין תשובה של מילה אחת
  if (new Set(heard).size >= ECHO_MIN_JACCARD_TOKENS && jaccard(heard, spoken) >= ECHO_JACCARD_THRESHOLD) return true;
  return false;
};

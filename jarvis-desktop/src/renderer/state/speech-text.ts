/**
 * הכנת טקסט להקראה: main מקבל עד 2500 תווים לבקשת הקראה אחת (SynthesizeRequestSchema), ואנחנו
 * שולחים עד 1500 — לכן תשובה ארוכה מחולקת לקטעים בגבולות משפט, בלי לחתוך מילה באמצע.
 */

export const MAX_SYNTH_CHARS = 1500;

/**
 * סוף משפט = סימן סיום (. ! ? … ; :) שאחריו רווח או סוף הטקסט.
 * כך "10:30", "3.5" או "www.example.com" לא נחתכים באמצע.
 */
const SENTENCE_END = /[.!?…;:]+(?=\s|$)\s*/g;

/** מפרק למשפטים בלי לאבד תווים (גם פיסוק בתחילת הטקסט נשמר). */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  let last = 0;
  for (const m of text.matchAll(SENTENCE_END)) {
    const end = m.index + m[0].length;
    if (end > last) out.push(text.slice(last, end));
    last = end;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** מצרף שני קטעי טקסט עם רווח אחד ביניהם (אם צריך). */
function joinWithSpace(a: string, b: string): string {
  if (!a) return b;
  return /\s$/.test(a) ? a + b : `${a} ${b}`;
}

/** מחלק טקסט לקטעים באורך מרבי maxLen, בגבולות משפט ואז בגבולות מילה. */
export function splitForSynthesis(text: string, maxLen = MAX_SYNTH_CHARS): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  if (clean.length <= maxLen) return [clean];

  const chunks: string[] = [];
  let current = '';

  const pushCurrent = () => {
    const t = current.trim();
    if (t) chunks.push(t);
    current = '';
  };

  for (const sentence of splitSentences(clean)) {
    const joined = joinWithSpace(current, sentence);
    if (joined.trim().length <= maxLen) {
      current = joined;
      continue;
    }
    pushCurrent();
    if (sentence.trim().length <= maxLen) {
      current = sentence;
      continue;
    }
    // משפט ארוך מדי: חלוקה לפי מילים (המשפט הבא יצורף אחרי רווח — לא "מודבק" למילה האחרונה)
    for (const word of sentence.split(' ')) {
      if (!word) continue;
      if ((current ? current.length + 1 : 0) + word.length <= maxLen) {
        current = current ? `${current} ${word}` : word;
        continue;
      }
      pushCurrent();
      if (word.length <= maxLen) {
        current = word;
      } else {
        // מילה ארוכה בלי רווחים (למשל קישור) — חיתוך קשיח
        for (let i = 0; i < word.length; i += maxLen) chunks.push(word.slice(i, i + maxLen));
      }
    }
  }
  pushCurrent();
  return chunks;
}

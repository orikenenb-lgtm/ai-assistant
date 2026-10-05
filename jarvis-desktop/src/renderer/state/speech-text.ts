/**
 * הכנת טקסט להקראה: main מקבל עד 1500 תווים לבקשת הקראה אחת (SynthesizeRequestSchema),
 * לכן תשובה ארוכה מחולקת לקטעים בגבולות משפט — בלי לחתוך מילה באמצע.
 */

export const MAX_SYNTH_CHARS = 1500;

/** מחלק טקסט לקטעים באורך מרבי maxLen, בגבולות משפט ואז בגבולות מילה. */
export function splitForSynthesis(text: string, maxLen = MAX_SYNTH_CHARS): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  if (clean.length <= maxLen) return [clean];

  // משפטים: עד סימן סוף משפט (כולל סימנים עבריים נפוצים) ורווח אחריו
  const sentences = clean.match(/[^.!?…;:\n]+[.!?…;:]*\s*/g) ?? [clean];
  const chunks: string[] = [];
  let current = '';

  const pushCurrent = () => {
    const t = current.trim();
    if (t) chunks.push(t);
    current = '';
  };

  for (const sentence of sentences) {
    if ((current + sentence).length <= maxLen) {
      current += sentence;
      continue;
    }
    pushCurrent();
    if (sentence.length <= maxLen) {
      current = sentence;
      continue;
    }
    // משפט ארוך מדי: חלוקה לפי מילים
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

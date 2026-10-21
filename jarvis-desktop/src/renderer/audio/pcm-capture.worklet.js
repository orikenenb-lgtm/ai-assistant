/* global AudioWorkletProcessor, registerProcessor */
/**
 * AudioWorklet ללכידת PCM מהמיקרופון. רץ בתהליכון האודיו של Chromium.
 *
 * הקובץ הוא JavaScript רגיל (לא TypeScript) בכוונה: Vite מעתיק אותו כנכס כפי שהוא
 * (new URL('./pcm-capture.worklet.js', import.meta.url)), והוא נטען מאותו מקור — כך שהוא עובר
 * את ה-CSP הקשיח (script-src 'self') גם ב-app://jarvis וגם בשרת הפיתוח. בלי imports.
 *
 * הפרוססור מצבר בלוקים של 128 דגימות למקטעים גדולים יותר (batchSize, ~32ms) ושולח אותם
 * ל-main thread עם העברת בעלות על ה-buffer (בלי העתקה). הוא לא מוציא אודיו (הפלט שקט).
 */

const DEFAULT_BATCH = 512;
const MIN_BATCH = 128;
const MAX_BATCH = 16384;

class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const requested = options && options.processorOptions ? options.processorOptions.batchSize : undefined;
    this.batchSize =
      Number.isInteger(requested) && requested >= MIN_BATCH && requested <= MAX_BATCH ? requested : DEFAULT_BATCH;
    this.buffer = new Float32Array(this.batchSize);
    this.filled = 0;
    this.stopped = false;
    this.port.onmessage = (event) => {
      if (event.data && event.data.type === 'stop') {
        // ההקלטה הסתיימה: מפסיקים לעבד, וה-node ישוחרר ע"י הדפדפן
        this.stopped = true;
        this.port.onmessage = null;
      }
    };
  }

  process(inputs) {
    if (this.stopped) return false;
    const input = inputs[0];
    // אין קלט מחובר (או שהמקור עוד לא התחיל) — ממשיכים לחכות
    if (!input || input.length === 0) return true;
    const channels = input.length;
    const first = input[0];
    const frames = first.length;
    for (let i = 0; i < frames; i++) {
      let sample = first[i];
      if (channels > 1) {
        // הגנה: ה-node מוגדר לערוץ אחד, אבל אם יגיע סטריאו — ממצעים למונו
        let sum = 0;
        for (let c = 0; c < channels; c++) sum += input[c][i];
        sample = sum / channels;
      }
      this.buffer[this.filled++] = sample;
      if (this.filled === this.batchSize) this.flush();
    }
    return true;
  }

  flush() {
    const out = this.buffer;
    this.buffer = new Float32Array(this.batchSize);
    this.filled = 0;
    this.port.postMessage(out, [out.buffer]);
  }
}

registerProcessor('jarvis-pcm-capture', PcmCaptureProcessor);

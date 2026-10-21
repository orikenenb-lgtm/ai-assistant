import type { WakeWordDetector } from '../types';

/**
 * נקודת החיבור למנוע מילת הפעלה אמיתי (openWakeWord ב-ONNX/WASM, או Porcupine).
 * המנוע רץ מקומית בלבד — שום אודיו לא יוצא מהמחשב.
 *
 * מנוע אמיתי מממש את WakeWordEngine (עיבוד מסגרות PCM 16kHz), ומחבר אותו ל-WakeWordDetector
 * שמנהל את המיקרופון, pause/resume ו-state. הרישום נעשה ב-factory שב-wakeword/index.ts.
 * קבצי המודל (.onnx/.ppn/.pv/.wasm) נטענים מתוך ה-renderer עצמו (CSP: 'self' + 'wasm-unsafe-eval').
 */

export type WakeWordEngineId = WakeWordDetector['engine'];

export interface WakeWordEngine {
  readonly id: WakeWordEngineId;
  /** קצב הדגימה שהמנוע מצפה לו (בפועל 16000). */
  readonly sampleRate: number;
  /** אורך מסגרת בדגימות (openWakeWord: 1280 = 80ms, Porcupine: 512 = 32ms). */
  readonly frameLength: number;
  /** טוען את המודלים. זורק Error עם הודעה בעברית אם חסר קובץ/מפתח. */
  load(options: { sensitivity: number }): Promise<void>;
  /** מעבד מסגרת אחת (-1..1). מחזיר true כשזוהתה מילת ההפעלה. */
  process(frame: Float32Array): boolean;
  /** משחרר זיכרון WASM/ONNX. */
  release(): Promise<void>;
}

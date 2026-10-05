import type { WakeWordDetector } from '../types';
import type { WakeWordEngineId } from './engine';
import { createUnavailableWakeWordDetector } from './unavailable';

/**
 * בחירת מנוע מילת ההפעלה. כרגע אף מנוע לא מותקן בגרסה, ולכן כל מנוע מחזיר גלאי
 * שנכשל בבירור. מנוע אמיתי ייכנס כאן (case מתאים) בשלב הבא — הממשק ו-index.ts לא ישתנו.
 */

export const WAKE_WORD_NOT_INSTALLED_MESSAGE = 'מנוע מילת ההפעלה עדיין לא הותקן בגרסה הזו';

export function createWakeWordDetectorFor(engine: WakeWordEngineId): WakeWordDetector {
  switch (engine) {
    case 'openwakeword':
      // TODO(שלב מילת ההפעלה): openWakeWord מקומי (onnxruntime-web + מודל "hey jarvis")
      return createUnavailableWakeWordDetector('openwakeword', WAKE_WORD_NOT_INSTALLED_MESSAGE);
    case 'porcupine':
      // TODO(שלב מילת ההפעלה): Picovoice Porcupine (WASM, דורש picovoiceAccessKey)
      return createUnavailableWakeWordDetector('porcupine', WAKE_WORD_NOT_INSTALLED_MESSAGE);
    default: {
      const unknown: never = engine;
      throw new Error(`מנוע מילת הפעלה לא מוכר: ${String(unknown)}`);
    }
  }
}

export type { WakeWordEngine, WakeWordEngineId } from './engine';

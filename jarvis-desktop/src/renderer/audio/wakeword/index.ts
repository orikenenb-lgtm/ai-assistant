import type { WakeWordDetector } from '../types';
import type { WakeWordEngineId } from './engine';
import { createOpenWakeWordDetector, createPorcupineBridgeDetector } from '../../../wakeword/detectors';

/**
 * בחירת מנוע מילת ההפעלה:
 * - openwakeword: "Hey Jarvis" — מקומי לחלוטין (onnxruntime-web + מודלים מקומיים), בלי מפתח.
 * - porcupine: "Jarvis" — המנוע והמפתח ב-main; כאן רק מזרימים אודיו מקומית ל-main.
 * המימושים ב-src/wakeword/ (כולל בדיקת התאמה מול מימוש הייחוס של openWakeWord).
 */

export function createWakeWordDetectorFor(engine: WakeWordEngineId): WakeWordDetector {
  switch (engine) {
    case 'openwakeword':
      return createOpenWakeWordDetector();
    case 'porcupine':
      return createPorcupineBridgeDetector();
    default: {
      const unknown: never = engine;
      throw new Error(`מנוע מילת הפעלה לא מוכר: ${String(unknown)}`);
    }
  }
}

export type { WakeWordEngine, WakeWordEngineId } from './engine';

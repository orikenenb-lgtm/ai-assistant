import type { WakeWordDetector } from '../types';
import type { WakeWordEngineId } from './engine';

/**
 * גלאי למנוע שעוד לא הותקן: לא מעמיד פנים שהוא מאזין.
 * start() נכשל עם הודעה ברורה בעברית ומעביר את המצב ל-'error', כדי שהממשק יציג את זה ולא "מאזין".
 */
export function createUnavailableWakeWordDetector(engine: WakeWordEngineId, message: string): WakeWordDetector {
  let state: WakeWordDetector['state'] = 'stopped';
  let lastError: string | null = null;
  return {
    engine,
    get state() {
      return state;
    },
    get lastError() {
      return lastError;
    },
    start() {
      state = 'error';
      lastError = message;
      return Promise.reject(new Error(message));
    },
    // אין האזנה פעילה — אין מה להשהות או לחדש
    pause() {},
    resume() {},
    stop() {
      state = 'stopped';
      return Promise.resolve();
    },
  };
}

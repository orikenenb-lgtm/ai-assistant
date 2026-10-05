import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ErrorCode } from '../../shared/types';
import type { Logger } from '../core/contracts';

/**
 * מילת ההפעלה "Jarvis" עם Picovoice Porcupine — רץ בתהליך main.
 * למה ב-main: מפתח ה-AccessKey נשאר ב-main (ה-renderer לעולם לא מקבל מפתחות).
 * ה-renderer רק מזרים פריימים של אודיו (16kHz, int16) דרך IPC — האודיו לא יוצא מהמחשב.
 * Porcupine מאמת את ה-AccessKey מול שרתי Picovoice (דורש אינטרנט לאימות), אבל לא מעלה אודיו.
 * מילת ההפעלה המובנית "jarvis" באנגלית (Porcupine לא תומך בעברית — לא נדרש, זו רק מילת ההפעלה).
 */

interface PorcupineHandle {
  readonly frameLength: number;
  readonly sampleRate: number;
  process(frame: Int16Array): number;
  release(): void;
}

interface PorcupineModule {
  Porcupine: new (
    accessKey: string,
    keywords: string[],
    sensitivities: number[],
    options?: { modelPath?: string; libraryPath?: string; device?: string },
  ) => PorcupineHandle;
  getBuiltinKeywordPath(keyword: string): string;
}

export type WakewordStartResult =
  | { ok: true; frameLength: number; sampleRate: number }
  | { ok: false; code: ErrorCode; message_he: string };

export interface PorcupineService {
  start(options: { sensitivity: number }): WakewordStartResult;
  /** מעבד פריים אחד או יותר (באורך frameLength כל אחד). מחזיר true אם זוהתה מילת ההפעלה. */
  process(samples: Int16Array): boolean;
  stop(): void;
  readonly running: boolean;
}

/** קבצים שהספרייה הנייטיבית קוראת חייבים להיות מחוץ ל-app.asar (asarUnpack). */
export function unpackedPath(p: string): string {
  return p.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
}

export function mapPorcupineError(err: unknown): { code: ErrorCode; message_he: string } {
  const name = err instanceof Error ? err.constructor.name || err.name : '';
  switch (name) {
    case 'PorcupineInvalidArgumentError':
      // נבדק בפועל: מפתח בפורמט שגוי מחזיר את השגיאה הזו כבר באתחול
      return { code: 'INVALID_API_KEY', message_he: 'מפתח Picovoice לא תקין. העתק אותו שוב מ-Picovoice Console.' };
    case 'PorcupineActivationError':
    case 'PorcupineKeyError':
      return { code: 'INVALID_API_KEY', message_he: 'מפתח Picovoice לא תקין, או שאין חיבור לאינטרנט לאימות המפתח.' };
    case 'PorcupineActivationLimitReachedError':
      return { code: 'RATE_LIMITED', message_he: 'הגעת למגבלת ההפעלות של חשבון Picovoice.' };
    case 'PorcupineActivationThrottledError':
      return { code: 'RATE_LIMITED', message_he: 'Picovoice הגביל זמנית את האימות. נסה שוב מאוחר יותר.' };
    case 'PorcupineActivationRefusedError':
      return { code: 'PERMISSION_DENIED', message_he: 'Picovoice דחה את המפתח. בדוק את החשבון ב-Picovoice Console.' };
    case 'PorcupineRuntimeError':
      return { code: 'PROVIDER_UNAVAILABLE', message_he: 'Porcupine לא נתמך במחשב הזה.' };
    default:
      return { code: 'INTERNAL', message_he: 'טעינת מנוע מילת ההפעלה נכשלה.' };
  }
}

export interface PorcupineServiceDeps {
  getAccessKey: () => string | null;
  logger: Logger;
  /** טעינת המודול הנייטיבי — מוזרק לבדיקות. */
  loadModule?: () => PorcupineModule;
}

export function createPorcupineService(deps: PorcupineServiceDeps): PorcupineService {
  let handle: PorcupineHandle | null = null;
  let buffer = new Int16Array(0);

  const load = deps.loadModule ?? (() => {
    // require דינמי: המודול נשאר חיצוני ל-bundle (esbuild external) ונטען רק כשהמשתמש מפעיל את Porcupine
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@picovoice/porcupine-node') as PorcupineModule;
  });

  return {
    get running() {
      return handle !== null;
    },
    start({ sensitivity }) {
      if (handle) return { ok: true, frameLength: handle.frameLength, sampleRate: handle.sampleRate };
      const key = deps.getAccessKey();
      if (!key) return { ok: false, code: 'MISSING_API_KEY', message_he: 'כדי להשתמש במילה "Jarvis" צריך AccessKey חינמי של Picovoice. הוסף אותו בהגדרות ← מילת הפעלה.' };
      try {
        const mod = load();
        const keywordPath = unpackedPath(mod.getBuiltinKeywordPath('jarvis'));
        // <pkg>/resources/keyword_files/<platform>/jarvis_<platform>.ppn → <pkg>
        const pkgRoot = dirname(dirname(dirname(dirname(keywordPath))));
        const modelPath = unpackedPath(join(pkgRoot, 'lib', 'common', 'porcupine_params.pv'));
        const options = existsSync(modelPath) ? { modelPath } : {};
        handle = new mod.Porcupine(key, [keywordPath], [Math.min(0.95, Math.max(0.1, sensitivity))], options);
        buffer = new Int16Array(0);
        deps.logger.info('wakeword.porcupine_started', { frameLength: handle.frameLength, sampleRate: handle.sampleRate });
        return { ok: true, frameLength: handle.frameLength, sampleRate: handle.sampleRate };
      } catch (err) {
        const mapped = mapPorcupineError(err);
        deps.logger.warn('wakeword.porcupine_failed', { code: mapped.code, error: err instanceof Error ? err.message : String(err) });
        handle = null;
        return { ok: false, ...mapped };
      }
    },
    process(samples) {
      if (!handle) return false;
      const merged = new Int16Array(buffer.length + samples.length);
      merged.set(buffer, 0);
      merged.set(samples, buffer.length);
      const fl = handle.frameLength;
      let detected = false;
      let offset = 0;
      while (merged.length - offset >= fl) {
        try {
          if (handle.process(merged.subarray(offset, offset + fl)) >= 0) detected = true;
        } catch (err) {
          deps.logger.warn('wakeword.porcupine_process_error', { error: err instanceof Error ? err.message : String(err) });
        }
        offset += fl;
      }
      buffer = merged.slice(offset);
      return detected;
    },
    stop() {
      if (handle) {
        try {
          handle.release();
        } catch {
          // כבר משוחרר
        }
      }
      handle = null;
      buffer = new Int16Array(0);
    },
  };
}

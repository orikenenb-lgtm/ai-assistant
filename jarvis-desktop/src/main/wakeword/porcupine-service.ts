import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { WakewordSessionStatus } from '../../shared/api-types';
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
  | { ok: true; frameLength: number; sampleRate: number; sessionId: string }
  | { ok: false; code: ErrorCode; message_he: string };

/**
 * מצב סשן של מילת ההפעלה, כפי שה-renderer שואל עליו (wakeword:status):
 * - running: המנוע פעיל ומעבד את הפריימים של הסשן הזה.
 * - failed: המנוע נפל באמצע (שגיאות עיבוד חוזרות) — ה-renderer מציג שגיאה ומנסה שוב בהשהיה.
 * - stopped: הסשן הזה כבר לא פעיל (נעצר, או שסשן חדש החליף אותו).
 */
export type { WakewordSessionStatus };

/**
 * מנוע אחד לכל התהליך, עם "סשן" לכל הפעלה מה-renderer.
 * למה סשנים: גלאי ישן ב-renderer (למשל אחרי שינוי הגדרות מהיר או "הפעל מחדש" כפול) עלול לקרוא ל-stop
 * או לשלוח פריימים אחרי שגלאי חדש כבר התחיל. main מתעלם מכל מזהה סשן שאינו הנוכחי,
 * כך שגלאי ישן לא יכול לכבות את המנוע של הגלאי החדש ולא להזרים אליו אודיו.
 */
export interface PorcupineService {
  /** מתחיל סשן חדש (מחליף כל סשן קודם). */
  start(options: { sensitivity: number }): WakewordStartResult;
  /** מעבד פריים אחד או יותר (באורך frameLength כל אחד) של הסשן. מחזיר true אם זוהתה מילת ההפעלה. */
  process(sessionId: string, samples: Int16Array): boolean;
  status(sessionId: string): WakewordSessionStatus;
  /** עוצר את הסשן אם הוא הנוכחי (מזהה ישן — מתעלמים). בלי מזהה: עוצר הכול (יציאה מהאפליקציה). */
  stop(sessionId?: string): void;
  readonly running: boolean;
}

/** קבצים שהספרייה הנייטיבית קוראת חייבים להיות מחוץ ל-app.asar (asarUnpack). */
export function unpackedPath(p: string): string {
  return p.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
}

export const VCREDIST_MESSAGE =
  'מנוע Porcupine דורש את Microsoft Visual C++ Redistributable (2015–2022, x64). התקן אותו מאתר Microsoft והפעל מחדש את JARVIS. מילת ההפעלה "Hey Jarvis" (openWakeWord) עובדת גם בלעדיו.';

/** טעינת ספרייה נייטיבית שנכשלה כי חסרה תלות (ב-Windows: בדרך כלל ה-VC++ Redistributable, שגיאה 126). */
export function isMissingNativeDependency(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as { code?: unknown }).code;
  const message = err instanceof Error ? err.message : String((err as { message?: unknown }).message ?? '');
  if (code === 'MODULE_NOT_FOUND') return true;
  if (/the specified module could not be found/i.test(message)) return true;
  // dlopen ב-Windows: "error 126" / "Error: 126" — רק כשההקשר הוא טעינת ספרייה, לא כל מספר 126
  return (code === 'ERR_DLOPEN_FAILED' || /\.node\b|dlopen|LoadLibrary/i.test(message)) && /\b126\b/.test(message);
}

export function mapPorcupineError(err: unknown): { code: ErrorCode; message_he: string } {
  if (isMissingNativeDependency(err)) return { code: 'PROVIDER_UNAVAILABLE', message_he: VCREDIST_MESSAGE };
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
  /** מזהה סשן (ברירת מחדל: randomUUID). מוזרק לבדיקות. */
  newSessionId?: () => string;
}

/** כמה שגיאות עיבוד ברצף מסמנות את הסשן כנפול (שגיאה בודדת עלולה להיות חולפת). */
export const PROCESS_ERRORS_TO_FAIL = 3;
export const SESSION_FAILED_MESSAGE = 'מנוע Porcupine הפסיק לעבוד באמצע ההאזנה.';

export function createPorcupineService(deps: PorcupineServiceDeps): PorcupineService {
  let handle: PorcupineHandle | null = null;
  let handleSensitivity: number | null = null;
  let buffer = new Int16Array(0);
  let sessionId: string | null = null;
  let failedMessage: string | null = null;
  let consecutiveErrors = 0;
  const newSessionId = deps.newSessionId ?? randomUUID;

  const load = deps.loadModule ?? (() => {
    // require דינמי: המודול נשאר חיצוני ל-bundle (esbuild external) ונטען רק כשהמשתמש מפעיל את Porcupine
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@picovoice/porcupine-node') as PorcupineModule;
  });

  function release(): void {
    if (handle) {
      try {
        handle.release();
      } catch {
        // כבר משוחרר
      }
    }
    handle = null;
    handleSensitivity = null;
    buffer = new Int16Array(0);
  }

  return {
    get running() {
      return handle !== null;
    },
    start({ sensitivity }) {
      const clamped = Math.min(0.95, Math.max(0.1, sensitivity));
      // סשן חדש מבטל את הקודם תמיד — גם אם המנוע עצמו נשאר טעון
      sessionId = null;
      failedMessage = null;
      consecutiveErrors = 0;
      buffer = new Int16Array(0);
      // אותה רגישות: משתמשים שוב במנוע הטעון (האתחול מאמת את המפתח מול Picovoice ולוקח זמן)
      if (handle && handleSensitivity === clamped) {
        sessionId = newSessionId();
        return { ok: true, frameLength: handle.frameLength, sampleRate: handle.sampleRate, sessionId };
      }
      release();
      const key = deps.getAccessKey();
      if (!key) return { ok: false, code: 'MISSING_API_KEY', message_he: 'כדי להשתמש במילה "Jarvis" צריך AccessKey חינמי של Picovoice. הוסף אותו בהגדרות ← מילת הפעלה.' };
      try {
        const mod = load();
        const keywordPath = unpackedPath(mod.getBuiltinKeywordPath('jarvis'));
        // <pkg>/resources/keyword_files/<platform>/jarvis_<platform>.ppn → <pkg>
        const pkgRoot = dirname(dirname(dirname(dirname(keywordPath))));
        const modelPath = unpackedPath(join(pkgRoot, 'lib', 'common', 'porcupine_params.pv'));
        const options = existsSync(modelPath) ? { modelPath } : {};
        handle = new mod.Porcupine(key, [keywordPath], [clamped], options);
        handleSensitivity = clamped;
        sessionId = newSessionId();
        deps.logger.info('wakeword.porcupine_started', { frameLength: handle.frameLength, sampleRate: handle.sampleRate });
        return { ok: true, frameLength: handle.frameLength, sampleRate: handle.sampleRate, sessionId };
      } catch (err) {
        const mapped = mapPorcupineError(err);
        deps.logger.warn('wakeword.porcupine_failed', { code: mapped.code, error: err instanceof Error ? err.message : String(err) });
        release();
        return { ok: false, ...mapped };
      }
    },
    process(id, samples) {
      // פריימים מסשן ישן (גלאי שכבר הוחלף) — לא מגיעים למנוע
      if (!handle || id !== sessionId) return false;
      const merged = new Int16Array(buffer.length + samples.length);
      merged.set(buffer, 0);
      merged.set(samples, buffer.length);
      const fl = handle.frameLength;
      let detected = false;
      let offset = 0;
      while (handle && merged.length - offset >= fl) {
        try {
          if (handle.process(merged.subarray(offset, offset + fl)) >= 0) detected = true;
          consecutiveErrors = 0;
        } catch (err) {
          consecutiveErrors++;
          deps.logger.warn('wakeword.porcupine_process_error', { error: err instanceof Error ? err.message : String(err), consecutive: consecutiveErrors });
          if (consecutiveErrors >= PROCESS_ERRORS_TO_FAIL) {
            // המנוע במצב לא תקין: משחררים אותו ומסמנים את הסשן כנפול. ה-renderer רואה זאת ב-status.
            failedMessage = SESSION_FAILED_MESSAGE;
            release();
            deps.logger.warn('wakeword.porcupine_session_failed', {});
            return false;
          }
        }
        offset += fl;
      }
      buffer = merged.slice(offset);
      return detected;
    },
    status(id) {
      if (id !== sessionId) return { state: 'stopped' };
      if (failedMessage) return { state: 'failed', message_he: failedMessage };
      return handle ? { state: 'running' } : { state: 'stopped' };
    },
    stop(id) {
      // עצירה מגלאי ישן לא מכבה את המנוע של הגלאי הנוכחי
      if (id !== undefined && id !== sessionId) {
        deps.logger.debug('wakeword.porcupine_stale_stop', {});
        return;
      }
      release();
      sessionId = null;
      failedMessage = null;
      consecutiveErrors = 0;
    },
  };
}

/**
 * המרת שגיאות להודעות בעברית ברורות למשתמש.
 * שגיאות המיקרופון מזוהות לפי צורה (name + kind) ולא לפי instanceof,
 * כדי לא לייבא את מימוש שכבת האודיו לבקר ולבדיקות.
 */
import type { MicError } from '../audio';
import { he } from '../i18n/he';

type MicErrorKind = MicError['kind'];

const MIC_KINDS: readonly MicErrorKind[] = ['permission-denied', 'no-device', 'device-busy', 'unsupported', 'unknown'];

export function isMicErrorLike(err: unknown): err is { name: 'MicError'; kind: MicErrorKind; message: string } {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { name?: unknown; kind?: unknown };
  return e.name === 'MicError' && typeof e.kind === 'string' && (MIC_KINDS as readonly string[]).includes(e.kind);
}

/** הודעת שגיאה כללית מתוך ערך שנזרק. */
export function errorText(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err) return err;
  return he.errors.unknown;
}

const HEBREW_RE = /[֐-׿]/;
const HEBREW_LETTERS = /[א-ת]/g;
const LATIN_LETTERS = /[A-Za-z]/g;
/** הקידומת ש-Electron מוסיף לשגיאה שנזרקה ב-handler של main. */
const ELECTRON_IPC_PREFIX = /^\s*Error invoking remote method '[^']*':\s*/;
const ERROR_NAME_PREFIX = /^(?:[A-Za-z]*Error:\s*)+/;

/** מסיר את הקידומת הטכנית של Electron ("Error invoking remote method …: Error: ") מהודעת שגיאה. */
export function stripIpcPrefix(text: string): string {
  return text.replace(ELECTRON_IPC_PREFIX, '').replace(ERROR_NAME_PREFIX, '').trim();
}

/**
 * האם הטקסט הוא הודעה בעברית שמיועדת למשתמש (ולא שגיאה טכנית באנגלית שיש בה מילה עברית):
 * האות הראשונה עברית, ואין "זנב" טכני ארוך באנגלית (אותיות לטיניות פי 3 ומעלה מהעבריות).
 * שמות מוצר באנגלית בתוך משפט עברי (Picovoice, Visual C++) עדיין נחשבים הודעה למשתמש.
 */
export function isUserFacingHebrew(text: string): boolean {
  const firstLetter = /[A-Za-zא-ת]/.exec(text)?.[0];
  if (!firstLetter || !HEBREW_RE.test(firstLetter)) return false;
  const hebrew = text.match(HEBREW_LETTERS)?.length ?? 0;
  const latin = text.match(LATIN_LETTERS)?.length ?? 0;
  return hebrew * 3 >= latin;
}

/** ההודעה אחרי ניקוי הקידומת הטכנית — אם היא הודעה בעברית למשתמש; אחרת null. */
export function userFacingHebrew(text: string | null | undefined): string | null {
  const clean = stripIpcPrefix(text ?? '');
  return clean && isUserFacingHebrew(clean) ? clean : null;
}

/** שגיאה מ-IPC (או כל חריגה) כהודעה בעברית: ההודעה עצמה אם היא בעברית, אחרת הודעה כללית. */
export function ipcErrorMessage(err: unknown): string {
  return userFacingHebrew(errorText(err)) ?? he.errors.ipc;
}

/**
 * הנחיה מעשית בעברית לכל סוג תקלת מיקרופון.
 * הרשאה חסומה -> תמיד ההנחיה המלאה להגדרות הפרטיות של Windows.
 * בשאר הסוגים: ההודעה הספציפית של שכבת האודיו (אם היא בעברית), אחרת הנחיה כללית לפי הסוג.
 */
export function micErrorMessage(err: unknown): string {
  if (isMicErrorLike(err)) {
    if (err.kind === 'permission-denied') return he.mic.permissionDenied;
    if (err.message && HEBREW_RE.test(err.message)) return err.message;
    switch (err.kind) {
      case 'no-device':
        return he.mic.noDevice;
      case 'device-busy':
        return he.mic.deviceBusy;
      case 'unsupported':
        return he.mic.unsupported;
      case 'unknown':
        return he.mic.unknown(err.message || he.errors.unknown);
    }
  }
  return he.mic.unavailable(errorText(err));
}

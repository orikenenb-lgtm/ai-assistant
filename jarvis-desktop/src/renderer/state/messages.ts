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

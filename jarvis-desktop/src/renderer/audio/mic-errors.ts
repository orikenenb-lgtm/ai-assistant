import { MicError } from './types';

/**
 * מיפוי שגיאות getUserMedia / Web Audio לשגיאת MicError עם הודעה ברורה בעברית.
 * ההודעות מכוונות ל-Windows 11 (הגדרות פרטיות המיקרופון, תוכנה אחרת שתופסת את ההתקן).
 */

export const MIC_MESSAGES = {
  permissionDenied:
    'אין הרשאה להשתמש במיקרופון. ב-Windows יש לאפשר גישה: הגדרות ← פרטיות ואבטחה ← מיקרופון ← "אפשר לאפליקציות שולחן עבודה לגשת למיקרופון".',
  selectedDeviceMissing: 'המיקרופון שנבחר בהגדרות לא נמצא. חבר אותו מחדש או בחר מיקרופון אחר בהגדרות.',
  noDevice: 'לא נמצא מיקרופון מחובר למחשב.',
  deviceBusy:
    'לא ניתן להפעיל את המיקרופון — ייתכן שתוכנה אחרת משתמשת בו באופן בלעדי, או שהגישה אליו חסומה בהגדרות הפרטיות של Windows.',
  unsupported: 'הקלטת קול אינה נתמכת בסביבה הזו.',
  unknown: 'הפעלת המיקרופון נכשלה. נסה שוב.',
  audioEngine: 'לא ניתן להפעיל את עיבוד האודיו של המיקרופון. נסה שוב.',
  audioEngineTimeout: 'מנוע האודיו לא הופעל בזמן. נסה שוב.',
  openTimeout: 'המיקרופון לא נפתח בזמן — ייתכן שההתקן תקוע או בשימוש של תוכנה אחרת. נסה שוב.',
  alreadyActive: 'כבר מתבצעת הקלטה — יש לסיים אותה לפני הקלטה חדשה.',
} as const;

function errorName(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'name' in error) {
    const name = (error as { name: unknown }).name;
    return typeof name === 'string' ? name : '';
  }
  return '';
}

/** ממפה שגיאת getUserMedia ל-MicError. requestedDevice=true כשהתבקש התקן מסוים מההגדרות. */
export function toMicError(error: unknown, requestedDevice: boolean): MicError {
  if (error instanceof MicError) return error;
  switch (errorName(error)) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return new MicError('permission-denied', MIC_MESSAGES.permissionDenied);
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return new MicError('no-device', requestedDevice ? MIC_MESSAGES.selectedDeviceMissing : MIC_MESSAGES.noDevice);
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return new MicError('device-busy', MIC_MESSAGES.deviceBusy);
    case 'NotSupportedError':
      return new MicError('unsupported', MIC_MESSAGES.unsupported);
    default:
      return new MicError('unknown', MIC_MESSAGES.unknown);
  }
}

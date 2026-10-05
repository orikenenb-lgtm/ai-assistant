import type { Settings } from '../../shared/settings-schema';
import type { ToolDefinition } from '../core/contracts';

/**
 * מדיניות אישורים: מתי פעולה דורשת אישור מפורש של המשתמש לפני ביצוע.
 * - high: תמיד (אין כלים כאלה ב-V1, אבל כל כלי עתידי כזה ידרוש אישור).
 * - privacy (צילום מסך): לפי ההגדרה "דרוש אישור", ותמיד כשיש כמה מסכים ולא נבחר אחד (בורר מסך).
 * - low/read: רק כשהתור "נגוע" (אחרי תוכן חיצוני לא מהימן) ולכלי יש תופעת לוואי.
 */

export interface ApprovalPolicyInput {
  def: Pick<ToolDefinition<unknown>, 'risk' | 'sideEffect'>;
  settings: Settings;
  tainted: boolean;
  userInitiated: boolean;
  displayCount: number;
  displayChosen: boolean;
}

export interface ApprovalPolicyDecision {
  required: boolean;
  reason?: 'privacy' | 'tainted' | 'policy';
}

export function decideApproval(input: ApprovalPolicyInput): ApprovalPolicyDecision {
  const { def, settings, tainted, userInitiated, displayCount, displayChosen } = input;
  switch (def.risk) {
    case 'high':
      return { required: true, reason: 'policy' };
    case 'privacy':
      if (settings.screen.requireConfirmation && !userInitiated) return { required: true, reason: 'privacy' };
      if (displayCount > 1 && !displayChosen) return { required: true, reason: 'privacy' };
      // הגנה נוספת: כשהדרישה לאישור כבויה, בקשת המודל לצלם שוב אחרי תוכן לא מהימן עדיין מחייבת אישור
      if (tainted && !userInitiated) return { required: true, reason: 'tainted' };
      return { required: false };
    case 'low':
    case 'read':
      if (tainted && def.sideEffect) return { required: true, reason: 'tainted' };
      return { required: false };
    default:
      // סיכון לא מוכר — נוהגים בזהירות
      return { required: true, reason: 'policy' };
  }
}

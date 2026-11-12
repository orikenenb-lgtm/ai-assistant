import { isApiError } from '@/lib/api';
import { MoneySchema, type Money } from '@/lib/schemas/common';
import { z } from 'zod';

export interface BookingProblem {
  title: string;
  message: string;
  tone: 'warn' | 'danger';
  /** The server changed the booking (downgrade committed) — the page already refetched; re-read everything. */
  mustReread: boolean;
  priceDiff?: { oldPrice: Money; newPrice: Money };
}

const DiffSchema = z.object({ old_price: MoneySchema, new_price: MoneySchema });

/** Codes after which the booking on the server may have changed state (so we refetch). */
export const REFETCH_CODES = new Set([
  'TERMS_CHANGED',
  'PRICE_CHANGED',
  'OFFER_EXPIRED',
  'APPROVAL_EXPIRED',
  'REVALIDATION_REQUIRED',
  'REVALIDATION_FAILED',
  'CONCURRENT_UPDATE',
  'INVALID_TRANSITION',
  'RECONCILE_REQUIRED',
  'USE_HOSTED_CHECKOUT',
  'CANCEL_WITH_SUPPLIER',
  'IDEMPOTENCY_KEY_REUSED',
  'BOOKING_UNAVAILABLE',
]);

/** Hebrew explanation for a failed booking action. Never claims success. */
export function describeBookingError(error: unknown): BookingProblem {
  if (!isApiError(error)) {
    return { title: 'הפעולה לא הושלמה', message: 'אירעה שגיאה בלתי צפויה. רעננו את הדף ובדקו את מצב ההזמנה.', tone: 'danger', mustReread: false };
  }
  const base = { message: error.message, mustReread: false };
  switch (error.code) {
    case 'TERMS_CHANGED':
    case 'PRICE_CHANGED': {
      const diff = DiffSchema.safeParse(error.details);
      return {
        ...base,
        title: error.code === 'PRICE_CHANGED' ? 'המחיר השתנה — האישור בוטל' : 'התנאים השתנו — האישור בוטל',
        message: `${error.message} טענו מחדש את ההזמנה: יש לקרוא את התנאים המעודכנים ולאשר מחדש. שום דבר לא נשלח לספק.`,
        tone: 'warn',
        mustReread: true,
        priceDiff: diff.success ? { oldPrice: diff.data.old_price, newPrice: diff.data.new_price } : undefined,
      };
    }
    case 'OFFER_EXPIRED':
      return { ...base, title: 'תוקף ההצעה פג', tone: 'warn', mustReread: true };
    case 'APPROVAL_EXPIRED':
      return { ...base, title: 'תוקף האישור פג', tone: 'warn', mustReread: true };
    case 'REVALIDATION_REQUIRED':
      return { ...base, title: 'נדרשת בדיקת מחיר עדכנית', tone: 'warn', mustReread: true };
    case 'REVALIDATION_FAILED':
      return { ...base, title: 'בדיקת המחיר מול הספק נכשלה', message: `${error.message} ההזמנה נשארה במצבה ולא נשלחה.`, tone: 'warn', mustReread: true };
    case 'RECONCILE_REQUIRED':
      return { ...base, title: 'נדרש בירור מול הספק', tone: 'danger', mustReread: true };
    case 'CONCURRENT_UPDATE':
      return { ...base, title: 'ההזמנה עודכנה במקביל', tone: 'warn', mustReread: true };
    case 'INVALID_TRANSITION':
      return { ...base, title: 'הפעולה אינה אפשרית במצב הנוכחי', tone: 'warn', mustReread: true };
    case 'IDEMPOTENCY_KEY_REUSED':
      return { ...base, title: 'מפתח השליחה כבר שימש', tone: 'danger', mustReread: true };
    case 'USE_HOSTED_CHECKOUT':
      return { ...base, title: 'ההזמנה מושלמת באתר הספק', tone: 'warn', mustReread: true };
    case 'CANCEL_WITH_SUPPLIER':
      return { ...base, title: 'לא ניתן לבטל דרך המערכת', tone: 'warn', mustReread: true };
    case 'BOOKING_UNAVAILABLE':
      return { ...base, title: 'ההזמנה אינה זמינה', tone: 'warn', mustReread: true };
    case 'LIVE_EXECUTION_DISABLED':
      return { ...base, title: 'ביצוע הזמנה אמיתית כבוי', tone: 'danger' };
    case 'BOOKING_NOT_ALLOWED':
      return { ...base, title: 'אין הרשאה להכין הזמנות', tone: 'danger' };
    case 'REAUTH_FAILED':
      return { ...base, title: 'הסיסמה שגויה', message: error.message || 'הסיסמה שהוזנה אינה נכונה. לא בוצע אישור.', tone: 'danger' };
    case 'RATE_LIMITED':
      return { ...base, title: 'יותר מדי ניסיונות', tone: 'warn' };
    default:
      return { ...base, title: 'הפעולה לא הושלמה', tone: 'danger' };
  }
}

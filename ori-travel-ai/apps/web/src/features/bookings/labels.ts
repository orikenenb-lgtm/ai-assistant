import type { BadgeTone } from '@/components/ui';
import type { BookingState, SimulationScenario, ExecutionMode } from '@/lib/schemas/bookings';
import { BOOKING_STATES } from '@/lib/schemas/bookings';

export const STATE_LABELS: Record<BookingState, string> = {
  DRAFT: 'טיוטה',
  QUOTE_SELECTED: 'נבחרה הצעה',
  REVALIDATING: 'בבדיקת מחיר',
  READY_FOR_APPROVAL: 'ממתין לאישור',
  APPROVED: 'מאושר',
  SUBMITTING: 'בשליחה',
  CONFIRMED: 'אושר על ידי הספק',
  EXPIRED: 'פג תוקף',
  FAILED: 'נכשל',
  UNKNOWN: 'לא ידוע — נדרש בירור',
  CANCELLED: 'בוטל',
};

export function isBookingState(s: string): s is BookingState {
  return (BOOKING_STATES as readonly string[]).includes(s);
}

export const STATE_TONES: Record<BookingState, BadgeTone> = {
  DRAFT: 'muted',
  QUOTE_SELECTED: 'info',
  REVALIDATING: 'info',
  READY_FOR_APPROVAL: 'warn',
  APPROVED: 'accent',
  SUBMITTING: 'accent',
  CONFIRMED: 'success',
  EXPIRED: 'muted',
  FAILED: 'danger',
  UNKNOWN: 'danger',
  CANCELLED: 'muted',
};

export const SCENARIO_LABELS: Record<SimulationScenario, { label: string; description: string }> = {
  success: { label: 'הצלחה', description: 'הספק המדומה מאשר ומחזיר אסמכתה.' },
  price_change: { label: 'שינוי מחיר', description: 'המחיר עולה ב-7% בבדיקה אחרי האישור — נדרש אישור חדש.' },
  expired: { label: 'פקיעת הצעה', description: 'תוקף ההצעה פג בבדיקת המחיר הראשונה.' },
  supplier_failure: { label: 'כשל של הספק', description: 'הספק דוחה את ההזמנה והיא מסומנת כנכשלה.' },
  timeout_unknown: { label: 'תגובה אבדה (לא ידוע)', description: 'ההזמנה נקלטת אצל הספק אבל התשובה אובדת — מצב "לא ידוע" ובירור.' },
};

export const MODE_LABELS: Record<ExecutionMode, string> = {
  SIMULATION: 'סימולציה',
  HOSTED_CHECKOUT: 'השלמה באתר הספק',
  LIVE: 'ביצוע חי (כבוי)',
};

/** Filter options for the list page. */
export const FILTER_STATES: BookingState[] = [
  'QUOTE_SELECTED',
  'READY_FOR_APPROVAL',
  'APPROVED',
  'CONFIRMED',
  'UNKNOWN',
  'FAILED',
  'EXPIRED',
  'CANCELLED',
];

export const SUPPLIER_REFERENCE_PATTERN = /^[A-Za-z0-9-]{4,64}$/;

/** Shown for a hosted-checkout booking that is approved but has no recorded supplier reference yet. Never "confirmed". */
export const AWAITING_SUPPLIER_LABEL = 'ממתין להשלמה באתר הספק';

export function isAwaitingSupplier(b: { state: string; execution_mode: ExecutionMode }): boolean {
  return b.execution_mode === 'HOSTED_CHECKOUT' && b.state === 'APPROVED';
}

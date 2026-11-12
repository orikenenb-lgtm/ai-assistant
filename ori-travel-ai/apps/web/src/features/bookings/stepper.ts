import type { BookingState, ExecutionMode, HistoryEntry } from '@/lib/schemas/bookings';

export const MAIN_STEPS = [
  { key: 'QUOTE_SELECTED', label: 'נבחרה הצעה' },
  { key: 'REVALIDATING', label: 'בדיקת מחיר' },
  { key: 'READY_FOR_APPROVAL', label: 'מוכן לאישור' },
  { key: 'APPROVED', label: 'אושר' },
  { key: 'SUBMITTING', label: 'נשלח' },
  { key: 'CONFIRMED', label: 'אושר ע״י הספק' },
] as const;

export type StepStatus = 'done' | 'current' | 'todo' | 'problem';
export const SIDE_STATES = ['EXPIRED', 'FAILED', 'UNKNOWN', 'CANCELLED'] as const;
export type SideState = (typeof SIDE_STATES)[number];

const INDEX: Record<string, number> = {
  DRAFT: 0,
  QUOTE_SELECTED: 0,
  REVALIDATING: 1,
  READY_FOR_APPROVAL: 2,
  APPROVED: 3,
  SUBMITTING: 4,
  CONFIRMED: 5,
};

export function isSideState(state: string): state is SideState {
  return (SIDE_STATES as readonly string[]).includes(state);
}

export interface StepperModel {
  steps: Array<{ key: string; label: string; status: StepStatus }>;
  side: SideState | null;
}

/**
 * Maps the server state (+ history, for terminal side states) onto the main flow.
 * Side states keep the steps reached so far as "done" and mark the point of failure.
 */
/** Hosted checkout: the user completes on the supplier's site, so "approved" is a waiting step — not a booking. */
const HOSTED_LABELS: Record<string, string> = {
  APPROVED: 'תנאים אושרו — ממתין לספק',
  SUBMITTING: 'השלמה באתר הספק',
  CONFIRMED: 'אסמכתת ספק נרשמה',
};

export function buildStepper(state: BookingState | string, history: HistoryEntry[] = [], mode?: ExecutionMode): StepperModel {
  const side = isSideState(state) ? state : null;
  let reached: number;
  if (side) {
    reached = 0;
    for (const h of history) {
      if (h.to in INDEX) reached = Math.max(reached, INDEX[h.to]!);
      if (h.from && h.from in INDEX) reached = Math.max(reached, INDEX[h.from]!);
    }
    // UNKNOWN is only reachable after the request was sent.
    if (side === 'UNKNOWN') reached = Math.max(reached, 4);
  } else {
    reached = INDEX[state] ?? 0;
  }
  const steps = MAIN_STEPS.map((s, i) => {
    let status: StepStatus;
    if (side) {
      if (i < reached) status = 'done';
      else if (i === reached) status = side === 'FAILED' || side === 'UNKNOWN' ? 'problem' : 'todo';
      else status = 'todo';
    } else if (state === 'CONFIRMED') {
      status = 'done';
    } else if (i < reached) status = 'done';
    else if (i === reached) status = 'current';
    else status = 'todo';
    const label = mode === 'HOSTED_CHECKOUT' ? (HOSTED_LABELS[s.key] ?? s.label) : s.label;
    return { key: s.key, label, status };
  });
  return { steps, side };
}

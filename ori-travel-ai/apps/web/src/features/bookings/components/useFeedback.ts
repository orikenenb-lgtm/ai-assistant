import { useCallback, useState } from 'react';
import type { Booking } from '@/lib/schemas/bookings';
import { describeBookingError, type BookingProblem } from '../errors';

/** Result of the last action, taken ONLY from the server's response (never assumed). */
export interface Feedback {
  notice: string | null;
  problem: BookingProblem | null;
  clear: () => void;
  report: (booking: Booking) => void;
  fail: (error: unknown) => BookingProblem;
  /** Await an action; records the server notice or the error and resolves to the booking (or null on failure). */
  run: (action: Promise<Booking>) => Promise<Booking | null>;
}

export function useFeedback(): Feedback {
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<BookingProblem | null>(null);

  const clear = useCallback(() => {
    setNotice(null);
    setProblem(null);
  }, []);
  const report = useCallback((b: Booking) => {
    setProblem(null);
    setNotice(b.notice ?? null);
  }, []);
  const fail = useCallback((e: unknown) => {
    const p = describeBookingError(e);
    setNotice(null);
    setProblem(p);
    return p;
  }, []);
  const run = useCallback(
    async (action: Promise<Booking>) => {
      clear();
      try {
        const b = await action;
        report(b);
        return b;
      } catch (e) {
        fail(e);
        return null;
      }
    },
    [clear, report, fail],
  );
  return { notice, problem, clear, report, fail, run };
}

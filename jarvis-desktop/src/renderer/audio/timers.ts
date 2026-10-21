/**
 * מקור זמן וטיימרים שניתנים להזרקה — בדיקות מזריקות שעון מדומה, הדפדפן משתמש באמיתיים.
 */

export type TimerHandle = unknown;

export interface AudioTimers {
  /** זמן מונוטוני במילישניות. */
  now(): number;
  setTimeout(callback: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
  setInterval(callback: () => void, ms: number): TimerHandle;
  clearInterval(handle: TimerHandle): void;
}

export const browserTimers: AudioTimers = {
  now: () => performance.now(),
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
  setInterval: (callback, ms) => globalThis.setInterval(callback, ms),
  clearInterval: (handle) => globalThis.clearInterval(handle as ReturnType<typeof globalThis.setInterval>),
};

/** מחכה להבטחה עד זמן קצוב. מחזיר 'timeout' אם הזמן עבר. לא זורק אם ההבטחה נכשלה — מחזיר 'failed'. */
export function settleWithin<T>(
  promise: Promise<T>,
  ms: number,
  timers: AudioTimers,
): Promise<{ status: 'ok'; value: T } | { status: 'failed'; error: unknown } | { status: 'timeout' }> {
  return new Promise((resolve) => {
    let done = false;
    const handle = timers.setTimeout(() => {
      if (done) return;
      done = true;
      resolve({ status: 'timeout' });
    }, ms);
    promise.then(
      (value) => {
        if (done) return;
        done = true;
        timers.clearTimeout(handle);
        resolve({ status: 'ok', value });
      },
      (error: unknown) => {
        if (done) return;
        done = true;
        timers.clearTimeout(handle);
        resolve({ status: 'failed', error });
      },
    );
  });
}

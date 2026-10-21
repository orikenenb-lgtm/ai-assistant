/**
 * MOCK: טיימרים ידניים — הבדיקה מחליטה מתי "עובר הזמן".
 */
type Handle = ReturnType<typeof setTimeout>;

export interface ManualTimers {
  setTimer: (fn: () => void, ms: number) => Handle;
  clearTimer: (handle: Handle) => void;
  /** מפעיל את כל הטיימרים הפעילים שמשך ההמתנה שלהם הוא בדיוק ms (או כולם אם לא צוין). */
  fire(ms?: number): number;
  pending(): number[];
}

export function createManualTimers(): ManualTimers {
  let seq = 0;
  const active = new Map<number, { fn: () => void; ms: number }>();
  return {
    setTimer(fn, ms) {
      const id = ++seq;
      active.set(id, { fn, ms });
      return id as unknown as Handle;
    },
    clearTimer(handle) {
      active.delete(handle as unknown as number);
    },
    fire(ms) {
      let count = 0;
      for (const [id, t] of [...active.entries()]) {
        if (ms === undefined || t.ms === ms) {
          active.delete(id);
          t.fn();
          count++;
        }
      }
      return count;
    },
    pending: () => [...active.values()].map((t) => t.ms),
  };
}

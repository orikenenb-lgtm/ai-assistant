/**
 * Hooks לסביבת הדפדפן: שעון חי משותף, media queries ונראות החלון.
 * כולם מבוססי useSyncExternalStore — בלי setState בתוך effects ובלי טיימר לכל רכיב.
 */
import { useCallback, useSyncExternalStore } from 'react';

/* ---------------- שעון משותף (מתעדכן בכל שנייה) ---------------- */

const clockListeners = new Set<() => void>();
let clockNow = Date.now();
let clockTimer: number | null = null;

function clockTick(): void {
  const next = Date.now();
  // מודיעים רק כשהשנייה התחלפה — שעון מדויק בלי רינדור מיותר
  if (Math.floor(next / 1000) === Math.floor(clockNow / 1000)) return;
  clockNow = next;
  for (const l of [...clockListeners]) l();
}

function subscribeClock(listener: () => void): () => void {
  clockListeners.add(listener);
  if (clockTimer === null) {
    clockNow = Date.now();
    clockTimer = window.setInterval(clockTick, 200);
  }
  return () => {
    clockListeners.delete(listener);
    if (clockListeners.size === 0 && clockTimer !== null) {
      window.clearInterval(clockTimer);
      clockTimer = null;
    }
  };
}

/** הזמן הנוכחי (ms), מתעדכן פעם בשנייה כל עוד יש מנוי. */
export function useNowMs(): number {
  return useSyncExternalStore(subscribeClock, () => clockNow);
}

/* ---------------- media query ---------------- */

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (listener: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', listener);
      return () => mql.removeEventListener('change', listener);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}

export function usePrefersReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}

/* ---------------- נראות החלון ---------------- */

function subscribeVisibility(listener: () => void): () => void {
  document.addEventListener('visibilitychange', listener);
  return () => document.removeEventListener('visibilitychange', listener);
}

/** false כשהחלון ממוזער/מוסתר במגש — כדי לא למשוך נתונים שאף אחד לא רואה. */
export function useDocumentVisible(): boolean {
  return useSyncExternalStore(subscribeVisibility, () => document.visibilityState === 'visible');
}

/**
 * Store מינימלי ובלתי-משתנה (immutable) שמתחבר ל-React דרך useSyncExternalStore.
 * הבקר (controller) הוא היחיד שכותב אליו; הרכיבים רק קוראים.
 */
import { useSyncExternalStore } from 'react';

export interface Store<T extends object> {
  getState(): T;
  /** מיזוג רדוד. מעדכן מאזינים רק אם משהו השתנה בפועל. */
  setState(patch: Partial<T> | ((state: T) => Partial<T>)): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();

  return {
    getState: () => state,
    setState(patch) {
      const partial = typeof patch === 'function' ? patch(state) : patch;
      let changed = false;
      for (const key of Object.keys(partial) as Array<keyof T>) {
        if (!Object.is(state[key], partial[key])) {
          changed = true;
          break;
        }
      }
      if (!changed) return;
      state = { ...state, ...partial };
      // עותק של הרשימה: מאזין שמבטל את עצמו בזמן ההפצה לא ישבש את הלולאה
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * קריאה מה-store בתוך רכיב. ה-selector חייב להחזיר ערך יציב
 * (שדה קיים מה-state או ערך פרימיטיבי) — לא אובייקט חדש בכל קריאה.
 */
export function useStore<T extends object, S>(store: Store<T>, selector: (state: T) => S): S {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(store.getState()),
  );
}

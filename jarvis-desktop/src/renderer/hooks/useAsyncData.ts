/**
 * טעינת נתונים אסינכרונית לפי מפתח: כשהמפתח משתנה (למשל מונה data-changed) — טוענים מחדש.
 * הנתונים הקודמים נשארים מוצגים בזמן הטעינה, ותוצאה של בקשה ישנה נזרקת.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

interface Loaded<T> {
  key: string | null;
  data: T | null;
  failed: boolean;
}

export interface AsyncData<T> {
  data: T | null;
  /** הטעינה האחרונה נכשלה. */
  failed: boolean;
  /** בטעינה (ראשונה או מחודשת). */
  loading: boolean;
  reload(): void;
}

export function useAsyncData<T>(key: string, load: () => Promise<T>): AsyncData<T> {
  const [loaded, setLoaded] = useState<Loaded<T>>({ key: null, data: null, failed: false });
  const [nonce, setNonce] = useState(0);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  const fullKey = `${key}#${nonce}`;
  useEffect(() => {
    let alive = true;
    let pending: Promise<T>;
    try {
      pending = loadRef.current();
    } catch (err) {
      pending = Promise.reject(err);
    }
    pending.then(
      (data) => {
        if (alive) setLoaded({ key: fullKey, data, failed: false });
      },
      () => {
        if (alive) setLoaded((prev) => ({ key: fullKey, data: prev.data, failed: true }));
      },
    );
    return () => {
      alive = false;
    };
  }, [fullKey]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return {
    data: loaded.data,
    failed: loaded.key === fullKey && loaded.failed,
    loading: loaded.key !== fullKey,
    reload,
  };
}

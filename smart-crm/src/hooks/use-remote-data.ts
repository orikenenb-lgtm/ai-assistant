"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Loads data from a server action when `key` changes; `reload()` refetches.
 * Results of superseded requests are ignored.
 */
export function useRemoteData<T>(load: () => Promise<T | null>, key: string) {
  const [state, setState] = useState<{ key: string; data: T | null }>({ key: "", data: null });
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    load().then((data) => {
      if (!cancelled && data !== null) setState({ key, data });
    });
    return () => {
      cancelled = true;
    };
    // `load` is recreated each render; `key` + `version` define when to refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version]);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  // Hide data that belongs to a previous key while the new one loads.
  return { data: state.key === key ? state.data : null, reload };
}

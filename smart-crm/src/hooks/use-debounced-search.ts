"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Event-driven debounced search: call `search(q)` on input; results arrive
 * asynchronously and stale responses are discarded.
 */
export function useDebouncedSearch<T>(fetcher: (q: string) => Promise<T[]>, opts: { delay?: number; minLength?: number } = {}) {
  const { delay = 200, minLength = 0 } = opts;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  const search = useCallback(
    (q: string) => {
      setQuery(q);
      if (timer.current) clearTimeout(timer.current);
      const id = ++seq.current;
      if (q.trim().length < minLength) {
        setResults([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      timer.current = setTimeout(async () => {
        const data = await fetcher(q.trim()).catch(() => [] as T[]);
        if (id === seq.current) {
          setResults(data);
          setLoading(false);
        }
      }, delay);
    },
    [fetcher, delay, minLength],
  );

  const reset = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    seq.current++;
    setQuery("");
    setResults([]);
    setLoading(false);
  }, []);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  return { query, results, loading, search, reset };
}

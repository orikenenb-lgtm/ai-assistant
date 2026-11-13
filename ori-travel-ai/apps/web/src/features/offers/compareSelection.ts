/**
 * Compare selection store: offer ids picked for /compare, persisted in sessionStorage
 * (per tab, cleared when the tab closes). Max 10 (backend limit). Works without storage.
 */
import { useSyncExternalStore } from 'react';

export const COMPARE_MAX = 10;
export const COMPARE_MIN = 2;
export const COMPARE_STORAGE_KEY = 'ori.compare.selection.v1';

type Listener = () => void;
const listeners = new Set<Listener>();
let memoryFallback: string[] | null = null;

function readStorage(): string[] {
  try {
    const raw = window.sessionStorage.getItem(COMPARE_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((x): x is string => typeof x === 'string'))].slice(0, COMPARE_MAX);
  } catch {
    return memoryFallback ?? [];
  }
}

function writeStorage(ids: string[]): void {
  memoryFallback = ids;
  try {
    window.sessionStorage.setItem(COMPARE_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // storage blocked: keep in memory for this page load
  }
}

let snapshot: string[] = readStorage();

function commit(next: string[]): void {
  snapshot = next;
  writeStorage(next);
  for (const l of listeners) l();
}

function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export type ToggleResult = 'added' | 'removed' | 'full';

export const compareSelection = {
  get: (): string[] => snapshot,
  has: (id: string): boolean => snapshot.includes(id),
  toggle(id: string): ToggleResult {
    if (snapshot.includes(id)) {
      commit(snapshot.filter((x) => x !== id));
      return 'removed';
    }
    if (snapshot.length >= COMPARE_MAX) return 'full';
    commit([...snapshot, id]);
    return 'added';
  },
  remove(id: string): void {
    if (snapshot.includes(id)) commit(snapshot.filter((x) => x !== id));
  },
  clear(): void {
    if (snapshot.length) commit([]);
  },
  /** Test helper: reload from storage. */
  reload(): void {
    snapshot = readStorage();
    for (const l of listeners) l();
  },
};

export function useCompareSelection() {
  const ids = useSyncExternalStore(subscribe, compareSelection.get, compareSelection.get);
  return {
    ids,
    count: ids.length,
    isFull: ids.length >= COMPARE_MAX,
    canCompare: ids.length >= COMPARE_MIN,
    has: (id: string) => ids.includes(id),
    toggle: compareSelection.toggle,
    remove: compareSelection.remove,
    clear: compareSelection.clear,
  };
}

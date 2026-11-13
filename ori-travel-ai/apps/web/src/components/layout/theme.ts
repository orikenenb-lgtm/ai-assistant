/**
 * Colour theme: "system" (default — follows prefers-color-scheme), "light" or "dark".
 * The resolved theme is written to <html data-theme="light|dark"> and `color-scheme`;
 * styles/index.css redefines the colour tokens for `data-theme="dark"`.
 *
 * The choice is stored per browser in localStorage (wrapped in try/catch: storage can be
 * blocked, full or unavailable — the app then simply follows the system setting).
 * Initialised once at import time (RootLayout imports this module) so the first React
 * render already has the right theme.
 */
import { useSyncExternalStore } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'ori.theme';
/** Browser UI colour (address bar) per theme — matches the top bar surface. */
export const THEME_COLORS: Record<ResolvedTheme, string> = { light: '#ffffff', dark: '#151c27' };

const DARK_QUERY = '(prefers-color-scheme: dark)';

function isPreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

function readStoredPreference(): ThemePreference {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isPreference(value) ? value : 'system';
  } catch {
    return 'system';
  }
}

function writeStoredPreference(pref: ThemePreference): void {
  try {
    if (pref === 'system') window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    // Storage blocked / full — keep the in-memory choice for this session.
  }
}

function darkQuery(): MediaQueryList | null {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(DARK_QUERY) : null;
  } catch {
    return null;
  }
}

export function resolveTheme(pref: ThemePreference, systemDark = darkQuery()?.matches ?? false): ResolvedTheme {
  if (pref === 'system') return systemDark ? 'dark' : 'light';
  return pref;
}

interface ThemeSnapshot {
  preference: ThemePreference;
  resolved: ResolvedTheme;
}

let snapshot: ThemeSnapshot = { preference: 'system', resolved: 'light' };
const listeners = new Set<() => void>();
let initialised = false;

function applyToDocument(resolved: ResolvedTheme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.setAttribute('content', THEME_COLORS[resolved]));
}

function update(preference: ThemePreference): void {
  const resolved = resolveTheme(preference);
  applyToDocument(resolved);
  if (snapshot.preference !== preference || snapshot.resolved !== resolved) {
    snapshot = { preference, resolved };
    listeners.forEach((listener) => listener());
  }
}

/** Reads the stored choice, applies it and follows system / other-tab changes. Idempotent. */
export function initTheme(): void {
  if (initialised || typeof window === 'undefined') return;
  initialised = true;
  update(readStoredPreference());
  const mq = darkQuery();
  const onSystemChange = () => {
    if (snapshot.preference === 'system') update('system');
  };
  try {
    mq?.addEventListener('change', onSystemChange);
  } catch {
    // Very old engines: no live updates; a reload picks up the new system setting.
  }
  window.addEventListener('storage', (event) => {
    if (event.key === THEME_STORAGE_KEY || event.key === null) update(readStoredPreference());
  });
}

export function getThemePreference(): ThemePreference {
  return snapshot.preference;
}

export function setThemePreference(preference: ThemePreference): void {
  writeStoredPreference(preference);
  update(preference);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): ThemeSnapshot {
  return snapshot;
}

/** `const { preference, resolved, setPreference } = useTheme();` */
export function useTheme(): ThemeSnapshot & { setPreference: (preference: ThemePreference) => void } {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { ...current, setPreference: setThemePreference };
}

initTheme();

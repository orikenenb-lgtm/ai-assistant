import { vi } from 'vitest';
import type { CapturedImage, Clock, Logger, ScreenCaptureService, SecretService, SettingsService } from '../../../../src/main/core/contracts';
import { defaultSettings, type SecretName, type Settings, type SettingsPatch } from '../../../../src/shared/settings-schema';
import type { DisplayInfo } from '../../../../src/shared/types';

/** MOCK: שעון ידני. */
export interface MockClock extends Clock {
  set(iso: string): void;
  advance(ms: number): void;
}

export function createMockClock(startIso = '2026-10-05T17:15:00Z'): MockClock {
  let t = Date.parse(startIso);
  return {
    now: () => new Date(t),
    set: (iso) => {
      t = Date.parse(iso);
    },
    advance: (ms) => {
      t += ms;
    },
  };
}

/** MOCK: לוגר שאוסף רשומות (כדי לוודא שלא נרשמים סודות/טקסט). */
export interface MockLogger extends Logger {
  readonly records: Array<{ level: string; event: string; data?: Record<string, unknown> }>;
}

export function createMockLogger(): MockLogger {
  const records: MockLogger['records'] = [];
  const log = (level: string) => (event: string, data?: Record<string, unknown>) => {
    records.push({ level, event, ...(data ? { data } : {}) });
  };
  return { records, debug: log('debug'), info: log('info'), warn: log('warn'), error: log('error') };
}

/** MOCK: שירות הגדרות בזיכרון (מיזוג רדוד לכל מקטע). */
export function createMockSettings(initial: Settings = defaultSettings()): SettingsService & { set(next: Settings): void } {
  let current = structuredClone(initial);
  const listeners = new Set<(s: Settings) => void>();
  return {
    get: () => current,
    set(next) {
      current = structuredClone(next);
    },
    update(patch: SettingsPatch) {
      const next = structuredClone(current) as Record<string, unknown>;
      for (const [k, v] of Object.entries(patch)) {
        const prev = next[k];
        next[k] = Array.isArray(v) || typeof v !== 'object' || v === null ? v : { ...(prev as object), ...v };
      }
      current = next as Settings;
      for (const l of listeners) l(current);
      return current;
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** MOCK: מאגר מפתחות בזיכרון. */
export function createMockSecrets(values: Partial<Record<SecretName, string>> = {}): SecretService {
  const store = new Map<SecretName, string>(Object.entries(values) as Array<[SecretName, string]>);
  return {
    get: (name) => store.get(name) ?? null,
    set: (name, value) => {
      store.set(name, value);
    },
    clear: (name) => {
      store.delete(name);
    },
    status: () => ({ secureStorageAvailable: true, entries: [] }),
  };
}

export function mockDisplay(id: string, primary: boolean): DisplayInfo {
  return { id, label: `מסך ${id}${primary ? ' (ראשי)' : ''}`, width: 2560, height: 1440, scaleFactor: 1, primary };
}

/** MOCK: שירות מסך — רק גאומטריה; capture לא אמור להיקרא מהמנוע (הכלי עושה זאת). */
export function createMockScreen(displays: DisplayInfo[] = [mockDisplay('1', true)]): ScreenCaptureService & {
  setDisplays(next: DisplayInfo[]): void;
} {
  let list = displays;
  return {
    setDisplays(next) {
      list = next;
    },
    listDisplays: () => list.map((d) => ({ ...d })),
    capture: vi.fn(async (displayId: string): Promise<CapturedImage> => {
      const display = list.find((d) => d.id === displayId) ?? list[0]!;
      return { data: Buffer.from([1, 2, 3]), mediaType: 'image/png', width: 10, height: 10, display };
    }),
  };
}

/**
 * עזרי MOCK לבדיקות צוות הנתונים: שעון מדומה, טיימרים מדומים שמסונכרנים איתו,
 * Notifier מדומה, הקשר כלי מדומה ותיקייה זמנית לקובצי DB.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vi } from 'vitest';
import type { Clock, Logger, ToolContext } from '../../../src/main/core/contracts';
import type { AssistantEvent } from '../../../src/shared/types';
import { defaultSettings, type Settings } from '../../../src/shared/settings-schema';
import type { Notifier, NotificationRequest } from '../../../src/main/reminders/notifier';

export interface MockClock extends Clock {
  set(iso: string): void;
  advance(ms: number): void;
  ms(): number;
}

export function mockClock(startIso: string): MockClock {
  let current = Date.parse(startIso);
  if (!Number.isFinite(current)) throw new Error(`bad iso ${startIso}`);
  return {
    now: () => new Date(current),
    set: (iso) => {
      current = Date.parse(iso);
    },
    advance: (ms) => {
      current += ms;
    },
    ms: () => current,
  };
}

/**
 * טיימרים מדומים: setTimer רושם טיימר ביחס לשעון המדומה.
 * advance() מזיז את השעון ומפעיל טיימרים לפי הסדר (כמו זמן שעובר כשהמחשב ער).
 * clock.advance() לבדו מדמה שינה — השעון קופץ והטיימרים לא רצים עד שקוראים ל-flushDue().
 */
export interface MockTimers {
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  advance(ms: number): void;
  flushDue(): void;
  pending(): Array<{ id: number; at: number }>;
}

export function mockTimers(clock: MockClock): MockTimers {
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const runOne = (limit: number): boolean => {
    let best: { id: number; at: number; fn: () => void } | null = null;
    for (const [id, t] of timers) if (t.at <= limit && (!best || t.at < best.at || (t.at === best.at && id < best.id))) best = { id, ...t };
    if (!best) return false;
    timers.delete(best.id);
    if (clock.ms() < best.at) clock.set(new Date(best.at).toISOString());
    best.fn();
    return true;
  };
  return {
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { at: clock.ms() + Math.max(0, ms), fn });
      return id;
    },
    clearTimer: (handle) => {
      timers.delete(handle as number);
    },
    advance(ms) {
      const target = clock.ms() + ms;
      let guard = 0;
      while (runOne(target)) {
        if (++guard > 100_000) throw new Error('timer loop');
      }
      clock.set(new Date(target).toISOString());
    },
    flushDue() {
      let guard = 0;
      while (runOne(clock.ms())) {
        if (++guard > 10_000) throw new Error('timer loop');
      }
    },
    pending: () => [...timers.entries()].map(([id, t]) => ({ id, at: t.at })),
  };
}

export interface MockNotifier extends Notifier {
  shown: Array<NotificationRequest & { atMs: number }>;
}

export function mockNotifier(clock: Clock): MockNotifier {
  const shown: MockNotifier['shown'] = [];
  return {
    shown,
    show: (n) => {
      shown.push({ ...n, atMs: clock.now().getTime() });
    },
  };
}

export function mockLogger(): Logger & { errors: Array<{ event: string; data?: Record<string, unknown> }> } {
  const errors: Array<{ event: string; data?: Record<string, unknown> }> = [];
  return {
    errors,
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: (event, data) => {
      errors.push({ event, data });
    },
  };
}

export function mockSettings(patch?: { graceMinutes?: number }): Settings {
  const s = defaultSettings();
  if (patch?.graceMinutes !== undefined) s.reminders = { ...s.reminders, graceMinutes: patch.graceMinutes };
  return s;
}

export function mockToolContext(now: Date, opts?: { aborted?: boolean }): ToolContext & {
  events: AssistantEvent[];
} {
  const events: AssistantEvent[] = [];
  const controller = new AbortController();
  if (opts?.aborted) controller.abort();
  return {
    events,
    turnId: 'turn-1',
    actionId: 'action-1',
    signal: controller.signal,
    settings: defaultSettings(),
    now,
    userInitiated: false,
    emit: vi.fn((e: AssistantEvent) => {
      events.push(e);
    }),
  };
}

/** תיקייה זמנית לקובצי DB; cleanup מוחק אותה. */
export function tempDir(prefix = 'jarvis-data-'): { dir: string; file: (name: string) => string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return {
    dir,
    file: (name) => join(dir, name),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** מזהים צפויים לבדיקות. */
export function mockIdFactory(prefix = 'id'): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

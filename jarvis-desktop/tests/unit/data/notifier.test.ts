import { beforeEach, describe, expect, it, vi } from 'vitest';

/** MOCK של מחלקת Notification של Electron — בלי Electron אמיתי. */
const mockElectron = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void;
  class MockNotification {
    static supported = true;
    static instances: MockNotification[] = [];
    static isSupported(): boolean {
      return MockNotification.supported;
    }
    listeners = new Map<string, Listener[]>();
    shown = 0;
    constructor(public options: Record<string, unknown>) {
      MockNotification.instances.push(this);
    }
    on(event: string, fn: Listener): this {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), fn]);
      return this;
    }
    show(): void {
      this.shown++;
    }
    fire(event: string, ...args: unknown[]): void {
      for (const fn of this.listeners.get(event) ?? []) fn(...args);
    }
  }
  return { MockNotification };
});

vi.mock('electron', () => ({ Notification: mockElectron.MockNotification }));

import { createElectronNotifier } from '../../../src/main/reminders/notifier';
import { mockLogger } from './mock-helpers';

describe('createElectronNotifier (mock electron)', () => {
  beforeEach(() => {
    mockElectron.MockNotification.supported = true;
    mockElectron.MockNotification.instances = [];
  });

  it('shows a notification with title/body and calls onClick (mock)', () => {
    const onClick = vi.fn();
    const notifier = createElectronNotifier({ onClick, logger: mockLogger() });
    notifier.show({ title: 'תזכורת', body: 'לפתוח את הפרויקט — 08:00' });
    const n = mockElectron.MockNotification.instances[0]!;
    expect(n.options).toMatchObject({ title: 'תזכורת', body: 'לפתוח את הפרויקט — 08:00', silent: false });
    expect(n.shown).toBe(1);
    n.fire('click');
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does nothing (and warns once) when notifications are not supported (mock)', () => {
    mockElectron.MockNotification.supported = false;
    const logger = mockLogger();
    const warn = vi.spyOn(logger, 'warn');
    const notifier = createElectronNotifier({ onClick: () => {}, logger });
    notifier.show({ title: 'a', body: 'b' });
    notifier.show({ title: 'a', body: 'b' });
    expect(mockElectron.MockNotification.instances).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('a throwing onClick or a failed toast is logged, not thrown (mock)', () => {
    const logger = mockLogger();
    const notifier = createElectronNotifier({
      onClick: () => {
        throw new Error('window gone');
      },
      logger,
    });
    notifier.show({ title: 'a', body: 'b', silent: true });
    const n = mockElectron.MockNotification.instances[0]!;
    expect(n.options.silent).toBe(true);
    expect(() => n.fire('click')).not.toThrow();
    expect(() => n.fire('failed', {}, 'toast error')).not.toThrow();
  });
});

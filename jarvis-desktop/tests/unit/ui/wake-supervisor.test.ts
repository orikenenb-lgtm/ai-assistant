import { describe, expect, it } from 'vitest';
import { defaultSettings, type Settings } from '../../../src/shared/settings-schema';
import {
  WAKE_HEALTHY_RESET_MS,
  WAKE_RETRY_DELAYS_MS,
  WAKE_TAIL_MS,
  WakeWordSupervisor,
  type WakeView,
} from '../../../src/renderer/state/wake-supervisor';
import { flush, mockClock, mockWakeWordDetector, type MockWakeWord } from './audio.mock';

function wakeSettings(): Settings {
  const s = defaultSettings();
  s.wakeWord.enabled = true;
  s.wakeWord.engine = 'openwakeword';
  return s;
}

function setup(opts: { failStart?: () => string | null; busy?: () => boolean } = {}) {
  const clock = mockClock();
  const log: string[] = [];
  const detectors: MockWakeWord[] = [];
  const views: WakeView[] = [];
  const notices: string[] = [];
  const detections: number[] = [];
  let settings: Settings | null = wakeSettings();
  let deviceListener: (() => void) | null = null;
  let holdNext = false;
  const sup = new WakeWordSupervisor({
    createDetector: (engine) => {
      const d = mockWakeWordDetector(engine, log, opts.failStart?.() ?? null);
      d.holdStart = holdNext;
      detectors.push(d);
      return d;
    },
    timers: clock.timers,
    getSettings: () => settings,
    isBusy: () => opts.busy?.() ?? false,
    onDetected: () => detections.push(clock.now()),
    onView: (v) => views.push(v),
    onFailureNotice: (m) => notices.push(m),
    onDeviceChange: (l) => {
      deviceListener = l;
      return () => {
        deviceListener = null;
      };
    },
  });
  return {
    sup,
    clock,
    detectors,
    views,
    notices,
    detections,
    setSettings: (s: Settings | null) => (settings = s),
    holdStarts: (v: boolean) => (holdNext = v),
    fireDeviceChange: () => deviceListener?.(),
    hasDeviceListener: () => deviceListener !== null,
  };
}

describe('WakeWordSupervisor — retries (mock)', () => {
  it('retries a failing start after 5 s, 30 s and 2 min, then stops and waits for a manual retry (mock)', async () => {
    const t = setup({ failStart: () => 'אין הרשאה למיקרופון.' });
    await t.sup.configure();
    expect(t.sup.view.status).toBe('error');
    expect(t.sup.view.error).toBe('מילת ההפעלה לא זמינה: אין הרשאה למיקרופון. לחיצה לדיבור ממשיכה לעבוד.');
    expect(t.detectors).toHaveLength(1);
    for (const [i, delay] of WAKE_RETRY_DELAYS_MS.entries()) {
      t.clock.advance(delay - 10);
      await flush();
      expect(t.detectors).toHaveLength(i + 1);
      t.clock.advance(10);
      await t.sup.whenSettled();
      await flush();
      expect(t.detectors).toHaveLength(i + 2);
    }
    expect(t.sup.view.retryExhausted).toBe(true);
    t.clock.advance(30 * 60_000);
    await flush();
    expect(t.detectors).toHaveLength(WAKE_RETRY_DELAYS_MS.length + 1);
    // אותה הודעה לא קופצת שוב בכל ניסיון
    expect(t.notices).toHaveLength(1);
    // "נסה שוב" ידני מאפס את הנסיונות
    await t.sup.restart();
    expect(t.detectors).toHaveLength(WAKE_RETRY_DELAYS_MS.length + 2);
    t.clock.advance(WAKE_RETRY_DELAYS_MS[0]!);
    await t.sup.whenSettled();
    expect(t.detectors).toHaveLength(WAKE_RETRY_DELAYS_MS.length + 3);
    t.sup.dispose();
    expect(t.clock.pending()).toBe(0);
  });

  it('a failure after a successful start (onStateChange → error) is shown and retried (mock)', async () => {
    const t = setup();
    await t.sup.configure();
    expect(t.sup.view.status).toBe('listening');
    expect(t.sup.listening).toBe(true);
    t.detectors[0]!.failNow('המיקרופון התנתק או הפסיק לשדר.');
    expect(t.sup.view.status).toBe('error');
    expect(t.sup.view.error).toContain('המיקרופון התנתק');
    expect(t.sup.listening).toBe(false);
    expect(t.detectors[0]!.stopCalls).toBe(1);
    expect(t.notices).toHaveLength(1);
    t.clock.advance(WAKE_RETRY_DELAYS_MS[0]!);
    await t.sup.whenSettled();
    expect(t.detectors).toHaveLength(2);
    expect(t.sup.view.status).toBe('listening');
    t.sup.dispose();
  });

  it('technical English failures stay out of the Hebrew text and go to detail (mock)', async () => {
    const t = setup();
    await t.sup.configure();
    t.detectors[0]!.failNow('מנוע הזיהוי המקומי הפסיק לעבוד.', 'RuntimeError: memory access out of bounds');
    expect(t.sup.view.error).toBe('מילת ההפעלה לא זמינה: מנוע הזיהוי המקומי הפסיק לעבוד. לחיצה לדיבור ממשיכה לעבוד.');
    expect(t.sup.view.detail).toMatch(/RuntimeError/);
    t.sup.dispose();
  });

  it('after a minute of healthy listening the backoff starts again from 5 s (mock)', async () => {
    const t = setup();
    await t.sup.configure();
    t.detectors[0]!.failNow('א');
    t.clock.advance(WAKE_RETRY_DELAYS_MS[0]!);
    await t.sup.whenSettled();
    expect(t.sup.view.status).toBe('listening');
    t.clock.advance(WAKE_HEALTHY_RESET_MS + 10);
    t.detectors[1]!.failNow('ב');
    t.clock.advance(WAKE_RETRY_DELAYS_MS[0]!);
    await t.sup.whenSettled();
    expect(t.detectors).toHaveLength(3);
    t.sup.dispose();
  });

  it('a microphone being plugged in (devicechange) retries right away while in error (mock)', async () => {
    const t = setup({ failStart: () => (t.detectors.length === 0 ? 'לא נמצא מיקרופון.' : null) });
    await t.sup.configure();
    expect(t.sup.view.status).toBe('error');
    t.fireDeviceChange();
    t.clock.advance(1000);
    await t.sup.whenSettled();
    expect(t.detectors).toHaveLength(2);
    expect(t.sup.view.status).toBe('listening');
    // בזמן האזנה תקינה devicechange לא מפעיל מחדש
    t.fireDeviceChange();
    t.clock.advance(1000);
    await flush();
    expect(t.detectors).toHaveLength(2);
    t.sup.dispose();
    expect(t.hasDeviceListener()).toBe(false);
  });
});

describe('WakeWordSupervisor — lifecycle (mock)', () => {
  it('configurations are serialized: the previous start settles before the next detector starts (mock)', async () => {
    const t = setup();
    t.holdStarts(true);
    void t.sup.configure();
    await flush();
    expect(t.detectors).toHaveLength(1);
    t.holdStarts(false);
    void t.sup.configure();
    void t.sup.configure();
    await flush();
    // הגלאי שעוד נטען מבוטל, אבל חדש לא נוצר עד שההפעלה שלו מסתיימת
    expect(t.detectors[0]!.stopCalls).toBeGreaterThanOrEqual(1);
    await t.sup.whenSettled();
    await flush();
    expect(t.detectors).toHaveLength(2);
    expect(t.detectors[0]!.state).toBe('stopped');
    expect(t.detectors[1]!.state).toBe('listening');
    expect(t.sup.view.status).toBe('listening');
    t.sup.dispose();
  });

  it('disabling stops the detector and shows "off" (mock)', async () => {
    const t = setup();
    await t.sup.configure();
    t.setSettings({ ...wakeSettings(), wakeWord: { ...wakeSettings().wakeWord, enabled: false } });
    await t.sup.configure();
    expect(t.detectors[0]!.state).toBe('stopped');
    expect(t.sup.view).toEqual({ status: 'off', error: null, engine: null });
    t.sup.dispose();
  });

  it('busy pauses the detector; a detector that finishes loading while busy is paused immediately (mock)', async () => {
    let busy = true;
    const t = setup({ busy: () => busy });
    await t.sup.configure();
    expect(t.detectors[0]!.state).toBe('paused');
    expect(t.sup.view.status).toBe('paused');
    busy = false;
    t.sup.syncPause();
    expect(t.detectors[0]!.state).toBe('listening');
    t.sup.dispose();
  });

  it('the tail after speech is timer-based: it always ends after WAKE_TAIL_MS (mock)', async () => {
    const t = setup();
    await t.sup.configure();
    t.sup.startTail();
    expect(t.sup.pausedNow).toBe(true);
    expect(t.detectors[0]!.state).toBe('paused');
    t.clock.advance(WAKE_TAIL_MS - 1);
    expect(t.detectors[0]!.state).toBe('paused');
    t.clock.advance(1);
    expect(t.sup.pausedNow).toBe(false);
    expect(t.detectors[0]!.state).toBe('listening');
    t.sup.dispose();
  });

  it('detections from a replaced detector are ignored (mock)', async () => {
    const t = setup();
    await t.sup.configure();
    const old = t.detectors[0]!;
    await t.sup.configure();
    old.trigger();
    expect(t.detections).toHaveLength(0);
    t.detectors[1]!.trigger();
    expect(t.detections).toHaveLength(1);
    t.sup.dispose();
  });
});

/**
 * מחזור החיים של גלאי מילת ההפעלה ב-renderer (openWakeWord ו-Porcupine), עם MOCK של getUserMedia,
 * AudioContext, AudioWorklet, ONNX ו-window.jarvis (main). בודק את התיקונים:
 * - stop() באמצע start() לא משאיר מיקרופון פתוח ולא מדווח 'listening'.
 * - גלאי ישן לא מכבה את הסשן של הגלאי החדש ב-main (מזהה סשן).
 * - תקלות אחרי הפעלה מוצלחת עוברות ל-'error' (שגיאות זיהוי, מיקרופון שנותק, אין אודיו, סשן שנפל).
 * - תור העיבוד של openWakeWord חסום בגודל.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createOpenWakeWordDetector,
  createPorcupineBridgeDetector,
  ENGINE_FAILED_MESSAGE,
  MAX_INFERENCE_ERRORS,
  MIC_LOST_MESSAGE,
  NO_AUDIO_MESSAGE,
  NO_AUDIO_TIMEOUT_MS,
  WATCHDOG_INTERVAL_MS,
} from '../../../src/wakeword/detectors';
import type { SessionLike, TensorLike } from '../../../src/wakeword/openwakeword';
import { JarvisController } from '../../../src/renderer/state/controller';
import { defaultSettings } from '../../../src/shared/settings-schema';
import { flush, mockAudio, mockClock, type MockClock } from '../ui/audio.mock';
import { mockJarvisApi } from '../ui/jarvis-api.mock';

interface FakeTrack {
  stopped: boolean;
  onended: (() => void) | null;
  stop(): void;
}

class FakeCtx {
  state = 'running';
  sampleRate = 16000;
  closed = false;
  onstatechange: (() => void) | null = null;
  audioWorklet = { addModule: async () => undefined };
  constructor() {
    contexts.push(this);
  }
  createMediaStreamSource() {
    return { connect() {}, disconnect() {} };
  }
  async close() {
    this.closed = true;
    this.state = 'closed';
  }
}

class FakeNode {
  port: { onmessage: ((e: { data: Float32Array }) => void) | null } = { onmessage: null };
  constructor() {
    nodes.push(this);
  }
  disconnect() {}
}

const tracks: FakeTrack[] = [];
const contexts: FakeCtx[] = [];
const nodes: FakeNode[] = [];
let gumGates: Array<() => void> = [];

/** MOCK של PorcupineService ב-main (סשן אחד בכל רגע; מזהה ישן — מתעלם). */
const main = {
  seq: 0,
  current: null as string | null,
  stops: [] as string[],
  accepted: 0,
  rejected: 0,
  failed: null as string | null,
};

function sessionId(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

beforeEach(() => {
  tracks.length = 0;
  contexts.length = 0;
  nodes.length = 0;
  gumGates = [];
  Object.assign(main, { seq: 0, current: null, stops: [], accepted: 0, rejected: 0, failed: null });
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: () =>
        new Promise((resolve) => {
          gumGates.push(() => {
            const t: FakeTrack = {
              stopped: false,
              onended: null,
              stop() {
                this.stopped = true;
              },
            };
            tracks.push(t);
            resolve({ getTracks: () => [t], getAudioTracks: () => [t] });
          });
        }),
    },
  });
  vi.stubGlobal('AudioContext', FakeCtx);
  vi.stubGlobal('AudioWorkletNode', FakeNode);
  vi.stubGlobal('window', {
    jarvis: {
      wakeword: {
        startPorcupine: async () => {
          const id = sessionId(++main.seq);
          main.current = id;
          main.failed = null;
          return { ok: true, frameLength: 512, sampleRate: 16000, sessionId: id };
        },
        stopPorcupine: async (id: string) => {
          main.stops.push(id);
          if (id === main.current) main.current = null;
        },
        statusPorcupine: async (id: string) => {
          if (id !== main.current) return { state: 'stopped' };
          return main.failed ? { state: 'failed', message_he: main.failed } : { state: 'running' };
        },
        pushFrames: (id: string) => {
          if (id === main.current) main.accepted++;
          else main.rejected++;
        },
      },
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

/** MOCK של סשני ONNX: מחזירים צורות סבירות; אפשר להכשיל את מודל המילה או לעצור את ה-mel. */
function fakeSessions(opts: { failWakeword?: () => boolean; melGate?: () => Promise<void> | null } = {}) {
  const runs = { mel: 0, emb: 0, ww: 0 };
  const mk = (kind: 'mel' | 'emb' | 'ww'): SessionLike => ({
    inputNames: ['x'],
    outputNames: ['y'],
    async run(feeds: Record<string, TensorLike>) {
      const inp = feeds.x!;
      if (kind === 'mel') {
        runs.mel++;
        const gate = opts.melGate?.();
        if (gate) await gate;
        const frames = Math.max(1, Math.floor((inp.dims[1]! - 400) / 160) + 1);
        return { y: { data: new Float32Array(frames * 32), dims: [1, 1, frames, 32] } };
      }
      if (kind === 'emb') {
        runs.emb++;
        return { y: { data: new Float32Array(inp.dims[0]! * 96), dims: [inp.dims[0]!, 1, 1, 96] } };
      }
      runs.ww++;
      if (opts.failWakeword?.()) throw new Error('RuntimeError: memory access out of bounds');
      return { y: { data: new Float32Array([0]), dims: [1, 1] } };
    },
  });
  return {
    runs,
    load: async () => ({
      sessions: { melspectrogram: mk('mel'), embedding: mk('emb'), wakeword: mk('ww') },
      tensor: (data: Float32Array, dims: number[]) => ({ data, dims }),
    }),
  };
}

async function untilGum(count: number): Promise<void> {
  for (let i = 0; i < 30 && gumGates.length < count; i++) await flush(1);
}

describe('wake-word detectors — stop during start (mock)', () => {
  it('Porcupine: stop() while the mic is opening releases the late stream and the main session, never reports listening (mock)', async () => {
    const d = createPorcupineBridgeDetector();
    const states: string[] = [];
    const p = d.start({ sensitivity: 0.5, onDetected: () => undefined, onStateChange: (s) => states.push(s) });
    await untilGum(1);
    expect(gumGates).toHaveLength(1);
    const startedSession = main.current;
    await d.stop();
    expect(d.state).toBe('stopped');
    // המכשיר נפתח רק אחרי העצירה
    gumGates[0]!();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    await flush();
    expect(d.state).toBe('stopped');
    expect(tracks[0]!.stopped).toBe(true);
    expect(contexts.every((c) => c.closed)).toBe(true);
    // הסשן ב-main נעצר עם המזהה שלו
    expect(main.stops).toEqual([startedSession]);
    expect(states).not.toContain('listening');
  });

  it('openWakeWord: stop() during mic open leaks nothing and the state stays stopped (mock)', async () => {
    const onnx = fakeSessions();
    const d = createOpenWakeWordDetector({ loadSessions: onnx.load });
    const p = d.start({ sensitivity: 0.5, onDetected: () => undefined });
    await untilGum(1);
    await d.stop();
    gumGates[0]!();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    await flush();
    expect(d.state).toBe('stopped');
    expect(tracks[0]!.stopped).toBe(true);
    expect(contexts.every((c) => c.closed)).toBe(true);
  });

  it('a stale Porcupine detector stopping late does not kill the new detector session, and its orphan frames are refused (mock)', async () => {
    const d1 = createPorcupineBridgeDetector();
    const p1 = d1.start({ sensitivity: 0.5, onDetected: () => undefined });
    await untilGum(1);
    const s1 = main.current;
    const d2 = createPorcupineBridgeDetector();
    const p2 = d2.start({ sensitivity: 0.5, onDetected: () => undefined });
    await untilGum(2);
    const s2 = main.current;
    expect(s2).not.toBe(s1);
    gumGates[1]!();
    await p2;
    expect(d2.state).toBe('listening');
    // הגלאי הישן נעצר עכשיו (למשל "הפעל מחדש" כפול) — עם המזהה הישן
    await d1.stop();
    gumGates[0]!();
    await expect(p1).rejects.toMatchObject({ name: 'AbortError' });
    expect(main.current).toBe(s2);
    // רק המיקרופון של הגלאי החדש פתוח (זה של הישן נסגר מיד כשנפתח באיחור)
    expect(tracks.filter((t) => !t.stopped)).toHaveLength(1);
    // האודיו של הגלאי החדש מגיע ל-main
    const node = nodes[nodes.length - 1]!;
    for (let i = 0; i < 16; i++) node.port.onmessage?.({ data: new Float32Array(128).fill(0.2) });
    expect(main.accepted).toBeGreaterThan(0);
    expect(main.rejected).toBe(0);
    await d2.stop();
    expect(main.current).toBeNull();
  });
});

describe('wake-word detectors — failures after a successful start (mock)', () => {
  async function startOww(clock: MockClock, onnx = fakeSessions()) {
    const states: string[] = [];
    const d = createOpenWakeWordDetector({ loadSessions: onnx.load, timers: clock.timers, now: clock.now });
    const p = d.start({ sensitivity: 0.5, onDetected: () => undefined, onStateChange: (s) => states.push(s) });
    await untilGum(1);
    gumGates[0]!();
    await p;
    return { d, states, node: nodes[0]!, onnx };
  }

  it('repeated inference errors switch to error with a Hebrew message and the technical detail (mock)', async () => {
    let failing = false;
    const clock = mockClock();
    const { d, states, node } = await startOww(clock, fakeSessions({ failWakeword: () => failing }));
    expect(d.state).toBe('listening');
    failing = true;
    // בלוקים של 1280 דגימות — כל אחד מריץ את הצינור המלא
    for (let i = 0; i < MAX_INFERENCE_ERRORS + 2; i++) node.port.onmessage?.({ data: new Float32Array(1280).fill(0.1) });
    await flush(5);
    expect(d.state).toBe('error');
    expect(d.lastError).toBe(ENGINE_FAILED_MESSAGE);
    expect(d.lastErrorDetail).toMatch(/RuntimeError/);
    expect(states.at(-1)).toBe('error');
    // המיקרופון שוחרר
    expect(tracks[0]!.stopped).toBe(true);
    expect(contexts[0]!.closed).toBe(true);
  });

  it('a microphone that is unplugged (track ended) or a closed AudioContext switches to error (mock)', async () => {
    const clock = mockClock();
    const a = await startOww(clock);
    tracks[0]!.onended?.();
    expect(a.d.state).toBe('error');
    expect(a.d.lastError).toBe(MIC_LOST_MESSAGE);
    expect(a.states.at(-1)).toBe('error');

    const onnx = fakeSessions();
    const d = createOpenWakeWordDetector({ loadSessions: onnx.load, timers: clock.timers, now: clock.now });
    const p = d.start({ sensitivity: 0.5, onDetected: () => undefined });
    await untilGum(2);
    gumGates[1]!();
    await p;
    const ctx = contexts[contexts.length - 1]!;
    ctx.state = 'closed';
    ctx.onstatechange?.();
    expect(d.state).toBe('error');
    expect(d.lastError).toBe(MIC_LOST_MESSAGE);
  });

  it('no audio blocks for ~3 s switches to error, even while paused; steady audio keeps it alive (mock)', async () => {
    const clock = mockClock();
    const { d, node } = await startOww(clock);
    for (let t = 0; t < 10_000; t += 500) {
      node.port.onmessage?.({ data: new Float32Array(128) });
      clock.advance(500);
    }
    expect(d.state).toBe('listening');
    d.pause();
    clock.advance(NO_AUDIO_TIMEOUT_MS + WATCHDOG_INTERVAL_MS + 10);
    expect(d.state).toBe('error');
    expect(d.lastError).toBe(NO_AUDIO_MESSAGE);
    expect(tracks[0]!.stopped).toBe(true);
  });

  it('Porcupine: a session that failed in main is noticed via the status poll (mock)', async () => {
    const clock = mockClock();
    const d = createPorcupineBridgeDetector({ timers: clock.timers, now: clock.now });
    const states: string[] = [];
    const p = d.start({ sensitivity: 0.5, onDetected: () => undefined, onStateChange: (s) => states.push(s) });
    await untilGum(1);
    gumGates[0]!();
    await p;
    const node = nodes[0]!;
    node.port.onmessage?.({ data: new Float32Array(128) });
    main.failed = 'מנוע Porcupine הפסיק לעבוד באמצע ההאזנה.';
    clock.advance(WATCHDOG_INTERVAL_MS);
    await flush();
    expect(d.state).toBe('error');
    expect(d.lastError).toBe(main.failed);
    expect(states.at(-1)).toBe('error');
    expect(tracks[0]!.stopped).toBe(true);
  });
});

describe('openWakeWord — CPU on the renderer main thread (mock)', () => {
  it('the processing queue is bounded: a backlog is dropped and the pipeline reset instead of piling up (mock)', async () => {
    let gate: Promise<void> | null = null;
    let open!: () => void;
    const onnx = fakeSessions({ melGate: () => gate });
    const clock = mockClock();
    const d = createOpenWakeWordDetector({ loadSessions: onnx.load, timers: clock.timers, now: clock.now });
    const p = d.start({ sensitivity: 0.5, onDetected: () => undefined });
    await untilGum(1);
    gumGates[0]!();
    await p;
    const melAfterStart = onnx.runs.mel;
    gate = new Promise<void>((r) => (open = r));
    // ה-thread עמוס: 25 בלוקים מצטברים בזמן שהראשון עוד מעובד
    for (let i = 0; i < 25; i++) nodes[0]!.port.onmessage?.({ data: new Float32Array(1280).fill(0.05) });
    gate = null;
    open();
    await flush(10);
    // בלי הגבלה היו 25 הרצות mel; עם הגבלה — הבלוק שרץ ועוד כמה אחרונים בלבד
    expect(onnx.runs.mel - melAfterStart).toBeLessThanOrEqual(5);
    expect(d.state).toBe('listening');
    await d.stop();
  });

  it('resume() after a pause does not recompute the noise-seed features (mock)', async () => {
    const onnx = fakeSessions();
    const clock = mockClock();
    const d = createOpenWakeWordDetector({ loadSessions: onnx.load, timers: clock.timers, now: clock.now });
    const p = d.start({ sensitivity: 0.5, onDetected: () => undefined });
    await untilGum(1);
    gumGates[0]!();
    await p;
    const before = { ...onnx.runs };
    d.pause();
    d.resume();
    d.pause();
    d.resume();
    await flush(5);
    expect(onnx.runs).toEqual(before);
    await d.stop();
  });
});

describe('controller + Porcupine bridge — rapid restarts (mock)', () => {
  it('double "restart" ends with exactly one live detector, main running its session and no leaked mic (mock)', async () => {
    const s = defaultSettings();
    s.wakeWord.enabled = true;
    s.wakeWord.engine = 'porcupine';
    const jarvis = mockJarvisApi({ settings: s });
    const audio = mockAudio();
    const clock = mockClock();
    audio.factories.createWakeWordDetector = () => createPorcupineBridgeDetector({ timers: clock.timers, now: clock.now });
    let n = 0;
    const c = new JarvisController({
      api: jarvis.api,
      audio: audio.factories,
      now: clock.now,
      timers: clock.timers,
      randomId: () => sessionId(++n),
    });
    await c.init();
    await untilGum(1);
    const firstSession = main.current;
    // "הפעל מחדש" פעמיים ברצף בזמן שהגלאי הראשון עוד פותח את המיקרופון
    c.restartWakeWord();
    c.restartWakeWord();
    await flush();
    // מסודר בשרשרת: שום גלאי חדש לא נפתח לפני שההפעלה הקודמת הסתיימה
    expect(gumGates).toHaveLength(1);
    expect(main.stops).toEqual([firstSession]);
    // המכשיר של הגלאי הראשון נפתח באיחור — נסגר מיד
    gumGates[0]!();
    await untilGum(2);
    expect(gumGates).toHaveLength(2);
    gumGates[1]!();
    await c.wakeSettled();
    await flush();
    expect(c.state.wake.status).toBe('listening');
    expect(main.current).not.toBeNull();
    expect(main.current).not.toBe(firstSession);
    // רק המיקרופון האחרון פתוח
    expect(tracks.filter((t) => !t.stopped)).toHaveLength(1);
    // בזמן ש-JARVIS מדבר הגלאי מושהה — שום פריים לא נשלח
    jarvis.emit({ type: 'response', turnId: 't', text: 'שלום', speak: true, mode: 'ai', actions: [] });
    await flush();
    const before = main.accepted + main.rejected;
    for (const node of nodes) for (let i = 0; i < 16; i++) node.port.onmessage?.({ data: new Float32Array(128).fill(0.2) });
    expect(main.accepted + main.rejected).toBe(before);
    c.dispose();
    await flush();
    expect(tracks.every((t) => t.stopped)).toBe(true);
  });
});

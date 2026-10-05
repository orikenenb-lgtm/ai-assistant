/**
 * MOCK של שכבת האודיו ושל השעון לבדיקות הבקר.
 * כל אובייקט רושם את סדר הקריאות ביומן משותף (log), כדי לבדוק סדר פעולות (למשל: עצירת השמעה לפני פתיחת מיקרופון).
 */
import type { AudioFactories, TimerApi } from '../../../src/renderer/state/controller';
import type {
  CaptureResult,
  MicCapture,
  MicCaptureOptions,
  SpeechPlayback,
  SystemSpeaker,
  SystemVoiceInfo,
  WakeWordDetector,
} from '../../../src/renderer/audio/types';

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(err: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** WAV מזויף באורך סביר (מעל 44 בתים של כותרת). */
export function mockWav(bytes = 3200): Uint8Array {
  return new Uint8Array(bytes);
}

export function speechCapture(overrides: Partial<CaptureResult> = {}): CaptureResult {
  return { reason: 'silence', wav: mockWav(), durationMs: 1500, speechDetected: true, ...overrides };
}

export interface MockMic extends MicCapture {
  startCalls: MicCaptureOptions[];
  stopCalls: number;
  cancelCalls: number;
  /** כשמוגדר: start יחכה עד שהבדיקה תקרא ל-resolveStart. */
  holdStart: boolean;
  resolveStart(): void;
  /** שגיאה ש-start יזרוק בקריאה הבאה. */
  failNextStart: unknown;
  /** מסיים את ההקלטה הנוכחית עם תוצאה. */
  finish(result: CaptureResult): void;
  /** התוצאה ש-stop ידני יחזיר. */
  manualResult: CaptureResult;
  level: number;
}

export function mockMicCapture(log: string[]): MockMic {
  let done: Deferred<CaptureResult> | null = null;
  let startGate: Deferred<void> | null = null;
  let active = false;
  let pendingCancel = false;

  const mic: MockMic = {
    startCalls: [],
    stopCalls: 0,
    cancelCalls: 0,
    holdStart: false,
    failNextStart: null,
    manualResult: speechCapture({ reason: 'manual' }),
    level: 0.4,
    resolveStart() {
      startGate?.resolve();
    },
    async start(options) {
      log.push('mic.start');
      mic.startCalls.push(options);
      if (active) throw new Error('MOCK: already active');
      if (mic.failNextStart) {
        const err = mic.failNextStart;
        mic.failNextStart = null;
        throw err;
      }
      pendingCancel = false;
      if (mic.holdStart) {
        startGate = deferred<void>();
        await startGate.promise;
      }
      done = deferred<CaptureResult>();
      if (pendingCancel) {
        done.resolve({ reason: 'cancelled', wav: new Uint8Array(0), durationMs: 0, speechDetected: false });
        return;
      }
      active = true;
    },
    get done() {
      return done?.promise ?? null;
    },
    get active() {
      return active;
    },
    stop() {
      log.push('mic.stop');
      mic.stopCalls++;
      if (active) mic.finish(mic.manualResult);
    },
    cancel() {
      log.push('mic.cancel');
      mic.cancelCalls++;
      if (!active) {
        pendingCancel = true;
        return;
      }
      mic.finish({ reason: 'cancelled', wav: new Uint8Array(0), durationMs: 0, speechDetected: false });
    },
    finish(result) {
      active = false;
      done?.resolve(result);
    },
    getLevel: () => mic.level,
    getWaveform: (target: Float32Array) => {
      if (!active) return false;
      target.fill(0.1);
      return true;
    },
  };
  return mic;
}

export interface MockPlayback extends SpeechPlayback {
  played: Array<{ bytes: number; mimeType: string }>;
  stopCalls: number;
  /** מסיים את ההשמעה הנוכחית כאילו הגיעה לסוף. */
  end(): void;
  failNextPlay: unknown;
}

export function mockSpeechPlayback(log: string[]): MockPlayback {
  let current: Deferred<'ended' | 'stopped'> | null = null;
  const pb: MockPlayback = {
    played: [],
    stopCalls: 0,
    failNextPlay: null,
    async play(audio, mimeType) {
      log.push('playback.play');
      if (pb.failNextPlay) {
        const err = pb.failNextPlay;
        pb.failNextPlay = null;
        throw err;
      }
      pb.played.push({ bytes: audio.byteLength, mimeType });
      current = deferred();
      return current.promise;
    },
    stop() {
      log.push('playback.stop');
      pb.stopCalls++;
      const c = current;
      current = null;
      c?.resolve('stopped');
    },
    end() {
      const c = current;
      current = null;
      c?.resolve('ended');
    },
    get playing() {
      return current !== null;
    },
    getLevel: () => (current ? 0.5 : 0),
    getWaveform: (target: Float32Array) => {
      if (!current) return false;
      target.fill(0.2);
      return true;
    },
  };
  return pb;
}

export interface MockSystemSpeaker extends SystemSpeaker {
  spoken: Array<{ text: string; voiceName?: string; rate: number }>;
  stopCalls: number;
  end(result?: 'ended' | 'no-voice'): void;
  voices: SystemVoiceInfo[];
}

export function mockSystemSpeaker(log: string[]): MockSystemSpeaker {
  let current: Deferred<'ended' | 'stopped' | 'no-voice'> | null = null;
  const sp: MockSystemSpeaker = {
    spoken: [],
    stopCalls: 0,
    voices: [{ name: 'Microsoft Asaf - Hebrew (Israel)', lang: 'he-IL', localService: true }],
    async listVoices() {
      return sp.voices;
    },
    async speak(text, options) {
      log.push('system.speak');
      sp.spoken.push({ text, voiceName: options.voiceName, rate: options.rate });
      current = deferred();
      return current.promise;
    },
    stop() {
      log.push('system.stop');
      sp.stopCalls++;
      const c = current;
      current = null;
      c?.resolve('stopped');
    },
    end(result = 'ended') {
      const c = current;
      current = null;
      c?.resolve(result);
    },
    get speaking() {
      return current !== null;
    },
  };
  return sp;
}

export interface MockWakeWord extends WakeWordDetector {
  startOptions: Parameters<WakeWordDetector['start']>[0] | null;
  pauseCalls: number;
  resumeCalls: number;
  stopCalls: number;
  failStart: string | null;
  trigger(): void;
}

export function mockWakeWordDetector(engine: 'openwakeword' | 'porcupine', log: string[], failStart: string | null = null): MockWakeWord {
  let state: WakeWordDetector['state'] = 'stopped';
  let lastError: string | null = null;
  const det: MockWakeWord = {
    engine,
    startOptions: null,
    pauseCalls: 0,
    resumeCalls: 0,
    stopCalls: 0,
    failStart,
    async start(options) {
      log.push('wake.start');
      det.startOptions = options;
      state = 'loading';
      await Promise.resolve();
      if (det.failStart) {
        state = 'error';
        lastError = det.failStart;
        throw new Error(det.failStart);
      }
      state = 'listening';
    },
    pause() {
      log.push('wake.pause');
      det.pauseCalls++;
      if (state === 'listening') state = 'paused';
    },
    resume() {
      log.push('wake.resume');
      det.resumeCalls++;
      if (state === 'paused') state = 'listening';
    },
    async stop() {
      det.stopCalls++;
      state = 'stopped';
    },
    get state() {
      return state;
    },
    get lastError() {
      return lastError;
    },
    trigger() {
      det.startOptions?.onDetected();
    },
  };
  return det;
}

export interface MockAudio {
  factories: AudioFactories;
  log: string[];
  mic: MockMic;
  playback: MockPlayback;
  speaker: MockSystemSpeaker;
  wakeDetectors: MockWakeWord[];
  /** הגלאי הבא ייכשל בהפעלה עם הסיבה הזו. */
  wakeFailReason: string | null;
  /** ערך ההחזרה של בדיקת ההד. */
  echo: boolean;
  echoCalls: Array<[string, string | null, number]>;
}

export function mockAudio(): MockAudio {
  const log: string[] = [];
  const audio: MockAudio = {
    log,
    mic: mockMicCapture(log),
    playback: mockSpeechPlayback(log),
    speaker: mockSystemSpeaker(log),
    wakeDetectors: [],
    wakeFailReason: null,
    echo: false,
    echoCalls: [],
    factories: {
      createMicCapture: () => audio.mic,
      createSpeechPlayback: () => audio.playback,
      createSystemSpeaker: () => audio.speaker,
      createWakeWordDetector: (engine) => {
        const det = mockWakeWordDetector(engine, log, audio.wakeFailReason);
        audio.wakeDetectors.push(det);
        return det;
      },
      isLikelyEcho: (transcript, last, ms) => {
        audio.echoCalls.push([transcript, last, ms]);
        return audio.echo;
      },
    },
  };
  return audio;
}

/** שעון MOCK: זמן מנוהל ידנית וטיימרים שרצים רק ב-advance. */
export interface MockClock {
  now(): number;
  timers: TimerApi;
  advance(ms: number): void;
  pending(): number;
}

export function mockClock(start = Date.UTC(2026, 9, 5, 9, 0, 0)): MockClock {
  let now = start;
  let nextId = 1;
  const tasks = new Map<number, { at: number; fn: () => void; every: number | null }>();
  const timers: TimerApi = {
    setTimeout(fn, ms) {
      const id = nextId++;
      tasks.set(id, { at: now + ms, fn, every: null });
      return id;
    },
    clearTimeout(handle) {
      if (typeof handle === 'number') tasks.delete(handle);
    },
    setInterval(fn, ms) {
      const id = nextId++;
      tasks.set(id, { at: now + ms, fn, every: ms });
      return id;
    },
    clearInterval(handle) {
      if (typeof handle === 'number') tasks.delete(handle);
    },
  };
  return {
    now: () => now,
    timers,
    advance(ms) {
      const target = now + ms;
      for (;;) {
        let nextKey: number | null = null;
        let nextAt = Infinity;
        for (const [id, t] of tasks) {
          if (t.at <= target && t.at < nextAt) {
            nextAt = t.at;
            nextKey = id;
          }
        }
        if (nextKey === null) break;
        const task = tasks.get(nextKey);
        if (!task) break;
        now = task.at;
        if (task.every !== null) task.at = now + task.every;
        else tasks.delete(nextKey);
        task.fn();
      }
      now = target;
    },
    pending: () => tasks.size,
  };
}

/** מריץ את כל ה-microtasks וה-macrotasks הממתינים (בלי טיימרים מזויפים). */
export async function flush(times = 3): Promise<void> {
  for (let i = 0; i < times; i++) await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

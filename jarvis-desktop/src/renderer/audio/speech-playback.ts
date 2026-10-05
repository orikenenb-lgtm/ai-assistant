import { analyserLevelSource, SILENT_LEVEL_SOURCE } from './level';
import { browserTimers, settleWithin, type AudioTimers, type TimerHandle } from './timers';
import type { LevelSource, SpeechPlayback } from './types';

/**
 * השמעת דיבור מוקלט (TTS מהענן: mp3/wav/ogg):
 *
 *   AudioBufferSourceNode ─> AnalyserNode ─> destination
 *
 * ה-AnalyserNode נותן getLevel/getWaveform מהאות שבאמת מושמע.
 * AudioContext אחד נשמר בין השמעות (פתיחת התקן פלט ב-Windows, ובמיוחד Bluetooth, עלולה לבלוע
 * את תחילת המשפט), ומושהה (suspend) אחרי 15 שניות בלי השמעה כדי לא לבזבז CPU/סוללה.
 */

export interface SpeechPlaybackDeps {
  /** יוצר AudioContext חדש. זורק אם Web Audio לא זמין. */
  createContext(): AudioContext;
  timers: AudioTimers;
}

export const PLAYBACK_MESSAGES = {
  empty: 'לא התקבל אודיו להשמעה.',
  unsupported: 'השמעת אודיו אינה נתמכת בסביבה הזו.',
  decode: (mimeType: string) => `לא ניתן לפענח את קובץ השמע שהתקבל (${mimeType || 'סוג לא ידוע'}).`,
  output: 'לא ניתן להפעיל את התקן השמע. בדוק שהרמקולים או האוזניות מחוברים.',
} as const;

/** השהיית ה-AudioContext אחרי זמן כזה בלי השמעה. */
export const PLAYBACK_IDLE_SUSPEND_MS = 15_000;
/** מרווח ביטחון מעבר לאורך הקטע: אם onended לא הגיע עד אז (התקן פלט נעלם) — מסיימים בכוח. */
export const PLAYBACK_WATCHDOG_EXTRA_MS = 3_000;
const RESUME_TIMEOUT_MS = 3_000;
const ANALYSER_FFT_SIZE = 2048;

interface Playback {
  settled: boolean;
  source: AudioBufferSourceNode | null;
  watchdog: TimerHandle | null;
  promise: Promise<'ended' | 'stopped'>;
  resolve: (outcome: 'ended' | 'stopped') => void;
  reject: (error: Error) => void;
}

function stateOf(ctx: BaseAudioContext): string {
  return ctx.state;
}

export function createSpeechPlaybackWith(deps: SpeechPlaybackDeps): SpeechPlayback {
  const { timers } = deps;
  let ctx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let level: LevelSource = SILENT_LEVEL_SOURCE;
  let current: Playback | null = null;
  let idleTimer: TimerHandle | null = null;

  function ensureContext(): { context: AudioContext; output: AnalyserNode } {
    if (!ctx || !analyser || stateOf(ctx) === 'closed') {
      const context = deps.createContext();
      const output = context.createAnalyser();
      output.fftSize = ANALYSER_FFT_SIZE;
      output.smoothingTimeConstant = 0;
      output.connect(context.destination);
      ctx = context;
      analyser = output;
      level = analyserLevelSource(output);
    }
    return { context: ctx, output: analyser };
  }

  function cancelIdleTimer(): void {
    if (idleTimer !== null) {
      timers.clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  function scheduleIdleSuspend(): void {
    cancelIdleTimer();
    idleTimer = timers.setTimeout(() => {
      idleTimer = null;
      if (current || !ctx || stateOf(ctx) !== 'running') return;
      ctx.suspend().catch(() => undefined);
    }, PLAYBACK_IDLE_SUSPEND_MS);
  }

  /**
   * מסיים השמעה פעם אחת בלבד: מנקה טיימר ו-source, ופותר/דוחה את ההבטחה שהוחזרה מ-play.
   * play מחזיר את p.promise ישירות (לא async), כך ש-stop() פותר אותה מיד — גם באמצע פענוח.
   */
  function settle(p: Playback, outcome: 'ended' | 'stopped' | Error, stopSource: boolean): void {
    if (p.settled) return;
    p.settled = true;
    if (p.watchdog !== null) {
      timers.clearTimeout(p.watchdog);
      p.watchdog = null;
    }
    const source = p.source;
    if (source) {
      source.onended = null;
      if (stopSource) {
        try {
          source.stop();
        } catch {
          // כבר נעצר או לא התחיל
        }
      }
      try {
        source.disconnect();
      } catch {
        // כבר נותק
      }
      p.source = null;
    }
    if (current === p) {
      current = null;
      scheduleIdleSuspend();
    }
    if (outcome instanceof Error) p.reject(outcome);
    else p.resolve(outcome);
  }

  /** שלבי ההשמעה. כל כישלון נהפך לדחייה של p.promise; אם p כבר נעצר — לא עושים כלום. */
  async function run(p: Playback, audio: Uint8Array, mimeType: string): Promise<void> {
    let context: AudioContext;
    let output: AnalyserNode;
    try {
      ({ context, output } = ensureContext());
    } catch {
      settle(p, new Error(PLAYBACK_MESSAGES.unsupported), false);
      return;
    }

    let buffer: AudioBuffer;
    try {
      // decodeAudioData מנתק (detach) את ה-ArrayBuffer שהוא מקבל, ו-audio עשוי להיות view
      // על buffer גדול יותר (IPC) — לכן מפענחים עותק צמוד.
      buffer = await context.decodeAudioData(audio.slice().buffer);
    } catch {
      settle(p, new Error(PLAYBACK_MESSAGES.decode(mimeType)), false);
      return;
    }
    if (p.settled) return; // נעצר בזמן הפענוח

    if (stateOf(context) !== 'running') {
      const resumed = await settleWithin(context.resume(), RESUME_TIMEOUT_MS, timers);
      if (p.settled) return;
      if (resumed.status !== 'ok' || stateOf(context) !== 'running') {
        settle(p, new Error(PLAYBACK_MESSAGES.output), false);
        return;
      }
    }

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(output);
    source.onended = () => settle(p, 'ended', false);
    p.source = source;
    p.watchdog = timers.setTimeout(
      () => settle(p, 'ended', true),
      Math.ceil(buffer.duration * 1000) + PLAYBACK_WATCHDOG_EXTRA_MS,
    );
    try {
      source.start();
    } catch {
      settle(p, new Error(PLAYBACK_MESSAGES.output), false);
    }
  }

  function play(audio: Uint8Array, mimeType: string): Promise<'ended' | 'stopped'> {
    if (!(audio instanceof Uint8Array) || audio.byteLength === 0) {
      return Promise.reject(new Error(PLAYBACK_MESSAGES.empty));
    }
    // השמעה חדשה מחליפה את הקודמת
    if (current) settle(current, 'stopped', true);
    cancelIdleTimer();

    let resolve: Playback['resolve'] = () => undefined;
    let reject: Playback['reject'] = () => undefined;
    const promise = new Promise<'ended' | 'stopped'>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const p: Playback = { settled: false, source: null, watchdog: null, promise, resolve, reject };
    current = p;
    run(p, audio, mimeType).catch(() => settle(p, new Error(PLAYBACK_MESSAGES.output), false));
    return promise;
  }

  return {
    play,
    stop() {
      if (current) settle(current, 'stopped', true);
    },
    get playing() {
      return current !== null;
    },
    getLevel() {
      return current?.source ? level.getLevel() : 0;
    },
    getWaveform(target: Float32Array) {
      return current?.source ? level.getWaveform(target) : false;
    },
  };
}

export function browserSpeechPlaybackDeps(): SpeechPlaybackDeps {
  return {
    createContext() {
      const Ctor = globalThis.AudioContext;
      if (typeof Ctor !== 'function') throw new Error(PLAYBACK_MESSAGES.unsupported);
      return new Ctor({ latencyHint: 'interactive' });
    },
    timers: browserTimers,
  };
}

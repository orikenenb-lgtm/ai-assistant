import { rmsOf, rmsToLevel } from './level';
import { MIC_MESSAGES, toMicError } from './mic-errors';
import { settleWithin, type AudioTimers, type TimerHandle } from './timers';
import {
  MicError,
  type CaptureEndReason,
  type CaptureResult,
  type LevelSource,
  type MicCapture,
  type MicCaptureOptions,
} from './types';
import { createVad, type Vad, type VadEvent } from './vad';
import { concatFloat32, encodeWav16, resampleTo16k, TARGET_SAMPLE_RATE } from './wav';

/**
 * לוגיקת ההקלטה: getUserMedia -> גרף אודיו (worklet) -> מקטעי PCM -> VAD -> WAV 16kHz.
 * כל התלויות בדפדפן (getUserMedia, AudioContext, טיימרים) מוזרקות, כך שמחזור החיים —
 * ובמיוחד שחרור המיקרופון בכל מסלול סיום — נבדק ב-node עם mocks.
 *
 * עקרונות:
 * - done לעולם לא נדחה ותמיד נפתר (גם בשגיאה: reason='error').
 * - בכל סיום: עוצרים את כל ה-tracks (כך Windows מפסיק להציג שהמיקרופון בשימוש),
 *   מנתקים את הצמתים וסוגרים את ה-AudioContext.
 * - הזמנים של ה-VAD נמדדים בזמן אודיו (דגימות), ושעון הקיר משמש רק לזיהוי תקיעה.
 */

/** גרף האודיו הפעיל של המיקרופון (ממומש ב-mic-graph.ts לדפדפן, ב-mock לבדיקות). */
export interface MicGraph extends LevelSource {
  /** קצב הדגימה של המקטעים שנשלחים ל-onChunk. */
  readonly sampleRate: number;
  /** מנתק צמתים וסוגר את ה-AudioContext. לא זורק. */
  close(): Promise<void>;
}

export interface MicGraphHandlers {
  /** מקטע PCM מונו (-1..1) בקצב graph.sampleRate. המקטע עובר לבעלות המקבל. */
  onChunk(samples: Float32Array): void;
  /** תקלה בעיבוד (למשל processorerror ב-worklet). */
  onFault(error: unknown): void;
}

export interface MicCaptureDeps {
  /** undefined כשאין navigator.mediaDevices בסביבה. */
  getUserMedia: ((constraints: MediaStreamConstraints) => Promise<MediaStream>) | undefined;
  openGraph(stream: MediaStream, handlers: MicGraphHandlers): Promise<MicGraph>;
  timers: AudioTimers;
}

/** אורך מסגרת ניתוח ל-VAD. */
export const MIC_FRAME_MS = 20;
/** כמה שקט משאירים אחרי סוף הדיבור (שקט ארוך בסוף גורם למודלי תמלול "להמציא" מילים). */
export const TRAILING_SILENCE_KEEP_MS = 400;
/** אם לא הגיעו דגימות זמן כזה — המיקרופון או מנוע האודיו נתקעו. */
export const STALL_TIMEOUT_MS = 3_000;
/** הגבלה עליונה: תמלול מקבל עד 65 שניות, ו-60 שניות WAV ≈ 1.9MB (מתחת ל-MAX_AUDIO_BYTES). */
export const MAX_UTTERANCE_SEC_CAP = 60;
/** פתיחת המיקרופון / גרף האודיו לא אמורה לקחת יותר מזה (גם בהתקני Bluetooth). */
export const OPEN_TIMEOUT_MS = 15_000;
const WATCHDOG_INTERVAL_MS = 500;
const GRAPH_CLOSE_TIMEOUT_MS = 1_500;
const DEFAULT_SILENCE_TIMEOUT_MS = 1_300;
const DEFAULT_MAX_UTTERANCE_SEC = 15;

type Phase = 'starting' | 'active' | 'ended' | 'failed';
type VadEnd = Extract<VadEvent, { type: 'end' }>;

interface Session {
  phase: Phase;
  silenceTimeoutMs: number;
  maxUtteranceSec: number;
  onLevel: ((level: number) => void) | undefined;
  /** stop/cancel שהגיעו בזמן שהמיקרופון עוד נפתח. ביטול גובר על עצירה. */
  pendingEnd: 'manual' | 'cancelled' | null;
  startupFault: boolean;
  stream: MediaStream | null;
  graph: MicGraph | null;
  vad: Vad | null;
  sampleRate: number;
  frameSize: number;
  frameSumSq: number;
  frameCount: number;
  framesDone: number;
  chunks: Float32Array[];
  totalSamples: number;
  /** מקטעים שהגיעו לפני שהסשן הופעל רשמית (בין חיבור ה-worklet לסוף start). */
  preStartChunks: Float32Array[];
  lastChunkAt: number;
  watchdog: TimerHandle | null;
  cleanups: Array<() => void>;
  done: Promise<CaptureResult>;
  resolveDone: (result: CaptureResult) => void;
}

function sanitizeOptions(options: MicCaptureOptions): { silenceTimeoutMs: number; maxUtteranceSec: number } {
  const silence = Number.isFinite(options.silenceTimeoutMs) && options.silenceTimeoutMs > 0
    ? Math.min(10_000, Math.max(200, options.silenceTimeoutMs))
    : DEFAULT_SILENCE_TIMEOUT_MS;
  const max = Number.isFinite(options.maxUtteranceSec) && options.maxUtteranceSec > 0
    ? Math.min(MAX_UTTERANCE_SEC_CAP, options.maxUtteranceSec)
    : DEFAULT_MAX_UTTERANCE_SEC;
  return { silenceTimeoutMs: silence, maxUtteranceSec: max };
}

/** '' ו-'default' = מיקרופון ברירת המחדל של Windows, בלי אילוץ exact. */
function normalizeDeviceId(deviceId: string | undefined): string | null {
  const id = deviceId?.trim() ?? '';
  return id && id !== 'default' ? id : null;
}

export function buildMicConstraints(deviceId: string | undefined): MediaStreamConstraints {
  const id = normalizeDeviceId(deviceId);
  const audio: MediaTrackConstraints = {
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };
  if (id) audio.deviceId = { exact: id };
  return { audio, video: false };
}

function stopTracks(stream: MediaStream | null): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      // track שכבר נעצר — אין מה לעשות
    }
  }
}

function emptyResult(reason: CaptureEndReason): CaptureResult {
  return {
    reason,
    // בביטול: מערך ריק לגמרי. בשאר המקרים בלי אודיו: WAV תקין עם כותרת בלבד.
    wav: reason === 'cancelled' ? new Uint8Array(0) : encodeWav16(new Float32Array(0), TARGET_SAMPLE_RATE),
    durationMs: 0,
    speechDetected: false,
  };
}

export function createMicCaptureWith(deps: MicCaptureDeps): MicCapture {
  const { timers } = deps;
  let current: Session | null = null;
  let published: Promise<CaptureResult> | null = null;

  function newSession(options: MicCaptureOptions): Session {
    const { silenceTimeoutMs, maxUtteranceSec } = sanitizeOptions(options);
    let resolveDone: (result: CaptureResult) => void = () => undefined;
    const done = new Promise<CaptureResult>((resolve) => {
      resolveDone = resolve;
    });
    return {
      phase: 'starting',
      silenceTimeoutMs,
      maxUtteranceSec,
      onLevel: options.onLevel,
      pendingEnd: null,
      startupFault: false,
      stream: null,
      graph: null,
      vad: null,
      sampleRate: TARGET_SAMPLE_RATE,
      frameSize: 1,
      frameSumSq: 0,
      frameCount: 0,
      framesDone: 0,
      chunks: [],
      totalSamples: 0,
      preStartChunks: [],
      lastChunkAt: 0,
      watchdog: null,
      cleanups: [],
      done,
      resolveDone,
    };
  }

  function closeGraph(s: Session): Promise<unknown> {
    const graph = s.graph;
    if (!graph) return Promise.resolve();
    let closing: Promise<void>;
    try {
      closing = graph.close();
    } catch (error) {
      closing = Promise.reject(error);
    }
    return settleWithin(closing, GRAPH_CLOSE_TIMEOUT_MS, timers);
  }

  /** משחרר את המיקרופון מיד: טיימרים, מאזינים, tracks. */
  function releaseInputs(s: Session): void {
    if (s.watchdog !== null) {
      timers.clearInterval(s.watchdog);
      s.watchdog = null;
    }
    for (const cleanup of s.cleanups.splice(0)) {
      try {
        cleanup();
      } catch {
        // הסרת מאזין לא אמורה להיכשל; גם אם כן — ממשיכים לשחרר
      }
    }
    stopTracks(s.stream);
    s.preStartChunks = [];
  }

  function buildResult(s: Session, reason: CaptureEndReason, vadEnd: VadEnd | null): CaptureResult {
    if (reason === 'cancelled') return emptyResult('cancelled');
    const speechDetected = s.vad?.speechDetected ?? false;
    let keepSamples = s.totalSamples;
    if (reason === 'silence' && vadEnd && vadEnd.speechDetected && vadEnd.lastVoiceMs !== null) {
      // חותכים את השקט שבסוף ומשאירים זנב קצר
      const keepMs = vadEnd.lastVoiceMs + TRAILING_SILENCE_KEEP_MS;
      keepSamples = Math.min(keepSamples, Math.ceil((keepMs * s.sampleRate) / 1000));
    }
    const raw = concatFloat32(s.chunks, keepSamples);
    const pcm = resampleTo16k(raw, s.sampleRate);
    return {
      reason,
      wav: encodeWav16(pcm, TARGET_SAMPLE_RATE),
      durationMs: Math.round((pcm.length * 1000) / TARGET_SAMPLE_RATE),
      speechDetected,
    };
  }

  async function finish(s: Session, reason: CaptureEndReason, vadEnd: VadEnd | null = null): Promise<void> {
    if (s.phase !== 'active') return;
    s.phase = 'ended';
    releaseInputs(s);
    const closing = closeGraph(s);
    let result: CaptureResult;
    try {
      result = buildResult(s, reason, vadEnd);
    } catch {
      // לא אמור לקרות; העיקר ש-done ייפתר
      result = emptyResult('error');
    }
    s.chunks = [];
    await closing;
    s.resolveDone(result);
  }

  /** stop/cancel שהגיעו לפני שהמיקרופון נפתח: משחררים הכול ומסיימים בלי הקלטה. */
  async function endBeforeActive(s: Session): Promise<void> {
    const reason = s.pendingEnd ?? 'cancelled';
    s.phase = 'ended';
    releaseInputs(s);
    const closing = closeGraph(s);
    published = s.done;
    await closing;
    s.resolveDone(emptyResult(reason));
  }

  function notifyLevel(s: Session, samples: Float32Array): void {
    if (!s.onLevel || samples.length === 0) return;
    try {
      s.onLevel(rmsToLevel(rmsOf(samples)));
    } catch {
      // שגיאה בקוד הממשק לא עוצרת הקלטה
    }
  }

  function processChunk(s: Session, samples: Float32Array): void {
    const vad = s.vad;
    if (!vad) return;
    s.lastChunkAt = timers.now();
    let keep = samples.length;
    let endEvent: VadEnd | null = null;
    for (let i = 0; i < samples.length; i++) {
      const v = samples[i] ?? 0;
      s.frameSumSq += v * v;
      s.frameCount++;
      if (s.frameCount >= s.frameSize) {
        const rms = Math.sqrt(s.frameSumSq / s.frameCount);
        s.frameSumSq = 0;
        s.frameCount = 0;
        s.framesDone++;
        const endMs = (s.framesDone * s.frameSize * 1000) / s.sampleRate;
        const event = vad.push(rms, endMs);
        if (event?.type === 'end') {
          endEvent = event;
          keep = i + 1;
          break;
        }
      }
    }
    const kept = keep === samples.length ? samples : samples.subarray(0, keep);
    if (kept.length > 0) {
      s.chunks.push(kept);
      s.totalSamples += kept.length;
    }
    notifyLevel(s, kept);
    if (endEvent) void finish(s, endEvent.reason, endEvent);
  }

  function handleChunk(s: Session, samples: Float32Array): void {
    if (s.phase === 'starting') {
      s.preStartChunks.push(samples);
      return;
    }
    if (s.phase !== 'active') return;
    try {
      processChunk(s, samples);
    } catch {
      void finish(s, 'error');
    }
  }

  function handleFault(s: Session): void {
    if (s.phase === 'starting') s.startupFault = true;
    else if (s.phase === 'active') void finish(s, 'error');
  }

  function activate(s: Session, graph: MicGraph): void {
    s.phase = 'active';
    s.sampleRate = graph.sampleRate;
    s.frameSize = Math.max(1, Math.round((graph.sampleRate * MIC_FRAME_MS) / 1000));
    s.vad = createVad({ silenceTimeoutMs: s.silenceTimeoutMs, maxUtteranceMs: s.maxUtteranceSec * 1000 });
    s.lastChunkAt = timers.now();
    published = s.done;

    // ניתוק התקן (USB/Bluetooth) באמצע הקלטה -> מסיימים עם מה שנקלט
    for (const track of s.stream?.getAudioTracks() ?? []) {
      const onEnded = (): void => void finish(s, 'error');
      track.addEventListener('ended', onEnded);
      s.cleanups.push(() => track.removeEventListener('ended', onEnded));
    }

    s.watchdog = timers.setInterval(() => {
      if (s.phase === 'active' && timers.now() - s.lastChunkAt > STALL_TIMEOUT_MS) void finish(s, 'error');
    }, WATCHDOG_INTERVAL_MS);

    const early = s.preStartChunks;
    s.preStartChunks = [];
    for (const chunk of early) handleChunk(s, chunk);

    if (s.phase === 'active' && (s.stream?.getAudioTracks() ?? []).some((t) => t.readyState === 'ended')) {
      void finish(s, 'error');
    }
  }

  function requestEnd(reason: 'manual' | 'cancelled'): void {
    const s = current;
    if (!s) return;
    if (s.phase === 'starting') {
      if (s.pendingEnd === null || reason === 'cancelled') s.pendingEnd = reason;
      return;
    }
    if (s.phase === 'active') void finish(s, reason);
  }

  async function start(options: MicCaptureOptions): Promise<void> {
    if (current && (current.phase === 'starting' || current.phase === 'active')) {
      throw new MicError('unknown', MIC_MESSAGES.alreadyActive);
    }
    published = null;
    const getUserMedia = deps.getUserMedia;
    if (!getUserMedia) throw new MicError('unsupported', MIC_MESSAGES.unsupported);

    const s = newSession(options);
    current = s;
    const requestedDevice = normalizeDeviceId(options.deviceId) !== null;

    let pendingStream: Promise<MediaStream>;
    try {
      pendingStream = getUserMedia(buildMicConstraints(options.deviceId));
    } catch (error) {
      pendingStream = Promise.reject(error);
    }
    const opened = await settleWithin(pendingStream, OPEN_TIMEOUT_MS, timers);
    if (opened.status !== 'ok') {
      s.phase = 'failed';
      if (opened.status === 'failed') throw toMicError(opened.error, requestedDevice);
      // אם ההתקן ייפתח בכל זאת מאוחר יותר — משחררים אותו מיד
      pendingStream.then(stopTracks, () => undefined);
      throw new MicError('device-busy', MIC_MESSAGES.openTimeout);
    }
    const stream = opened.value;
    s.stream = stream;

    if (s.pendingEnd) return endBeforeActive(s);

    if (stream.getAudioTracks().length === 0) {
      s.phase = 'failed';
      releaseInputs(s);
      throw new MicError('no-device', requestedDevice ? MIC_MESSAGES.selectedDeviceMissing : MIC_MESSAGES.noDevice);
    }

    let pendingGraph: Promise<MicGraph>;
    try {
      pendingGraph = deps.openGraph(stream, {
        onChunk: (samples) => handleChunk(s, samples),
        onFault: () => handleFault(s),
      });
    } catch (error) {
      pendingGraph = Promise.reject(error);
    }
    const built = await settleWithin(pendingGraph, OPEN_TIMEOUT_MS, timers);
    if (built.status !== 'ok') {
      s.phase = 'failed';
      releaseInputs(s);
      if (built.status === 'timeout') {
        pendingGraph.then(
          (graph) => graph.close().catch(() => undefined),
          () => undefined,
        );
        throw new MicError('unknown', MIC_MESSAGES.audioEngineTimeout);
      }
      throw built.error instanceof MicError ? built.error : new MicError('unknown', MIC_MESSAGES.audioEngine);
    }
    s.graph = built.value;

    if (s.startupFault) {
      s.phase = 'failed';
      releaseInputs(s);
      await closeGraph(s);
      throw new MicError('unknown', MIC_MESSAGES.audioEngine);
    }
    if (s.pendingEnd) return endBeforeActive(s);

    activate(s, s.graph);
  }

  function activeGraph(): MicGraph | null {
    return current?.phase === 'active' ? current.graph : null;
  }

  return {
    start,
    stop: () => requestEnd('manual'),
    cancel: () => requestEnd('cancelled'),
    get done() {
      return published;
    },
    get active() {
      return current?.phase === 'active';
    },
    getLevel() {
      const graph = activeGraph();
      if (!graph) return 0;
      try {
        return graph.getLevel();
      } catch {
        return 0;
      }
    },
    getWaveform(target: Float32Array) {
      const graph = activeGraph();
      if (!graph) return false;
      try {
        return graph.getWaveform(target);
      } catch {
        return false;
      }
    },
  };
}

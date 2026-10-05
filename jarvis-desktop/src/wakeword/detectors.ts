/**
 * מנועי מילת ההפעלה ב-renderer, במימוש של הממשק WakeWordDetector:
 *
 * 1) openWakeWord — "Hey Jarvis". מקומי לחלוטין, בלי מפתח. המודלים (CC BY-NC-SA 4.0) מוגשים
 *    מקומית מ-app://jarvis/models/ ורצים ב-onnxruntime-web (WebAssembly).
 * 2) Porcupine — "Jarvis" (מילה אחת). המנוע והמפתח ב-main; כאן רק מזרימים פריימים של אודיו
 *    ל-main דרך IPC. זיהוי חוזר כפקודה toggle-listen ממקור 'wakeword'.
 *
 * בשני המקרים: האודיו לא יוצא מהמחשב, ואפשר להשהות בזמן ש-JARVIS מדבר כדי שלא "ישמע את עצמו".
 */
import type { WakeWordDetector } from '../renderer/audio/types';
import { createMic16k, type Mic16k } from './mic16k';
import { OpenWakeWordPipeline, WakeDecider, adaptOrtSession, floatToInt16Range, type SessionLike, type TensorFactory } from './openwakeword';

type DetectorState = WakeWordDetector['state'];

function describeMicError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : '';
  if (name === 'NotAllowedError') return 'אין הרשאה למיקרופון.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'לא נמצא מיקרופון.';
  if (name === 'NotReadableError') return 'המיקרופון תפוס על ידי תוכנה אחרת.';
  return err instanceof Error ? err.message : 'שגיאה לא ידועה.';
}

/* ------------------------------------------------------------------ */
/* openWakeWord                                                         */
/* ------------------------------------------------------------------ */

const MODEL_BASE = 'models/openwakeword/';

export function createOpenWakeWordDetector(): WakeWordDetector {
  let state: DetectorState = 'stopped';
  let lastError: string | null = null;
  let mic: Mic16k | null = null;
  let pipeline: OpenWakeWordPipeline | null = null;
  let decider: WakeDecider | null = null;
  let onDetected: (() => void) | null = null;
  let queue: Promise<void> = Promise.resolve();
  let paused = false;
  let generation = 0;

  async function loadSessions(): Promise<{ sessions: { melspectrogram: SessionLike; embedding: SessionLike; wakeword: SessionLike }; tensor: TensorFactory }> {
    const ort = await import('onnxruntime-web/wasm');
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    ort.env.wasm.wasmPaths = new URL('ort/', document.baseURI).href;
    const load = async (name: string) => {
      const res = await fetch(new URL(MODEL_BASE + name, document.baseURI));
      if (!res.ok) throw new Error(`המודל ${name} חסר (הרץ npm run fetch-models בבנייה).`);
      return adaptOrtSession(await ort.InferenceSession.create(new Uint8Array(await res.arrayBuffer()), { executionProviders: ['wasm'] }));
    };
    const [melspectrogram, embedding, wakeword] = await Promise.all([
      load('melspectrogram.onnx'),
      load('embedding_model.onnx'),
      load('hey_jarvis_v0.1.onnx'),
    ]);
    return {
      sessions: { melspectrogram, embedding, wakeword },
      tensor: (data, dims) => new ort.Tensor('float32', data, dims),
    };
  }

  return {
    engine: 'openwakeword',
    get state() {
      return state;
    },
    get lastError() {
      return lastError;
    },
    async start(options) {
      if (state === 'listening' || state === 'loading' || state === 'paused') return;
      state = 'loading';
      lastError = null;
      onDetected = options.onDetected;
      decider = new WakeDecider(options.sensitivity);
      const myGen = ++generation;
      try {
        const { sessions, tensor } = await loadSessions();
        pipeline = new OpenWakeWordPipeline(sessions, tensor);
        await pipeline.reset();
        mic = createMic16k((block) => {
          if (paused || !pipeline || myGen !== generation) return;
          const samples = floatToInt16Range(block);
          // עיבוד סדרתי — כל בלוק אחרי הקודם, כדי לשמור על סדר הזמן
          queue = queue
            .then(async () => {
              if (!pipeline || paused) return;
              const scores = await pipeline.push(samples);
              const now = performance.now();
              for (const s of scores) {
                if (decider?.update(s, now)) onDetected?.();
              }
            })
            .catch((err: unknown) => {
              lastError = err instanceof Error ? err.message : String(err);
            });
        });
        await mic.start(options.deviceId);
        state = paused ? 'paused' : 'listening';
      } catch (err) {
        state = 'error';
        lastError = describeMicError(err);
        await mic?.stop().catch(() => undefined);
        mic = null;
        throw new Error(lastError, { cause: err });
      }
    },
    pause() {
      paused = true;
      if (state === 'listening') state = 'paused';
    },
    resume() {
      if (!paused) return;
      paused = false;
      // מתחילים "נקי" אחרי השהיה, כדי שאודיו ישן (למשל ההקראה של JARVIS) לא ייספר
      queue = queue.then(() => pipeline?.reset()).catch(() => undefined);
      if (state === 'paused') state = 'listening';
    },
    async stop() {
      generation++;
      await mic?.stop().catch(() => undefined);
      mic = null;
      pipeline = null;
      paused = false;
      state = 'stopped';
    },
  };
}

/* ------------------------------------------------------------------ */
/* Porcupine (המנוע ב-main)                                              */
/* ------------------------------------------------------------------ */

export function createPorcupineBridgeDetector(): WakeWordDetector {
  let state: DetectorState = 'stopped';
  let lastError: string | null = null;
  let mic: Mic16k | null = null;
  let paused = false;
  let pending = new Int16Array(0);
  let batch = 1024;

  return {
    engine: 'porcupine',
    get state() {
      return state;
    },
    get lastError() {
      return lastError;
    },
    async start(options) {
      if (state === 'listening' || state === 'loading' || state === 'paused') return;
      state = 'loading';
      lastError = null;
      const res = await window.jarvis.wakeword.startPorcupine(options.sensitivity);
      if (!res.ok) {
        state = 'error';
        lastError = res.message_he;
        throw new Error(res.message_he);
      }
      // שני פריימים בכל הודעה (≈64ms) — מאזן בין השהיה לעומס IPC
      batch = res.frameLength * 2;
      try {
        mic = createMic16k((block) => {
          if (paused) return;
          const ints = floatToInt16Range(block);
          const merged = new Int16Array(pending.length + ints.length);
          merged.set(pending, 0);
          for (let i = 0; i < ints.length; i++) merged[pending.length + i] = ints[i] ?? 0;
          let offset = 0;
          while (merged.length - offset >= batch) {
            window.jarvis.wakeword.pushFrames(merged.slice(offset, offset + batch));
            offset += batch;
          }
          pending = merged.slice(offset);
        });
        await mic.start(options.deviceId);
        state = paused ? 'paused' : 'listening';
      } catch (err) {
        state = 'error';
        lastError = describeMicError(err);
        await window.jarvis.wakeword.stopPorcupine().catch(() => undefined);
        throw new Error(lastError, { cause: err });
      }
    },
    pause() {
      paused = true;
      pending = new Int16Array(0);
      if (state === 'listening') state = 'paused';
    },
    resume() {
      paused = false;
      if (state === 'paused') state = 'listening';
    },
    async stop() {
      await mic?.stop().catch(() => undefined);
      mic = null;
      pending = new Int16Array(0);
      paused = false;
      await window.jarvis.wakeword.stopPorcupine().catch(() => undefined);
      state = 'stopped';
    },
  };
}

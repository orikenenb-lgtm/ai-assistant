/**
 * מנועי מילת ההפעלה ב-renderer, במימוש של הממשק WakeWordDetector:
 *
 * 1) openWakeWord — "Hey Jarvis". מקומי לחלוטין, בלי מפתח. המודלים (CC BY-NC-SA 4.0) מוגשים
 *    מקומית מ-app://jarvis/models/ ורצים ב-onnxruntime-web (WebAssembly).
 * 2) Porcupine — "Jarvis" (מילה אחת). המנוע והמפתח ב-main; כאן רק מזרימים פריימים של אודיו
 *    ל-main דרך IPC. זיהוי חוזר כפקודה toggle-listen ממקור 'wakeword'.
 *
 * בשני המקרים: האודיו לא יוצא מהמחשב, ואפשר להשהות בזמן ש-JARVIS מדבר כדי שלא "ישמע את עצמו".
 *
 * מחזור החיים משותף לשני המנועים (createDetector):
 * - כל start() מקבל "ריצה" משלו. stop() באמצע start() מבטל את הריצה: כל await נבדק מול הריצה הנוכחית,
 *   ומה שכבר נפתח (מיקרופון, סשן ב-main) משתחרר. start() שבוטל זורק AbortError ולא מדווח 'listening'.
 * - תקלה אחרי הפעלה מוצלחת לא נבלעת: מיקרופון שנותק / AudioContext שנסגר / אין בלוקים של אודיו
 *   ~3 שניות / שגיאות זיהוי חוזרות / סשן שנפל ב-main — הגלאי עובר ל-'error', משחרר את המיקרופון
 *   ומדווח דרך onStateChange (הבקר מנסה שוב בהשהיה).
 */
import type { WakeWordDetector } from '../renderer/audio/types';
import { abortError, createMic16k, isAbortError, type Mic16k, type Mic16kEvents } from './mic16k';
import { OpenWakeWordPipeline, WakeDecider, adaptOrtSession, floatToInt16Range, type SessionLike, type TensorFactory } from './openwakeword';

type DetectorState = WakeWordDetector['state'];
type StartOptions = Parameters<WakeWordDetector['start']>[0];

export const NO_MIC_ENV_MESSAGE = 'אין גישה למיקרופון בסביבה הזו.';
export const MIC_LOST_MESSAGE = 'המיקרופון התנתק או הפסיק לשדר.';
export const NO_AUDIO_MESSAGE = 'לא מתקבל אודיו מהמיקרופון.';
export const ENGINE_FAILED_MESSAGE = 'מנוע הזיהוי המקומי הפסיק לעבוד.';
export const SESSION_LOST_MESSAGE = 'מנוע מילת ההפעלה נעצר.';

/** בלי בלוק אודיו אחד במשך הזמן הזה (גם בזמן השהיה — המיקרופון ממשיך לרוץ) = המיקרופון לא באמת עובד. */
export const NO_AUDIO_TIMEOUT_MS = 3000;
export const WATCHDOG_INTERVAL_MS = 1000;
/** כמה שגיאות זיהוי ברצף מעבירות את הגלאי למצב שגיאה. */
export const MAX_INFERENCE_ERRORS = 5;
/** כמה בלוקים (128 דגימות = 8ms) מותר שיחכו לעיבוד לפני שזורקים את התור ומאפסים (מחשב עמוס). */
export const MAX_PENDING_BLOCKS = 10;

export interface DetectorTimers {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface DetectorDeps {
  timers?: DetectorTimers;
  /** שעון מונוטוני (performance.now). */
  now?: () => number;
  createMic?: (onBlock: (samples: Float32Array) => void, events: Mic16kEvents) => Mic16k;
}

interface OwwSessions {
  sessions: { melspectrogram: SessionLike; embedding: SessionLike; wakeword: SessionLike };
  tensor: TensorFactory;
}

export interface OpenWakeWordDeps extends DetectorDeps {
  loadSessions?: () => Promise<OwwSessions>;
}

function hasMicrophoneApi(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function';
}

function describeMicError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : '';
  if (name === 'NotAllowedError') return 'אין הרשאה למיקרופון.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'לא נמצא מיקרופון.';
  if (name === 'NotReadableError') return 'המיקרופון תפוס על ידי תוכנה אחרת.';
  return err instanceof Error ? err.message : 'שגיאה לא ידועה.';
}

function technical(err: unknown): string {
  return (err instanceof Error ? `${err.name}: ${err.message}` : String(err)).slice(0, 300);
}

function defaultTimers(): DetectorTimers {
  return {
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
  };
}

function defaultNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/* ------------------------------------------------------------------ */
/* מחזור חיים משותף                                                     */
/* ------------------------------------------------------------------ */

/** מה שהמנוע מקבל מהגלאי בזמן ריצה. */
interface RunContext {
  /** האם הריצה הזו עדיין הנוכחית (לא נעצרה ולא הוחלפה). */
  isCurrent(): boolean;
  /** תקלה אחרי הפעלה: הגלאי עובר ל-error ומשחרר הכול. */
  fail(message: string, detail?: string): void;
  /** זיהוי של מילת ההפעלה (מתעלמים בזמן השהיה). */
  detected(): void;
  now(): number;
}

/** החלק הספציפי של מנוע אחד בריצה פעילה. */
interface EngineRun {
  onBlock(block: Float32Array): void;
  onPause?(): void;
  onResume?(): void;
  /** בדיקת תקינות תקופתית (למשל מצב הסשן ב-main). */
  poll?(): void;
  /** שחרור (חייב להיות idempotent). */
  release(): Promise<void>;
}

interface EngineHooks {
  engine: WakeWordDetector['engine'];
  available(): boolean;
  /** טעינה לפני פתיחת המיקרופון. זורק Error עם הודעה (בעברית אם אפשר). */
  prepare(ctx: RunContext, options: StartOptions): Promise<EngineRun>;
}

interface Run {
  mic: Mic16k | null;
  engine: EngineRun | null;
  watchdog: unknown;
  lastBlockAt: number;
}

function createDetector(hooks: EngineHooks, deps: DetectorDeps): WakeWordDetector {
  const timers = deps.timers ?? defaultTimers();
  const now = deps.now ?? defaultNow;
  const createMic = deps.createMic ?? createMic16k;
  let state: DetectorState = 'stopped';
  let lastError: string | null = null;
  let lastErrorDetail: string | null = null;
  let run: Run | null = null;
  let paused = false;
  let listener: ((s: DetectorState) => void) | null = null;

  function setState(next: DetectorState): void {
    if (state === next) return;
    state = next;
    try {
      listener?.(next);
    } catch {
      // מאזין שנכשל לא משבש את הגלאי
    }
  }

  /** משחרר את משאבי הריצה. בטוח לקריאה כפולה (stop + catch של start). */
  async function teardown(r: Run): Promise<void> {
    if (r.watchdog !== null) {
      timers.clearInterval(r.watchdog);
      r.watchdog = null;
    }
    const mic = r.mic;
    const engine = r.engine;
    r.mic = null;
    r.engine = null;
    await mic?.stop().catch(() => undefined);
    await engine?.release().catch(() => undefined);
  }

  function failRun(r: Run, message: string, detail?: string): void {
    if (run !== r) return;
    run = null;
    lastError = message;
    lastErrorDetail = detail ?? null;
    setState('error');
    void teardown(r);
  }

  function check(r: Run): void {
    if (run !== r) return;
    if (now() - r.lastBlockAt > NO_AUDIO_TIMEOUT_MS) {
      failRun(r, NO_AUDIO_MESSAGE);
      return;
    }
    r.engine?.poll?.();
  }

  return {
    engine: hooks.engine,
    get state() {
      return state;
    },
    get lastError() {
      return lastError;
    },
    get lastErrorDetail() {
      return lastErrorDetail;
    },
    async start(options) {
      if (state === 'listening' || state === 'loading' || state === 'paused') return;
      listener = options.onStateChange ?? null;
      if (!hooks.available()) {
        lastError = NO_MIC_ENV_MESSAGE;
        lastErrorDetail = null;
        setState('error');
        throw new Error(NO_MIC_ENV_MESSAGE);
      }
      const r: Run = { mic: null, engine: null, watchdog: null, lastBlockAt: now() };
      run = r;
      lastError = null;
      lastErrorDetail = null;
      setState('loading');
      const ctx: RunContext = {
        isCurrent: () => run === r,
        fail: (message, detail) => failRun(r, message, detail),
        detected: () => {
          if (run === r && !paused && state === 'listening') options.onDetected();
        },
        now,
      };
      try {
        r.engine = await hooks.prepare(ctx, options);
        if (run !== r) throw abortError();
        r.mic = createMic(
          (block) => {
            if (run !== r) return;
            r.lastBlockAt = now();
            if (paused) return;
            r.engine?.onBlock(block);
          },
          { onFailure: (reason) => failRun(r, MIC_LOST_MESSAGE, reason) },
        );
        await r.mic.start(options.deviceId);
        if (run !== r) throw abortError();
      } catch (err) {
        if (run !== r) {
          // נעצר / הוחלף באמצע ההפעלה — משחררים את מה שנפתח, ולא מדווחים "מאזין"
          await teardown(r);
          throw isAbortError(err) ? err : abortError();
        }
        run = null;
        lastError = describeMicError(err);
        lastErrorDetail = lastError === (err instanceof Error ? err.message : '') ? null : technical(err);
        setState('error');
        await teardown(r);
        throw new Error(lastError, { cause: err });
      }
      r.lastBlockAt = now();
      r.watchdog = timers.setInterval(() => check(r), WATCHDOG_INTERVAL_MS);
      setState(paused ? 'paused' : 'listening');
    },
    pause() {
      if (paused) return;
      paused = true;
      run?.engine?.onPause?.();
      if (state === 'listening') setState('paused');
    },
    resume() {
      if (!paused) return;
      paused = false;
      run?.engine?.onResume?.();
      if (state === 'paused') setState('listening');
    },
    async stop() {
      const r = run;
      run = null;
      paused = false;
      if (r) await teardown(r);
      setState('stopped');
      listener = null;
    },
  };
}

/* ------------------------------------------------------------------ */
/* openWakeWord                                                         */
/* ------------------------------------------------------------------ */

const MODEL_BASE = 'models/openwakeword/';

async function loadOwwSessions(): Promise<OwwSessions> {
  const ort = await import('onnxruntime-web/wasm');
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  // קובץ ה-WebAssembly נארז ע"י Vite לצד הקוד (assets/) ונטען מאותו מקור — מותר ב-CSP
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

export function createOpenWakeWordDetector(deps: OpenWakeWordDeps = {}): WakeWordDetector {
  const loadSessions = deps.loadSessions ?? loadOwwSessions;
  return createDetector(
    {
      engine: 'openwakeword',
      available: hasMicrophoneApi,
      async prepare(ctx, options) {
        const { sessions, tensor } = await loadSessions();
        const pipeline = new OpenWakeWordPipeline(sessions, tensor);
        await pipeline.reset();
        const decider = new WakeDecider(options.sensitivity);
        let queue: Promise<void> = Promise.resolve();
        let pending = 0;
        let epoch = 0;
        let errors = 0;
        let released = false;

        /** זורק את כל מה שממתין ומאפס את הצינור (אחרי השהיה, או כשהעיבוד לא עומד בקצב). */
        const flushAndReset = () => {
          epoch++;
          pending = 0;
          const mine = epoch;
          queue = queue
            .then(async () => {
              if (!released && mine === epoch) await pipeline.reset();
            })
            .catch(() => undefined);
        };

        return {
          onBlock(block) {
            if (released) return;
            if (pending >= MAX_PENDING_BLOCKS) {
              // ה-thread הראשי עמוס ולא עומד בקצב: לא צוברים פיגור (זיהוי באיחור של שניות לא שימושי)
              flushAndReset();
              return;
            }
            const samples = floatToInt16Range(block);
            const mine = epoch;
            pending++;
            // עיבוד סדרתי — כל בלוק אחרי הקודם, כדי לשמור על סדר הזמן
            queue = queue
              .then(async () => {
                if (released || mine !== epoch) return;
                try {
                  const scores = await pipeline.push(samples);
                  errors = 0;
                  if (released || mine !== epoch) return;
                  const t = ctx.now();
                  for (const s of scores) {
                    if (decider.update(s, t)) ctx.detected();
                  }
                } catch (err) {
                  errors++;
                  if (errors >= MAX_INFERENCE_ERRORS) ctx.fail(ENGINE_FAILED_MESSAGE, technical(err));
                } finally {
                  if (mine === epoch) pending = Math.max(0, pending - 1);
                }
              })
              .catch(() => undefined);
          },
          onResume() {
            // מתחילים "נקי" אחרי השהיה, כדי שאודיו ישן (למשל ההקראה של JARVIS) לא ייספר.
            // האיפוס זול: תכונות הרעש הדטרמיניסטיות מחושבות פעם אחת ומועתקות.
            flushAndReset();
          },
          async release() {
            released = true;
            epoch++;
          },
        };
      },
    },
    deps,
  );
}

/* ------------------------------------------------------------------ */
/* Porcupine (המנוע ב-main)                                              */
/* ------------------------------------------------------------------ */

function hasBridge(): boolean {
  return typeof window !== 'undefined' && Boolean(window.jarvis);
}

export function createPorcupineBridgeDetector(deps: DetectorDeps = {}): WakeWordDetector {
  return createDetector(
    {
      engine: 'porcupine',
      available: () => hasMicrophoneApi() && hasBridge(),
      async prepare(ctx, options) {
        const api = window.jarvis.wakeword;
        const res = await api.startPorcupine(options.sensitivity);
        if (!res.ok) throw new Error(res.message_he);
        const sessionId = res.sessionId;
        // שני פריימים בכל הודעה (≈64ms) — מאזן בין השהיה לעומס IPC
        const batch = res.frameLength * 2;
        let pending = new Int16Array(0);
        let released = false;
        let polling = false;

        return {
          onBlock(block) {
            if (released) return;
            const ints = floatToInt16Range(block);
            const merged = new Int16Array(pending.length + ints.length);
            merged.set(pending, 0);
            for (let i = 0; i < ints.length; i++) merged[pending.length + i] = ints[i] ?? 0;
            let offset = 0;
            while (merged.length - offset >= batch) {
              api.pushFrames(sessionId, merged.slice(offset, offset + batch));
              offset += batch;
            }
            pending = merged.slice(offset);
          },
          onPause() {
            pending = new Int16Array(0);
          },
          poll() {
            // pushFrames הוא fire-and-forget; כשל של המנוע ב-main נחשף דרך מצב הסשן
            if (polling || released || typeof api.statusPorcupine !== 'function') return;
            polling = true;
            api.statusPorcupine(sessionId).then(
              (st) => {
                polling = false;
                if (released || !ctx.isCurrent()) return;
                if (st.state === 'failed') ctx.fail(st.message_he);
                else if (st.state === 'stopped') ctx.fail(SESSION_LOST_MESSAGE);
              },
              () => {
                polling = false;
              },
            );
          },
          async release() {
            if (released) return;
            released = true;
            pending = new Int16Array(0);
            // עם מזהה הסשן: אם גלאי חדש כבר התחיל סשן משלו, main מתעלם מהעצירה הזו
            await api.stopPorcupine(sessionId).catch(() => undefined);
          },
        };
      },
    },
    deps,
  );
}

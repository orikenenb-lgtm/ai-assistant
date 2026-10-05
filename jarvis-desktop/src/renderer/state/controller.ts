/**
 * הבקר של ה-renderer: מחזיק את זרימת הקול (מיקרופון ← תמלול ← שליחה ← הקראה),
 * מאזין לאירועים מ-main ולפקודות (קיצור מקשים / מגש), ומנהל את ה-store שהממשק קורא ממנו.
 *
 * עקרונות:
 * - מצב התצוגה משקף רק פעילות אמיתית: LISTENING רק אחרי שהמיקרופון נפתח בפועל,
 *   SPEAKING רק כשהאודיו התחיל להישמע בפועל (source.start / utterance.onstart).
 * - כל פעולה אסינכרונית מסומנת במספר רצף (seq). תוצאה שמגיעה אחרי עצירה/החלפה — נזרקת.
 * - "עצור" עוצר גם תשובה שכבר יצאה מ-main באותו רגע (לא מקריאים אותה), וגם עבודה בענן שבדרך.
 * - אין תלות ישירה במימוש שכבת האודיו: הכול מוזרק (כך הבדיקות רצות עם MOCK).
 *
 * מחזור החיים של מילת ההפעלה נמצא ב-WakeWordSupervisor, וההקראה ב-SpeechOutput.
 */
import { createContext, useContext } from 'react';
import type { JarvisApi, Result, SubmitResult, TranscribeResult } from '../../shared/api-types';
import { MAX_TEXT_INPUT } from '../../shared/ipc-channels';
import type { Settings, SettingsPatch } from '../../shared/settings-schema';
import type {
  ActionRecord,
  ApprovalRequest,
  AssistantEvent,
  AssistantSnapshot,
  AudioPhase,
  DisplayInfo,
  EnginePhase,
  InputSource,
  ReminderDTO,
  ScreenCaptureStage,
  ServiceStatus,
  UiCommand,
} from '../../shared/types';
import type { CaptureResult, EchoCheck, LevelSource, MicCapture, SpeechPlayback, SystemSpeaker, SystemVoiceInfo, WakeWordDetector } from '../audio';
import { he } from '../i18n/he';
import { ipcErrorMessage, micErrorMessage } from './messages';
import { SpeechOutput, type SpeechChannel } from './speech-output';
import { createStore, useStore, type Store } from './store';
import { WAKE_TAIL_MS, WakeWordSupervisor, type WakeView } from './wake-supervisor';

export { WAKE_POLL_MS, WAKE_RETRY_DELAYS_MS, WAKE_TAIL_MS } from './wake-supervisor';
export type { WakeStatus, WakeView } from './wake-supervisor';

/* ------------------------------------------------------------------ */
/* טיפוסים                                                              */
/* ------------------------------------------------------------------ */

export interface AudioFactories {
  createMicCapture(): MicCapture;
  createSpeechPlayback(): SpeechPlayback;
  createSystemSpeaker(): SystemSpeaker;
  createWakeWordDetector(engine: 'openwakeword' | 'porcupine'): WakeWordDetector;
  isLikelyEcho: EchoCheck;
}

/** טיימרים מוזרקים (בדפדפן: window.setTimeout וכו'; בבדיקות: שעון MOCK). */
export interface TimerApi {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

/** החלק שאנחנו צריכים מ-BatteryManager של Chromium. */
export interface BatteryLike {
  readonly level: number;
  readonly charging: boolean;
  readonly chargingTime: number;
  readonly dischargingTime: number;
  addEventListener(type: 'levelchange' | 'chargingchange', listener: () => void): void;
  removeEventListener(type: 'levelchange' | 'chargingchange', listener: () => void): void;
}

export interface ControllerDeps {
  api: JarvisApi;
  audio: AudioFactories;
  /** זמן נוכחי במילישניות (epoch). */
  now: () => number;
  /** שעון מונוטוני (performance.now) למדידת פערים קצרים. ברירת מחדל: now. */
  monotonicNow?: () => number;
  timers: TimerApi;
  /** UUID לכל שליחה (clientRequestId) ולבקשות קול (requestId לביטול). */
  randomId: () => string;
  /** navigator.getBattery אם קיים. */
  getBattery?: () => Promise<BatteryLike> | undefined;
  /** הרשמה ל-navigator.mediaDevices 'devicechange' (ניסיון חוזר של מילת ההפעלה כשמיקרופון חובר). */
  onDeviceChange?: (listener: () => void) => () => void;
}

export type ListenSource = 'ui' | 'keyboard' | 'hotkey' | 'tray' | 'wakeword' | 'followup';
export type SpeechOutputKind = 'none' | 'audio' | 'system';
export type MicTestState = 'off' | 'meter' | 'recording' | 'transcribing';
export type ToastKind = 'info' | 'success' | 'warning' | 'error';
export type DataScope = 'tasks' | 'reminders' | 'settings' | 'secrets' | 'history' | 'usage';
export type SettingsSectionId = 'general' | 'brain' | 'voice' | 'wake' | 'launcher' | 'screen' | 'privacy' | 'about';
export type ViewMode = 'full' | 'compact';

export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
  sticky: boolean;
}

export interface UserLine {
  text: string;
  source: InputSource;
  turnId: string | null;
}

export interface ReplyLine {
  text: string;
  mode: 'ai' | 'local';
  turnId: string;
}

export interface UiState {
  ready: boolean;
  settings: Settings | null;
  initError: string | null;
  enginePhase: EnginePhase;
  engineLabel: string | null;
  audioPhase: AudioPhase;
  /** המיקרופון בתהליך פתיחה (עוד לא מקליט). */
  micStarting: boolean;
  micTest: MicTestState;
  /** יש הקראה בתהליך (כולל המתנה לסינתזה, לפני שהשמע התחיל) — אפשר לעצור אותה. */
  speechActive: boolean;
  speechOutput: SpeechOutputKind;
  activeTurnId: string | null;
  pendingApprovals: ApprovalRequest[];
  errorActive: boolean;
  lastErrorText: string | null;
  lastUser: UserLine | null;
  lastReply: ReplyLine | null;
  awaitingReply: boolean;
  actions: ActionRecord[];
  missedReminders: ReminderDTO[];
  toasts: Toast[];
  screenCapture: { stage: ScreenCaptureStage; displayLabel?: string } | null;
  wake: WakeView;
  services: ServiceStatus[];
  viewMode: ViewMode;
  settingsOpen: boolean;
  settingsSection: SettingsSectionId;
  dataVersion: Record<DataScope, number>;
  submitting: boolean;
  screenRequestPending: boolean;
}

export type LevelSourceInfo =
  | { kind: 'mic'; source: LevelSource }
  | { kind: 'playback'; source: LevelSource }
  | { kind: 'system'; source: null }
  | { kind: 'none'; source: null };

export type VoiceTestResult = { ok: true; text: string } | { ok: false; message: string };

/* ------------------------------------------------------------------ */
/* קבועים                                                               */
/* ------------------------------------------------------------------ */

/** כמה זמן מצב השגיאה מוצג אחרי תקלה מקומית. */
export const ERROR_FLASH_MS = 6000;
export const TOAST_MS = 5000;
export const TOAST_ERROR_MS = 9000;
export const MAX_TOASTS = 4;
export const MAX_ACTIONS = 30;
export const SERVICES_POLL_MS = 30_000;
/** האזנת המשך נפתחת אחרי אותו זנב כמו מילת ההפעלה — שסוף ההקראה לא ייכנס להקלטה. */
export const FOLLOW_UP_DELAY_MS = WAKE_TAIL_MS;
/** כמה האזנות המשך אוטומטיות ברצף בלי הפעלה מפורשת (כפתור / קיצור / מילת הפעלה / הקלדה). */
export const MAX_AUTO_FOLLOW_UPS = 2;
/**
 * מסנן ההד הטקסטואלי מופעל רק כשאין ביטול הד אמיתי (קול המערכת יוצא מחוץ ל-Chromium),
 * או כשההקלטה התחילה זמן קצר כל כך אחרי סוף ההקראה שהשארית עוד בחדר.
 */
export const ECHO_FILTER_MAX_GAP_MS = 1500;
const SCREEN_STAGE_LINGER_MS = 3500;
const MIC_RELEASE_TIMEOUT_MS = 1500;
const SETTINGS_RETRY_MS = 5000;
/** כמה מזהי תורות שנעצרו זוכרים (כדי לא להקריא תשובה שהגיעה אחרי "עצור"). */
const MAX_REMEMBERED_TURNS = 100;

export function initialUiState(): UiState {
  return {
    ready: false,
    settings: null,
    initError: null,
    enginePhase: 'IDLE',
    engineLabel: null,
    audioPhase: 'IDLE',
    micStarting: false,
    micTest: 'off',
    speechActive: false,
    speechOutput: 'none',
    activeTurnId: null,
    pendingApprovals: [],
    errorActive: false,
    lastErrorText: null,
    lastUser: null,
    lastReply: null,
    awaitingReply: false,
    actions: [],
    missedReminders: [],
    toasts: [],
    screenCapture: null,
    wake: { status: 'off', error: null, engine: null },
    services: [],
    viewMode: 'full',
    settingsOpen: false,
    settingsSection: 'general',
    dataVersion: { tasks: 0, reminders: 0, settings: 0, secrets: 0, history: 0, usage: 0 },
    submitting: false,
    screenRequestPending: false,
  };
}

type ListenPhase = 'idle' | 'starting' | 'listening' | 'finishing' | 'transcribing';

function clampDurationMs(ms: number): number {
  if (!Number.isFinite(ms)) return 100;
  return Math.min(65_000, Math.max(100, Math.round(ms)));
}

function finiteOrNull(n: number): number | null {
  return Number.isFinite(n) ? n : null;
}

function mergeById<T extends { id: string }>(current: readonly T[], incoming: readonly T[]): T[] {
  const map = new Map<string, T>();
  for (const item of current) map.set(item.id, item);
  for (const item of incoming) map.set(item.id, item);
  return [...map.values()];
}

function wakeSettingsChanged(prev: Settings, next: Settings): boolean {
  return (
    prev.wakeWord.enabled !== next.wakeWord.enabled ||
    prev.wakeWord.engine !== next.wakeWord.engine ||
    prev.wakeWord.sensitivity !== next.wakeWord.sensitivity ||
    prev.voice.micDeviceId !== next.voice.micDeviceId
  );
}

/** מוסיף לסט/מפה עם גבול גודל (הישנים נמחקים ראשונים). */
function boundedAdd<K>(set: Set<K>, key: K, max: number): void {
  set.add(key);
  while (set.size > max) {
    const oldest = set.values().next().value as K;
    set.delete(oldest);
  }
}

/** מחכה לסיום הבטחה, אבל לא יותר מ-ms (שחרור מיקרופון שנתקע לא יקפיא את הממשק). */
function settleWithin(promise: Promise<unknown> | null | undefined, ms: number, timers: TimerApi): Promise<void> {
  if (!promise) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const handle = timers.setTimeout(resolve, ms);
    promise.then(
      () => {
        timers.clearTimeout(handle);
        resolve();
      },
      () => {
        timers.clearTimeout(handle);
        resolve();
      },
    );
  });
}

/* ------------------------------------------------------------------ */
/* הבקר                                                                 */
/* ------------------------------------------------------------------ */

export class JarvisController {
  readonly store: Store<UiState>;
  readonly api: JarvisApi;

  private readonly deps: ControllerDeps;
  private disposed = false;
  private initStarted = false;
  private readonly unsubs: Array<() => void> = [];

  // --- הקלטה ותמלול ---
  private listenPhase: ListenPhase = 'idle';
  private listenSeq = 0;
  private mic: MicCapture | null = null;
  /** מתי המיקרופון נפתח בפועל בהקלטה הנוכחית (שעון מונוטוני) — למדידת הפער מסוף ההקראה. */
  private captureStartedAt: number | null = null;
  /** בקשת התמלול שבדרך (לביטול בענן בעצירה). */
  private transcribeRequestId: string | null = null;

  // --- הקראה ---
  private readonly speech: SpeechOutput;
  private speakSeq = 0;
  private speakActive = false;
  private speechStarted = false;
  private speechUsedSystem = false;
  private lastSpokenText: string | null = null;
  private lastSpeechUsedSystem = false;
  private speechEndedAt: number | null = null;
  private followUpTimer: unknown = null;
  private autoFollowUps = 0;
  /** תשובה שהגיעה בזמן הקלטה: מוקראת אם ההקלטה הסתיימה בלי שליחה, נזרקת אם נשלחה בקשה חדשה. */
  private deferredReply: { text: string; turnId: string } | null = null;

  // --- עצירה ---
  /** עולה בכל "עצור". תור שהתחיל לפני העצירה — התשובה שלו לא מוקראת. */
  private stopEpoch = 0;
  private readonly stoppedTurns = new Set<string>();
  private readonly turnEpochs = new Map<string, number>();

  // --- מילת הפעלה ---
  private readonly wake: WakeWordSupervisor;
  private reported: { phase: AudioPhase; wake: boolean } = { phase: 'IDLE', wake: false };

  // --- בדיקות קול (מסך ההגדרות) ---
  private meterSeq = 0;
  private voiceTestBusy = false;
  private voiceTestCancelled = false;
  private testRequestId: string | null = null;

  // --- שונות ---
  private errorTimer: unknown = null;
  private readonly toastTimers = new Map<number, unknown>();
  private toastSeq = 0;
  private servicesTimer: unknown = null;
  private screenStageTimer: unknown = null;
  private settingsRetryTimer: unknown = null;
  private sawPhaseEvent = false;
  private readonly resolvedApprovals = new Set<string>();
  private expandedTemporarily = false;
  private missedFetchSeq = 0;
  private missedEventSeq = 0;

  constructor(deps: ControllerDeps) {
    this.deps = deps;
    this.api = deps.api;
    this.store = createStore<UiState>(initialUiState());
    this.speech = new SpeechOutput({
      synthesize: (input) => this.api.voice.synthesize(input),
      cancelSynthesis: (requestId) => this.cancelVoiceRequest(requestId),
      createPlayback: () => deps.audio.createSpeechPlayback(),
      createSystemSpeaker: () => deps.audio.createSystemSpeaker(),
      newRequestId: () => deps.randomId(),
      notify: (kind, text, opts) => {
        this.notify(kind, text, opts);
      },
    });
    this.wake = new WakeWordSupervisor({
      createDetector: (engine) => deps.audio.createWakeWordDetector(engine),
      timers: deps.timers,
      getSettings: () => this.state.settings,
      isBusy: () => this.isWakeBlocked(),
      onDetected: () => this.handleWakeDetection(),
      onView: (view) => {
        if (this.disposed) return;
        this.store.setState({ wake: view });
        // מצב מילת ההפעלה מדווח ל-main בכל שינוי (חיווי מיקרופון במגש), לא רק בשינוי מצב אודיו
        this.reportAudio();
      },
      onFailureNotice: (message) => {
        this.notify('warning', message, { ttlMs: 12_000 });
      },
      ...(deps.onDeviceChange ? { onDeviceChange: deps.onDeviceChange } : {}),
    });
  }

  get state(): UiState {
    return this.store.getState();
  }

  /* ---------------- מחזור חיים ---------------- */

  async init(): Promise<void> {
    if (this.initStarted) return;
    this.initStarted = true;
    // נרשמים לאירועים לפני קריאת ה-snapshot, כדי לא לפספס אירוע שקורה ביניהם
    this.unsubs.push(this.api.assistant.onEvent((event) => this.handleEvent(event)));
    this.unsubs.push(this.api.onCommand((command) => this.handleCommand(command)));

    try {
      const settings = await this.api.settings.get();
      if (this.disposed) return;
      this.applySettings(settings);
    } catch {
      if (this.disposed) return;
      this.store.setState({ initError: he.toasts.initFailed });
      this.notify('error', he.toasts.initFailed, { sticky: true });
      this.scheduleSettingsRetry();
    }

    try {
      const snapshot = await this.api.assistant.snapshot();
      if (!this.disposed) this.applySnapshot(snapshot);
    } catch {
      // ה-snapshot הוא השלמה בלבד; האירועים ימשיכו לעדכן את המצב
    }
    if (this.disposed) return;

    this.store.setState({ ready: true });
    void this.initBattery();
    void this.refreshServices();
    this.servicesTimer = this.deps.timers.setInterval(() => void this.refreshServices(), SERVICES_POLL_MS);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const unsub of this.unsubs.splice(0)) {
      try {
        unsub();
      } catch {
        // ממשיכים לנקות את השאר
      }
    }
    const t = this.deps.timers;
    t.clearTimeout(this.errorTimer);
    t.clearTimeout(this.screenStageTimer);
    t.clearTimeout(this.settingsRetryTimer);
    t.clearTimeout(this.followUpTimer);
    t.clearInterval(this.servicesTimer);
    for (const handle of this.toastTimers.values()) t.clearTimeout(handle);
    this.toastTimers.clear();

    // פסילת כל זרימה שעוד באוויר, ושחרור החומרה
    this.listenSeq++;
    this.speakSeq++;
    this.meterSeq++;
    this.listenPhase = 'idle';
    this.speakActive = false;
    this.safely(() => this.mic?.cancel());
    this.speech.stop();
    if (this.transcribeRequestId) this.cancelVoiceRequest(this.transcribeRequestId);
    this.wake.dispose();
    if (this.reported.phase !== 'IDLE' || this.reported.wake) {
      this.reported = { phase: 'IDLE', wake: false };
      void this.api.voice.reportAudioPhase('IDLE', false).catch(() => undefined);
    }
  }

  /* ---------------- קול: האזנה ---------------- */

  /**
   * לחיצה על המיקרופון / רווח / קיצור מקשים / מילת הפעלה.
   * מדבר -> עוצר הקראה ומתחיל להאזין (barge-in). מאזין -> מסיים ושולח. אחרת -> מתחיל להאזין.
   * גם בזמן בקשת אישור פתוחה מותר (המנוע מבין "כן"/"לא" כתשובה לאישור). מילת הפעלה — לא (ראה isWakeBlocked).
   */
  async toggleListen(source: ListenSource): Promise<void> {
    if (this.disposed) return;
    this.clearError();
    // הפעלה מפורשת מאפסת את מונה האזנות ההמשך האוטומטיות
    if (source !== 'followup') this.autoFollowUps = 0;
    this.cancelFollowUp();
    switch (this.listenPhase) {
      case 'listening':
        this.finishListening();
        return;
      case 'starting':
      case 'finishing':
      case 'transcribing':
        // פעולה קודמת עוד בתהליך — לא פותחים הקלטה כפולה
        return;
      case 'idle':
        break;
    }
    if (this.speakActive) this.stopSpeech();
    await this.startListening(source);
  }

  /** עצירה כללית: הקראה, הקלטה/תמלול, בדיקת מיקרופון, ותור פעיל ב-main. */
  stop(): void {
    if (this.disposed) return;
    this.clearError();
    this.stopEpoch++;
    this.deferredReply = null;
    this.cancelFollowUp();
    this.stopSpeech();
    this.cancelListening();
    this.cancelVoiceTests();
    const { activeTurnId, enginePhase } = this.state;
    if (activeTurnId) this.markTurnStopped(activeTurnId);
    if (activeTurnId || enginePhase === 'THINKING' || enginePhase === 'EXECUTING' || enginePhase === 'AWAITING_APPROVAL') {
      this.api.assistant.cancel(activeTurnId ?? undefined).catch(() => {
        this.notify('error', he.errors.cancelFailed);
      });
    }
  }

  /** האם יש משהו לעצור כרגע (לכפתור העצירה). */
  canStop(state: UiState = this.state): boolean {
    return (
      state.audioPhase !== 'IDLE' ||
      state.micStarting ||
      state.speechActive ||
      state.micTest !== 'off' ||
      state.activeTurnId !== null ||
      state.enginePhase === 'THINKING' ||
      state.enginePhase === 'EXECUTING'
    );
  }

  private async startListening(_source: ListenSource): Promise<void> {
    const settings = this.state.settings;
    if (!settings) {
      this.notify(this.state.initError ? 'error' : 'info', this.state.initError ?? he.toasts.settingsLoading);
      return;
    }
    if (settings.stt.provider === 'none') {
      this.notify('warning', he.toasts.sttNotConfigured);
      return;
    }
    if (this.voiceTestBusy) {
      this.notify('info', he.settings.voice.busy);
      return;
    }
    const seq = ++this.listenSeq;
    this.listenPhase = 'starting';
    this.captureStartedAt = null;
    this.store.setState({ micStarting: true });
    this.syncWakePause();

    if (this.state.micTest === 'meter') {
      await this.stopMicMeter();
      if (seq !== this.listenSeq || this.disposed) return;
      this.notify('info', he.toasts.micTestRunning);
    }

    let mic: MicCapture;
    try {
      mic = this.getMic();
      await mic.start({
        deviceId: settings.voice.micDeviceId || undefined,
        silenceTimeoutMs: settings.voice.silenceTimeoutMs,
        maxUtteranceSec: settings.voice.maxUtteranceSec,
      });
    } catch (err) {
      if (seq !== this.listenSeq || this.disposed) return;
      this.endListen();
      const message = micErrorMessage(err);
      this.notify('error', message, { ttlMs: 14_000 });
      this.flashError(message);
      this.flushDeferredReply();
      return;
    }
    if (seq !== this.listenSeq || this.disposed) {
      // נעצר בזמן שהמיקרופון נפתח — סוגרים אותו מיד, לא משאירים מיקרופון פתוח
      this.safely(() => mic.cancel());
      return;
    }
    const done = mic.done;
    if (!done) {
      this.endListen();
      this.notify('error', he.toasts.captureFailed);
      this.flashError(he.toasts.captureFailed);
      this.flushDeferredReply();
      return;
    }
    this.listenPhase = 'listening';
    this.captureStartedAt = this.mono();
    this.store.setState({ micStarting: false });
    this.setAudioPhase('LISTENING');
    // ההמשך (סיום הקלטה -> תמלול -> שליחה) רץ ברקע; toggleListen חוזר ברגע שהמיקרופון פתוח
    void this.awaitCapture(seq, done);
  }

  private async awaitCapture(seq: number, done: Promise<CaptureResult>): Promise<void> {
    let result: CaptureResult;
    try {
      result = await done;
    } catch {
      if (seq !== this.listenSeq || this.disposed) return;
      this.endListen();
      this.notify('error', he.toasts.captureFailed);
      this.flashError(he.toasts.captureFailed);
      this.flushDeferredReply();
      return;
    }
    if (seq !== this.listenSeq || this.disposed) return;
    let submitted = false;
    try {
      submitted = await this.handleCapture(seq, result);
    } catch {
      // לא אמור לקרות (כל קריאה חיצונית עטופה), אבל לא משאירים את הממשק תקוע במצב ביניים
      if (seq === this.listenSeq && this.listenPhase !== 'idle') this.endListen();
    }
    // ההקלטה הסתיימה בלי בקשה חדשה (שקט / ביטול / הד / תקלה) — מקריאים תשובה שהמתינה לה
    if (!submitted && !this.disposed) this.flushDeferredReply();
  }

  private finishListening(): void {
    // סיום ידני: המיקרופון שולח את מה שהוקלט, ו-done ימשיך את הזרימה לתמלול
    this.listenPhase = 'finishing';
    this.safely(() => this.mic?.stop());
  }

  private cancelListening(): void {
    if (this.listenPhase === 'idle') return;
    const phase = this.listenPhase;
    this.listenSeq++;
    if (phase === 'starting' || phase === 'listening' || phase === 'finishing') {
      this.safely(() => this.mic?.cancel());
    }
    if (phase === 'transcribing' && this.transcribeRequestId) {
      // התמלול בענן נעצר גם הוא (לא רק התוצאה נזרקת)
      this.cancelVoiceRequest(this.transcribeRequestId);
      this.transcribeRequestId = null;
    }
    this.endListen();
  }

  private endListen(): void {
    this.listenPhase = 'idle';
    this.store.setState({ micStarting: false });
    this.setAudioPhase('IDLE');
    this.syncWakePause();
  }

  /** מטפל בהקלטה שהסתיימה. מחזיר true אם נשלחה בקשה ל-JARVIS. */
  private async handleCapture(seq: number, result: CaptureResult): Promise<boolean> {
    if (result.reason === 'cancelled') {
      this.endListen();
      return false;
    }
    if (result.reason === 'error') {
      this.endListen();
      this.notify('error', he.toasts.captureFailed);
      this.flashError(he.toasts.captureFailed);
      return false;
    }
    if (!result.speechDetected || result.wav.byteLength <= 44) {
      this.endListen();
      this.notify('info', he.toasts.noSpeech);
      return false;
    }

    this.listenPhase = 'transcribing';
    this.setAudioPhase('TRANSCRIBING');
    const requestId = this.deps.randomId();
    this.transcribeRequestId = requestId;
    let res: TranscribeResult;
    try {
      res = await this.api.voice.transcribe({
        audio: result.wav,
        mimeType: 'audio/wav',
        durationMs: clampDurationMs(result.durationMs),
        requestId,
      });
    } catch (err) {
      res = { ok: false, code: 'INTERNAL', message_he: ipcErrorMessage(err) };
    }
    if (this.transcribeRequestId === requestId) this.transcribeRequestId = null;
    // נעצר בזמן התמלול — זורקים את התוצאה, לא שולחים כלום
    if (seq !== this.listenSeq || this.disposed) return false;
    this.endListen();

    if (!res.ok) {
      if (res.code === 'EMPTY_TRANSCRIPT') {
        // שקט / רעש בלבד (למשל NoMatch / BabbleTimeout של Azure) — לא תקלה
        this.notify('info', he.toasts.noSpeech);
        return false;
      }
      this.notify('error', he.toasts.transcribeFailed(res.message_he));
      this.flashError(res.message_he);
      return false;
    }
    const text = res.text.trim();
    if (!text) {
      this.notify('info', he.toasts.noSpeech);
      return false;
    }
    if (this.isEcho(text)) {
      this.notify('info', he.toasts.echoIgnored);
      return false;
    }
    return this.submit(text, 'voice');
  }

  /**
   * הגנת הד טקסטואלית. ביטול ההד של Chromium מטפל בהשמעה מהענן (Web Audio), אבל לא בקול המערכת
   * של Windows — ולכן המסנן הטקסטואלי חל רק על קול מערכת, או על הקלטה שהתחילה פחות מ-1.5 שניות
   * אחרי סוף ההקראה (נמדד מפתיחת המיקרופון, לא מהגעת התמלול).
   * כך תשובה אמיתית שחוזרת על מילים מהשאלה ("את פרויקט המעבדה") לא נזרקת כהד.
   */
  private isEcho(text: string): boolean {
    const spoken = this.lastSpokenText;
    const endedAt = this.speechEndedAt;
    if (!spoken || endedAt === null) return false;
    const gap = this.captureStartedAt === null ? Number.POSITIVE_INFINITY : Math.max(0, this.captureStartedAt - endedAt);
    if (!this.lastSpeechUsedSystem && gap >= ECHO_FILTER_MAX_GAP_MS) return false;
    try {
      return this.deps.audio.isLikelyEcho(text, spoken, gap);
    } catch {
      return false;
    }
  }

  /* ---------------- שליחה ---------------- */

  /** שליחת בקשה מוקלדת. מחזיר true אם main קיבל אותה. */
  async submitText(text: string): Promise<boolean> {
    if (this.disposed || this.state.submitting) return false;
    const clean = text.trim();
    if (!clean) return false;
    this.clearError();
    // בקשה מוקלדת היא הפעלה מפורשת
    this.autoFollowUps = 0;
    this.cancelFollowUp();
    // בקשה חדשה עוצרת הקראה של התשובה הקודמת
    this.stopSpeech();
    this.store.setState({ submitting: true });
    try {
      return await this.submit(clean, 'text');
    } finally {
      if (!this.disposed) this.store.setState({ submitting: false });
    }
  }

  private async submit(text: string, source: 'text' | 'voice'): Promise<boolean> {
    const clean = text.trim().slice(0, MAX_TEXT_INPUT);
    if (!clean) return false;
    // בקשה חדשה — תשובה קודמת שחיכתה לסוף ההקלטה כבר לא רלוונטית
    this.deferredReply = null;
    const epoch = this.stopEpoch;
    const activeBefore = this.state.activeTurnId;
    let res: SubmitResult;
    try {
      res = await this.api.assistant.submit({ text: clean, source, clientRequestId: this.deps.randomId() });
    } catch {
      if (this.disposed) return false;
      this.notify('error', he.toasts.submitFailed);
      this.flashError(he.toasts.submitFailed);
      return false;
    }
    if (this.disposed) return false;
    if (!res.ok) {
      const busy = res.code === 'BUSY';
      this.notify(busy ? 'warning' : 'error', res.message_he);
      if (!busy) this.flashError(res.message_he);
      return false;
    }
    this.rememberTurnEpoch(res.turnId, epoch);
    if (this.stopEpoch !== epoch) {
      // המשתמש לחץ "עצור" בזמן שהבקשה נשלחה (התור עוד לא היה ידוע) — מבטלים את התור החדש מיד
      this.markTurnStopped(res.turnId);
      this.api.assistant.cancel(res.turnId).catch(() => undefined);
      return true;
    }
    // "כן"/"לא" בזמן בקשת אישור: main מחזיר את התור שהיה פעיל — זו תשובה לאישור, לא תור חדש
    const sameTurn = activeBefore !== null && res.turnId === activeBefore;
    // בדרך כלל turn-started כבר עדכן את השורה; אם לא — מציגים את מה שנשלח בפועל
    if (!sameTurn && this.state.lastUser?.turnId !== res.turnId) {
      this.store.setState({ lastUser: { text: clean, source, turnId: res.turnId } });
    }
    return true;
  }

  private rememberTurnEpoch(turnId: string, epoch: number): void {
    const prev = this.turnEpochs.get(turnId);
    this.turnEpochs.set(turnId, prev === undefined ? epoch : Math.min(prev, epoch));
    while (this.turnEpochs.size > MAX_REMEMBERED_TURNS) {
      const oldest = this.turnEpochs.keys().next().value as string;
      this.turnEpochs.delete(oldest);
    }
  }

  private markTurnStopped(turnId: string): void {
    boundedAdd(this.stoppedTurns, turnId, MAX_REMEMBERED_TURNS);
  }

  /** תור שנעצר במפורש, או שהתחיל לפני ה"עצור" האחרון — לא מקריאים את התשובה שלו. */
  private isTurnStopped(turnId: string): boolean {
    if (this.stoppedTurns.has(turnId)) return true;
    const epoch = this.turnEpochs.get(turnId);
    return epoch !== undefined && epoch < this.stopEpoch;
  }

  /* ---------------- הקראה ---------------- */

  private async speakResponse(text: string): Promise<void> {
    const s = this.state.settings;
    if (!s || !s.tts.autoSpeak || s.tts.provider === 'none') return;
    // המשתמש כבר מדבר שוב / בודק מיקרופון — לא מדברים מעליו (הטקסט מוצג על המסך)
    if (this.listenPhase !== 'idle' || this.state.micTest !== 'off' || this.voiceTestBusy) return;
    await this.speak(text, { followUp: true });
  }

  private flushDeferredReply(): void {
    const reply = this.deferredReply;
    this.deferredReply = null;
    if (!reply || this.disposed || this.listenPhase !== 'idle') return;
    if (this.isTurnStopped(reply.turnId)) return;
    void this.speakResponse(reply.text);
  }

  private async speak(text: string, opts: { followUp: boolean }): Promise<void> {
    const s = this.state.settings;
    if (!s || this.disposed) return;
    const provider = s.tts.provider;
    if (provider === 'none') return;
    const clean = text.trim();
    if (!clean) return;
    this.stopSpeech();
    this.cancelFollowUp();
    const seq = ++this.speakSeq;
    this.speakActive = true;
    this.speechStarted = false;
    this.speechUsedSystem = false;
    this.store.setState({ speechActive: true });
    this.syncWakePause();

    const outcome = await this.speech.speak({
      text: clean,
      provider,
      rate: s.tts.rate,
      systemVoiceName: s.tts.systemVoiceName || undefined,
      onStarted: (channel) => {
        if (seq === this.speakSeq && !this.disposed) this.markSpeechStarted(clean, channel);
      },
    });
    // נעצר באמצע (barge-in / עצירה / הקראה חדשה) — מי שעצר כבר סגר את המצב
    if (seq !== this.speakSeq || this.disposed) return;
    this.finishSpeaking();
    if (outcome === 'ended' && opts.followUp) this.scheduleFollowUp();
  }

  /** האודיו באמת התחיל להישמע. בין קטעים של אותה תשובה המצב נשאר SPEAKING. */
  private markSpeechStarted(text: string, channel: SpeechChannel): void {
    this.speechStarted = true;
    this.lastSpokenText = text;
    if (channel === 'system') this.speechUsedSystem = true;
    this.store.setState({ speechOutput: channel });
    this.setAudioPhase('SPEAKING');
  }

  /**
   * האזנת המשך: נפתחת WAKE_TAIL_MS אחרי סוף ההקראה (לא באותו רגע — שסוף הקול לא ייכנס להקלטה),
   * ולכל היותר MAX_AUTO_FOLLOW_UPS פעמים ברצף בלי הפעלה מפורשת. לא בזמן בקשת אישור פתוחה.
   */
  private scheduleFollowUp(): void {
    const s = this.state.settings;
    if (!s?.voice.followUpListening || s.stt.provider === 'none') return;
    if (this.autoFollowUps >= MAX_AUTO_FOLLOW_UPS) return;
    this.cancelFollowUp();
    this.followUpTimer = this.deps.timers.setTimeout(() => {
      this.followUpTimer = null;
      const latest = this.state.settings;
      if (this.disposed || !latest?.voice.followUpListening || latest.stt.provider === 'none') return;
      if (this.listenPhase !== 'idle' || this.speakActive || this.state.micTest !== 'off' || this.voiceTestBusy) return;
      if (this.state.pendingApprovals.length > 0) return;
      this.autoFollowUps++;
      void this.startListening('followup');
    }, FOLLOW_UP_DELAY_MS);
  }

  private cancelFollowUp(): void {
    if (this.followUpTimer === null) return;
    this.deps.timers.clearTimeout(this.followUpTimer);
    this.followUpTimer = null;
  }

  /** עוצר הקראה (אם יש), כולל סינתזה שבדרך, ומחזיר את מצב האודיו ל-IDLE. */
  private stopSpeech(): void {
    if (!this.speakActive) return;
    this.speakSeq++;
    this.speech.stop();
    this.finishSpeaking();
  }

  private finishSpeaking(): void {
    this.speakActive = false;
    if (this.speechStarted) {
      // הגנת הד: זוכרים מתי JARVIS סיים לדבר ובאיזה ערוץ, ומשהים את מילת ההפעלה עוד רגע קצר
      this.speechEndedAt = this.mono();
      this.lastSpeechUsedSystem = this.speechUsedSystem;
      this.wake.startTail();
    }
    this.speechStarted = false;
    this.store.setState({ speechOutput: 'none', speechActive: false });
    if (this.state.audioPhase === 'SPEAKING') this.setAudioPhase('IDLE');
    this.syncWakePause();
  }

  /* ---------------- מקורות עוצמה ל-HUD ---------------- */

  /** המקור האמיתי של האודיו כרגע. בקול מערכת אין גישה לאות — ולכן אין waveform. */
  getLevelSource(): LevelSourceInfo {
    const { audioPhase, speechOutput, micTest } = this.state;
    if ((audioPhase === 'LISTENING' || micTest === 'meter' || micTest === 'recording') && this.mic) {
      return { kind: 'mic', source: this.mic };
    }
    const playback = this.speech.playback;
    if (audioPhase === 'SPEAKING' && speechOutput === 'audio' && playback) {
      return { kind: 'playback', source: playback };
    }
    if (audioPhase === 'SPEAKING' && speechOutput === 'system') return { kind: 'system', source: null };
    return { kind: 'none', source: null };
  }

  /* ---------------- מילת הפעלה ---------------- */

  /** "הפעל מחדש" / "נסה שוב" — מאפס גם את מונה הנסיונות האוטומטיים. */
  restartWakeWord(): void {
    void this.wake.restart();
  }

  /** לבדיקות: מחכה שהגדרת מילת ההפעלה שבתור תסתיים. */
  wakeSettled(): Promise<void> {
    return this.wake.whenSettled();
  }

  /**
   * מתי מילת ההפעלה מושהית: בזמן האזנה/תמלול, הקראה, בדיקות קול — וגם כשיש בקשת אישור פתוחה
   * (הפעלה שגויה + "כן" ברקע לא יאשרו פעולה בטעות; לחיצה על המיקרופון עדיין מותרת).
   */
  private isWakeBlocked(): boolean {
    return (
      this.listenPhase !== 'idle' ||
      this.speakActive ||
      this.state.micTest !== 'off' ||
      this.voiceTestBusy ||
      this.state.pendingApprovals.length > 0
    );
  }

  /**
   * זיהוי מילת הפעלה (מהגלאי ב-renderer או מ-main). מתחיל האזנה רק כשאין פעילות קול:
   * בזמן האזנה/תמלול/בדיקה, בזמן ש-JARVIS מדבר ובזנב שאחריו, ובזמן בקשת אישור — מתעלמים.
   */
  private handleWakeDetection(): void {
    if (this.disposed || !this.state.settings?.wakeWord.enabled) return;
    if (this.wake.pausedNow) return;
    void this.toggleListen('wakeword');
  }

  private syncWakePause(): void {
    if (this.disposed) return;
    this.wake.syncPause();
  }

  /* ---------------- בדיקות קול (הגדרות) ---------------- */

  /** מפעיל את מד העוצמה. מחזיר הודעת שגיאה בעברית, או null בהצלחה. */
  async startMicMeter(): Promise<string | null> {
    if (this.disposed) return null;
    if (this.state.micTest === 'meter') return null;
    if (this.listenPhase !== 'idle' || this.speakActive || this.voiceTestBusy) return he.settings.voice.busy;
    const s = this.state.settings;
    if (!s) return he.toasts.settingsLoading;
    const seq = ++this.meterSeq;
    this.store.setState({ micTest: 'meter' });
    this.syncWakePause();
    let mic: MicCapture;
    try {
      mic = this.getMic();
      // שקט ארוך ומשך מרבי — זה מד עוצמה, לא הקלטה לשליחה. שום דבר לא נשלח.
      await mic.start({ deviceId: s.voice.micDeviceId || undefined, silenceTimeoutMs: 60_000, maxUtteranceSec: 60 });
    } catch (err) {
      if (seq === this.meterSeq) {
        this.store.setState({ micTest: 'off' });
        this.syncWakePause();
      }
      return micErrorMessage(err);
    }
    if (seq !== this.meterSeq || this.disposed) {
      this.safely(() => mic.cancel());
      return null;
    }
    const done = mic.done;
    const finished = () => {
      if (seq !== this.meterSeq || this.disposed) return;
      this.store.setState({ micTest: 'off' });
      this.syncWakePause();
    };
    if (done) done.then(finished, finished);
    else finished();
    return null;
  }

  async stopMicMeter(): Promise<void> {
    if (this.state.micTest !== 'meter') return;
    this.meterSeq++;
    const mic = this.mic;
    const done = mic?.done;
    this.safely(() => mic?.cancel());
    this.store.setState({ micTest: 'off' });
    await settleWithin(done, MIC_RELEASE_TIMEOUT_MS, this.deps.timers);
    this.syncWakePause();
  }

  /**
   * עוצר בדיקות קול פעילות (מד עוצמה / הקלטת בדיקת תמלול) — בעצירה כללית ובסגירת ההגדרות.
   * כך הקלטת בדיקה לא ממשיכה ונשלחת לתמלול אחרי שהמשתמש כבר סגר את המסך.
   */
  cancelVoiceTests(): void {
    if (this.state.micTest === 'meter') void this.stopMicMeter();
    if (this.voiceTestBusy) {
      this.voiceTestCancelled = true;
      if (this.state.micTest === 'recording') this.safely(() => this.mic?.cancel());
      if (this.testRequestId) {
        this.cancelVoiceRequest(this.testRequestId);
        this.testRequestId = null;
      }
    }
  }

  /** עוצמת המיקרופון הנוכחית למד (0..1), רק כשהמד פעיל. */
  getMicMeterLevel(): number {
    if (this.state.micTest !== 'meter' || !this.mic) return 0;
    const level = this.mic.getLevel();
    return Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;
  }

  /** בדיקת תמלול: 3 שניות הקלטה -> תמלול -> הצגה. לא נשלח ל-JARVIS. */
  async runTranscriptionTest(): Promise<VoiceTestResult> {
    if (this.disposed) return { ok: false, message: he.errors.unknown };
    const s = this.state.settings;
    if (!s) return { ok: false, message: he.toasts.settingsLoading };
    if (s.stt.provider === 'none') return { ok: false, message: he.toasts.sttNotConfigured };
    if (this.listenPhase !== 'idle' || this.speakActive || this.voiceTestBusy) return { ok: false, message: he.settings.voice.busy };
    if (this.state.micTest === 'meter') await this.stopMicMeter();

    this.voiceTestBusy = true;
    this.voiceTestCancelled = false;
    this.store.setState({ micTest: 'recording' });
    this.syncWakePause();
    try {
      const mic = this.getMic();
      // תקלת מיקרופון ותקלת תמלול הן שתי הודעות שונות — לא "המיקרופון לא זמין" על כל דבר
      try {
        await mic.start({ deviceId: s.voice.micDeviceId || undefined, silenceTimeoutMs: 60_000, maxUtteranceSec: 3 });
      } catch (err) {
        return { ok: false, message: micErrorMessage(err) };
      }
      const done = mic.done;
      if (!done) return { ok: false, message: he.toasts.captureFailed };
      let result: CaptureResult;
      try {
        result = await done;
      } catch {
        return { ok: false, message: he.toasts.captureFailed };
      }
      if (this.disposed) return { ok: false, message: he.errors.unknown };
      if (result.reason === 'cancelled' || this.voiceTestCancelled) return { ok: false, message: he.settings.voice.testCancelled };
      if (result.reason === 'error') return { ok: false, message: he.toasts.captureFailed };
      if (!result.speechDetected || result.wav.byteLength <= 44) {
        return { ok: false, message: he.settings.voice.transcribeNoSpeech };
      }
      this.store.setState({ micTest: 'transcribing' });
      const requestId = this.deps.randomId();
      this.testRequestId = requestId;
      let res: TranscribeResult;
      try {
        res = await this.api.voice.transcribe({
          audio: result.wav,
          mimeType: 'audio/wav',
          durationMs: clampDurationMs(result.durationMs),
          requestId,
        });
      } catch (err) {
        res = { ok: false, code: 'INTERNAL', message_he: ipcErrorMessage(err) };
      } finally {
        if (this.testRequestId === requestId) this.testRequestId = null;
      }
      if (this.voiceTestCancelled) return { ok: false, message: he.settings.voice.testCancelled };
      if (!res.ok) {
        return { ok: false, message: res.code === 'EMPTY_TRANSCRIPT' ? he.settings.voice.transcribeNoSpeech : he.toasts.transcribeFailed(res.message_he) };
      }
      const text = res.text.trim();
      return text ? { ok: true, text } : { ok: false, message: he.settings.voice.transcribeNoSpeech };
    } catch {
      return { ok: false, message: he.errors.unknown };
    } finally {
      this.voiceTestBusy = false;
      if (!this.disposed) {
        this.store.setState({ micTest: 'off' });
        this.syncWakePause();
      }
    }
  }

  /** "השמע דוגמה" עם ספק ההקראה הנוכחי. מחזיר הודעת שגיאה או null. */
  async playSample(): Promise<string | null> {
    const s = this.state.settings;
    if (!s) return he.toasts.settingsLoading;
    if (s.tts.provider === 'none') return he.toasts.ttsOff;
    if (this.listenPhase !== 'idle' || this.voiceTestBusy) return he.settings.voice.busy;
    if (this.state.micTest === 'meter') await this.stopMicMeter();
    await this.speak(he.settings.voice.sampleText(s.profile.userName), { followUp: false });
    return null;
  }

  async listSystemVoices(): Promise<SystemVoiceInfo[]> {
    return this.speech.systemSpeaker.listVoices();
  }

  /* ---------------- אירועים מ-main ---------------- */

  private handleEvent(event: AssistantEvent): void {
    if (this.disposed) return;
    switch (event.type) {
      case 'phase': {
        this.sawPhaseEvent = true;
        const patch: Partial<UiState> = { enginePhase: event.phase, engineLabel: event.label_he ?? null };
        // IDLE = אין תור פעיל (גם אם turn-ended הגיע לפני ה-phase האחרון)
        if (event.phase === 'IDLE') patch.activeTurnId = null;
        else if (event.turnId) patch.activeTurnId = event.turnId;
        this.store.setState(patch);
        break;
      }
      case 'turn-started':
        if (!this.turnEpochs.has(event.turnId)) this.rememberTurnEpoch(event.turnId, this.stopEpoch);
        this.store.setState({
          activeTurnId: event.turnId,
          lastUser: { text: event.text, source: event.source, turnId: event.turnId },
          lastReply: null,
          awaitingReply: true,
        });
        break;
      case 'action':
        this.upsertActions([event.action]);
        break;
      case 'approval-required': {
        const req = event.request;
        if (this.resolvedApprovals.has(req.approvalId)) break;
        this.store.setState((s) => ({
          pendingApprovals: [...s.pendingApprovals.filter((a) => a.approvalId !== req.approvalId), req],
        }));
        // בקשת אישור פתוחה משהה את מילת ההפעלה
        this.syncWakePause();
        this.maybeExpandForApproval();
        break;
      }
      case 'approval-resolved':
        this.resolvedApprovals.add(event.approvalId);
        this.removeApproval(event.approvalId);
        if (event.outcome === 'expired') this.notify('warning', he.toasts.approvalExpired);
        break;
      case 'response': {
        this.store.setState({
          lastReply: { text: event.text, mode: event.mode, turnId: event.turnId },
          awaitingReply: false,
        });
        this.upsertActions(event.actions);
        // תשובה של תור שנעצר (או שהתחיל לפני "עצור") — מוצגת, אבל לא מוקראת
        if (event.speak && !this.isTurnStopped(event.turnId)) {
          if (this.listenPhase !== 'idle') this.deferredReply = { text: event.text, turnId: event.turnId };
          else void this.speakResponse(event.text);
        }
        break;
      }
      case 'error':
        this.notify('error', event.message_he);
        this.flashError(event.message_he);
        if (!event.turnId || event.turnId === this.state.lastUser?.turnId) this.store.setState({ awaitingReply: false });
        break;
      case 'turn-ended': {
        const patch: Partial<UiState> = {};
        if (this.state.activeTurnId === event.turnId) patch.activeTurnId = null;
        if (this.state.lastUser?.turnId === event.turnId) patch.awaitingReply = false;
        this.store.setState(patch);
        break;
      }
      case 'screen-capture':
        this.onScreenStage(event.stage, event.displayLabel);
        break;
      case 'reminder-fired':
        this.notify('info', he.toasts.reminder(event.reminder.text), { sticky: true });
        this.bumpData('reminders');
        break;
      case 'missed-reminders':
        this.missedEventSeq++;
        this.store.setState((s) => ({ missedReminders: mergeById(s.missedReminders, event.reminders) }));
        break;
      case 'data-changed':
        this.bumpData(event.scope);
        if (event.scope === 'settings') void this.reloadSettings();
        // תזכורות השתנו (אושרו / בוטלו / הופעלו) — מסירים מהבאנר את מה שכבר לא "הוחמץ"
        if (event.scope === 'reminders') void this.refreshMissedReminders();
        if (event.scope === 'secrets') {
          void this.refreshServices();
          const s = this.state.settings;
          // מפתח Picovoice חדש -> מפעילים מחדש את הגלאי כדי שיטען אותו
          if (s?.wakeWord.enabled && s.wakeWord.engine === 'porcupine') void this.wake.configure();
        }
        break;
    }
  }

  private handleCommand(command: UiCommand): void {
    if (this.disposed) return;
    switch (command.type) {
      case 'toggle-listen':
        // Porcupine רץ ב-main ומדווח זיהוי כפקודה — מטפלים בו כמו בכל זיהוי של מילת הפעלה
        if (command.source === 'wakeword') this.handleWakeDetection();
        else void this.toggleListen(command.source);
        break;
      case 'stop':
        this.stop();
        break;
      case 'open-settings':
        this.openSettings();
        break;
      case 'view-mode':
        void this.setViewMode(command.mode);
        break;
    }
  }

  private applySnapshot(snapshot: AssistantSnapshot): void {
    const s = this.state;
    const patch: Partial<UiState> = {};
    if (!this.sawPhaseEvent) {
      patch.enginePhase = snapshot.phase;
      patch.activeTurnId = snapshot.activeTurnId;
    }
    const known = new Set(s.pendingApprovals.map((a) => a.approvalId));
    const fresh = snapshot.pendingApprovals.filter((a) => !known.has(a.approvalId) && !this.resolvedApprovals.has(a.approvalId));
    patch.pendingApprovals = [...s.pendingApprovals, ...fresh];
    patch.missedReminders = mergeById(s.missedReminders, snapshot.missedReminders);
    this.store.setState(patch);
    if (patch.pendingApprovals.length > 0) {
      this.syncWakePause();
      this.maybeExpandForApproval();
    }
  }

  /** רשימת התזכורות שהוחמצו מ-main מחדש (אחרי data-changed 'reminders'). */
  private async refreshMissedReminders(): Promise<void> {
    const seq = ++this.missedFetchSeq;
    const eventsBefore = this.missedEventSeq;
    let snapshot: AssistantSnapshot;
    try {
      snapshot = await this.api.assistant.snapshot();
    } catch {
      return;
    }
    if (this.disposed || seq !== this.missedFetchSeq) return;
    const fresh = Array.isArray(snapshot.missedReminders) ? snapshot.missedReminders : [];
    // אם הגיע אירוע missed-reminders בזמן הבקשה — לא מאבדים אותו (הרענון הבא ינקה)
    this.store.setState((s) => ({ missedReminders: this.missedEventSeq === eventsBefore ? fresh : mergeById(fresh, s.missedReminders) }));
  }

  private upsertActions(incoming: readonly ActionRecord[]): void {
    if (incoming.length === 0) return;
    this.store.setState((s) => {
      const list = [...s.actions];
      for (const action of incoming) {
        const idx = list.findIndex((a) => a.id === action.id);
        if (idx >= 0) list[idx] = action;
        else list.push(action);
      }
      return { actions: list.slice(-MAX_ACTIONS) };
    });
  }

  private removeApproval(approvalId: string): void {
    this.store.setState((s) => ({ pendingApprovals: s.pendingApprovals.filter((a) => a.approvalId !== approvalId) }));
    this.syncWakePause();
    this.maybeRestoreCompact();
  }

  private onScreenStage(stage: ScreenCaptureStage, displayLabel?: string): void {
    this.deps.timers.clearTimeout(this.screenStageTimer);
    this.screenStageTimer = null;
    this.store.setState({ screenCapture: displayLabel ? { stage, displayLabel } : { stage } });
    if (stage === 'done' || stage === 'discarded' || stage === 'failed') {
      this.screenStageTimer = this.deps.timers.setTimeout(() => {
        this.screenStageTimer = null;
        this.store.setState({ screenCapture: null });
      }, SCREEN_STAGE_LINGER_MS);
    }
  }

  private bumpData(scope: DataScope): void {
    this.store.setState((s) => ({ dataVersion: { ...s.dataVersion, [scope]: s.dataVersion[scope] + 1 } }));
  }

  /* ---------------- הגדרות וחלון ---------------- */

  private applySettings(next: Settings): void {
    const prev = this.state.settings;
    const patch: Partial<UiState> = { settings: next, initError: null };
    if (!prev && this.state.initError) {
      // ההגדרות נטענו אחרי כישלון — מסירים את הודעת השגיאה הקבועה
      for (const t of this.state.toasts) if (t.text === he.toasts.initFailed) this.dismissToast(t.id);
    }
    if (!prev) patch.viewMode = next.ui.mode;
    else if (prev.ui.mode !== next.ui.mode && !this.expandedTemporarily) patch.viewMode = next.ui.mode;
    this.store.setState(patch);
    if (!prev || wakeSettingsChanged(prev, next)) void this.wake.configure();
  }

  private async reloadSettings(): Promise<boolean> {
    try {
      const settings = await this.api.settings.get();
      if (!this.disposed) this.applySettings(settings);
      return true;
    } catch {
      // נשארים עם ההגדרות הקודמות
      return false;
    }
  }

  /** טעינת ההגדרות נכשלה בהפעלה — מנסים שוב ברקע עד שמצליח (main אולי עוד עולה). */
  private scheduleSettingsRetry(): void {
    this.deps.timers.clearTimeout(this.settingsRetryTimer);
    this.settingsRetryTimer = this.deps.timers.setTimeout(() => {
      this.settingsRetryTimer = null;
      void this.reloadSettings().then((ok) => {
        if (this.disposed) return;
        if (!ok && !this.state.settings) this.scheduleSettingsRetry();
      });
    }, SETTINGS_RETRY_MS);
  }

  /** עדכון הגדרות דרך main (שמאמת מול הסכמה). מחזיר את ה-Result להצגת שגיאה במקום. */
  async updateSettings(patch: SettingsPatch): Promise<Result<{ settings: Settings }>> {
    let res: Result<{ settings: Settings }>;
    try {
      res = await this.api.settings.update(patch);
    } catch {
      return { ok: false, code: 'INVALID_PARAMS', message_he: he.settings.saveFailed };
    }
    if (res.ok && !this.disposed) this.applySettings(res.settings);
    return res;
  }

  async setViewMode(mode: ViewMode, opts: { persist?: boolean } = {}): Promise<void> {
    const persist = opts.persist ?? true;
    if (persist) this.expandedTemporarily = false;
    const prev = this.state.viewMode;
    this.store.setState(mode === 'compact' ? { viewMode: mode, settingsOpen: false } : { viewMode: mode });
    try {
      await this.api.window.setMode(mode);
    } catch {
      this.store.setState({ viewMode: prev });
      this.notify('error', he.toasts.viewModeFailed);
      return;
    }
    if (persist && this.state.settings && this.state.settings.ui.mode !== mode) {
      const res = await this.updateSettings({ ui: { mode } });
      if (!res.ok) this.notify('warning', res.message_he);
    }
  }

  async setAlwaysOnTop(value: boolean): Promise<Result<{ settings: Settings }>> {
    try {
      await this.api.window.setAlwaysOnTop(value);
    } catch {
      this.notify('error', he.toasts.alwaysOnTopFailed);
      return { ok: false, code: 'INTERNAL', message_he: he.toasts.alwaysOnTopFailed };
    }
    return this.updateSettings({ ui: { alwaysOnTop: value } });
  }

  minimizeWindow(): void {
    this.api.window.minimize().catch(() => this.notify('error', he.toasts.windowActionFailed));
  }

  closeWindow(): void {
    // main מחליט לפי ההגדרות: הסתרה למגש או יציאה
    this.api.window.close().catch(() => this.notify('error', he.toasts.windowActionFailed));
  }

  openSettings(section?: SettingsSectionId): void {
    // מהתצוגה הקומפקטית: מרחיבים זמנית (בלי לשמור), ובסגירה חוזרים לקומפקטי
    if (this.state.viewMode === 'compact') {
      this.expandedTemporarily = true;
      void this.setViewMode('full', { persist: false });
    }
    this.store.setState(section ? { settingsOpen: true, settingsSection: section } : { settingsOpen: true });
  }

  closeSettings(): void {
    this.store.setState({ settingsOpen: false });
    this.cancelVoiceTests();
    this.maybeRestoreCompact();
  }

  setSettingsSection(section: SettingsSectionId): void {
    this.store.setState({ settingsSection: section });
  }

  /** בקשת אישור בתצוגה קומפקטית: מרחיבים זמנית (בלי לשמור), כדי שהדיאלוג יהיה קריא. */
  private maybeExpandForApproval(): void {
    if (this.state.viewMode !== 'compact' || this.state.pendingApprovals.length === 0) return;
    this.expandedTemporarily = true;
    void this.setViewMode('full', { persist: false });
  }

  private maybeRestoreCompact(): void {
    if (!this.expandedTemporarily) return;
    if (this.state.pendingApprovals.length > 0 || this.state.settingsOpen) return;
    this.expandedTemporarily = false;
    if (this.state.settings?.ui.mode === 'compact') void this.setViewMode('compact', { persist: false });
  }

  /* ---------------- אישורים, מסך, תזכורות ---------------- */

  async decideApproval(
    approvalId: string,
    approved: boolean,
    displayId?: string,
  ): Promise<Result<{ outcome: 'approved' | 'rejected' }>> {
    let res: Result<{ outcome: 'approved' | 'rejected' }>;
    try {
      res = await this.api.assistant.approve(displayId ? { approvalId, approved, displayId } : { approvalId, approved });
    } catch {
      return { ok: false, code: 'INTERNAL', message_he: he.approval.failed };
    }
    if (res.ok || res.code === 'APPROVAL_EXPIRED') {
      this.resolvedApprovals.add(approvalId);
      this.removeApproval(approvalId);
    }
    return res;
  }

  async listDisplays(): Promise<DisplayInfo[] | null> {
    try {
      return await this.api.system.listDisplays();
    } catch {
      this.notify('error', he.bottom.displaysFailed);
      return null;
    }
  }

  async analyzeScreen(opts: { displayId?: string; question?: string }): Promise<boolean> {
    if (this.disposed || this.state.screenRequestPending) return false;
    this.clearError();
    this.stopSpeech();
    this.deferredReply = null;
    const question = opts.question?.trim().slice(0, 500);
    this.store.setState({ screenRequestPending: true });
    try {
      const res = await this.api.assistant.analyzeScreen({
        clientRequestId: this.deps.randomId(),
        ...(question ? { question } : {}),
        ...(opts.displayId ? { displayId: opts.displayId } : {}),
      });
      if (!res.ok) {
        this.notify('error', res.message_he);
        return false;
      }
      return true;
    } catch {
      this.notify('error', he.toasts.screenFailed);
      return false;
    } finally {
      if (!this.disposed) this.store.setState({ screenRequestPending: false });
    }
  }

  async acknowledgeMissedReminders(): Promise<boolean> {
    const ids = this.state.missedReminders.map((r) => r.id).slice(0, 200);
    if (ids.length === 0) return true;
    try {
      await this.api.data.acknowledgeReminders(ids);
    } catch {
      this.notify('error', he.missed.acknowledgeFailed);
      return false;
    }
    const done = new Set(ids);
    this.store.setState((s) => ({ missedReminders: s.missedReminders.filter((r) => !done.has(r.id)) }));
    this.bumpData('reminders');
    return true;
  }

  /* ---------------- מצב שירותים וסוללה ---------------- */

  async refreshServices(): Promise<void> {
    try {
      const status = await this.api.system.status();
      if (!this.disposed) this.reportServices(status.services);
    } catch {
      // הצ'יפ יישאר עם המצב האחרון הידוע
    }
  }

  /** עדכון מצב השירותים (גם מהלוח "מערכת" שמושך כל 3 שניות). */
  reportServices(services: ServiceStatus[]): void {
    this.store.setState({ services });
  }

  private async initBattery(): Promise<void> {
    const get = this.deps.getBattery;
    if (!get) return;
    let battery: BatteryLike | undefined;
    try {
      battery = await get();
    } catch {
      return;
    }
    if (!battery || this.disposed) return;
    const b = battery;
    const report = () => {
      const level = Number.isFinite(b.level) ? Math.min(1, Math.max(0, b.level)) : 0;
      this.api.system
        .reportBattery({
          level,
          charging: Boolean(b.charging),
          chargingTime: finiteOrNull(b.chargingTime),
          dischargingTime: finiteOrNull(b.dischargingTime),
        })
        .catch(() => undefined);
    };
    report();
    b.addEventListener('levelchange', report);
    b.addEventListener('chargingchange', report);
    this.unsubs.push(() => {
      b.removeEventListener('levelchange', report);
      b.removeEventListener('chargingchange', report);
    });
  }

  /* ---------------- הודעות ושגיאות ---------------- */

  notify(kind: ToastKind, text: string, opts: { sticky?: boolean; ttlMs?: number } = {}): number {
    const id = ++this.toastSeq;
    const sticky = opts.sticky ?? false;
    const t = this.deps.timers;
    this.store.setState((s) => {
      // אותה הודעה שוב -> מחליפים את הישנה במקום לערום כפילויות
      const kept = s.toasts.filter((x) => x.text !== text);
      const list = [...kept, { id, kind, text, sticky }];
      const overflow = list.length - MAX_TOASTS;
      const dropped = overflow > 0 ? list.slice(0, overflow) : [];
      for (const d of [...s.toasts.filter((x) => x.text === text), ...dropped]) {
        t.clearTimeout(this.toastTimers.get(d.id));
        this.toastTimers.delete(d.id);
      }
      return { toasts: overflow > 0 ? list.slice(overflow) : list };
    });
    if (!sticky) {
      const ttl = opts.ttlMs ?? (kind === 'error' ? TOAST_ERROR_MS : TOAST_MS);
      this.toastTimers.set(
        id,
        t.setTimeout(() => this.dismissToast(id), ttl),
      );
    }
    return id;
  }

  dismissToast(id: number): void {
    this.deps.timers.clearTimeout(this.toastTimers.get(id));
    this.toastTimers.delete(id);
    this.store.setState((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }));
  }

  private flashError(text: string): void {
    const t = this.deps.timers;
    t.clearTimeout(this.errorTimer);
    this.store.setState({ errorActive: true, lastErrorText: text });
    this.errorTimer = t.setTimeout(() => {
      this.errorTimer = null;
      this.store.setState({ errorActive: false });
    }, ERROR_FLASH_MS);
  }

  private clearError(): void {
    if (!this.state.errorActive) return;
    this.deps.timers.clearTimeout(this.errorTimer);
    this.errorTimer = null;
    this.store.setState({ errorActive: false });
  }

  /* ---------------- עזרים ---------------- */

  private mono(): number {
    return (this.deps.monotonicNow ?? this.deps.now)();
  }

  private setAudioPhase(phase: AudioPhase): void {
    if (this.state.audioPhase === phase) return;
    this.store.setState({ audioPhase: phase });
    this.reportAudio();
    this.syncWakePause();
  }

  /** מדווח ל-main את מצב האודיו ואת מצב מילת ההפעלה (חיווי במגש) — רק כשמשהו השתנה. */
  private reportAudio(): void {
    if (this.disposed) return;
    const phase = this.state.audioPhase;
    const wake = this.wake.listening;
    if (this.reported.phase === phase && this.reported.wake === wake) return;
    this.reported = { phase, wake };
    this.api.voice.reportAudioPhase(phase, wake).catch(() => undefined);
  }

  private cancelVoiceRequest(requestId: string): void {
    try {
      this.api.voice.cancel(requestId).catch(() => undefined);
    } catch {
      // ביטול הוא ניסיון בלבד
    }
  }

  private getMic(): MicCapture {
    if (!this.mic) this.mic = this.deps.audio.createMicCapture();
    return this.mic;
  }

  private safely(fn: () => void): void {
    try {
      fn();
    } catch {
      // ניקוי משאבים לא אמור להפיל את הזרימה
    }
  }
}

/* ------------------------------------------------------------------ */
/* חיבור ל-React                                                        */
/* ------------------------------------------------------------------ */

export const ControllerContext = createContext<JarvisController | null>(null);

/** הבקר מתוך ה-context. */
export function useController(): JarvisController {
  const controller = useContext(ControllerContext);
  if (!controller) throw new Error('ControllerContext חסר — יש לעטוף את האפליקציה ב-ControllerContext.Provider');
  return controller;
}

/** פרוסה מה-state של הבקר. ה-selector צריך להחזיר ערך יציב (שדה קיים או פרימיטיבי). */
export function useUiState<S>(selector: (state: UiState) => S): S {
  const controller = useController();
  return useStore(controller.store, selector);
}

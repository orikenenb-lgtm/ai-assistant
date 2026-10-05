/**
 * הבקר של ה-renderer: מחזיק את זרימת הקול (מיקרופון ← תמלול ← שליחה ← הקראה),
 * מאזין לאירועים מ-main ולפקודות (קיצור מקשים / מגש), ומנהל את ה-store שהממשק קורא ממנו.
 *
 * עקרונות:
 * - מצב התצוגה משקף רק פעילות אמיתית: LISTENING רק אחרי שהמיקרופון נפתח בפועל,
 *   SPEAKING רק כשההשמעה התחילה בפועל.
 * - כל פעולה אסינכרונית מסומנת במספר רצף (seq). תוצאה שמגיעה אחרי עצירה/החלפה — נזרקת.
 * - אין תלות ישירה במימוש שכבת האודיו: הכול מוזרק (כך הבדיקות רצות עם MOCK).
 */
import { createContext, useContext } from 'react';
import type { JarvisApi, Result, SubmitResult, SynthesizeResult, TranscribeResult } from '../../shared/api-types';
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
import type {
  CaptureResult,
  EchoCheck,
  LevelSource,
  MicCapture,
  SpeechPlayback,
  SystemSpeaker,
  SystemVoiceInfo,
  WakeWordDetector,
} from '../audio';
import { he } from '../i18n/he';
import { errorText, micErrorMessage } from './messages';
import { splitForSynthesis } from './speech-text';
import { createStore, useStore, type Store } from './store';

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
  timers: TimerApi;
  /** UUID לכל שליחה (clientRequestId). */
  randomId: () => string;
  /** navigator.getBattery אם קיים. */
  getBattery?: () => Promise<BatteryLike> | undefined;
}

export type ListenSource = 'ui' | 'keyboard' | 'hotkey' | 'tray' | 'wakeword' | 'followup';
export type WakeStatus = 'off' | 'loading' | 'listening' | 'paused' | 'stopped' | 'error';
export type SpeechOutput = 'none' | 'audio' | 'system';
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

export interface WakeView {
  status: WakeStatus;
  /** הודעה מלאה בעברית כשהסטטוס error. */
  error: string | null;
  engine: 'openwakeword' | 'porcupine' | null;
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
  speechOutput: SpeechOutput;
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

/** כמה זמן מילת ההפעלה נשארת מושהית אחרי ש-JARVIS סיים לדבר (מניעת הפעלה עצמית מהד). */
export const WAKE_TAIL_MS = 600;
/** כמה זמן מצב השגיאה מוצג אחרי תקלה מקומית. */
export const ERROR_FLASH_MS = 6000;
export const TOAST_MS = 5000;
export const TOAST_ERROR_MS = 9000;
export const MAX_TOASTS = 4;
export const MAX_ACTIONS = 30;
export const SERVICES_POLL_MS = 30_000;
export const WAKE_POLL_MS = 1000;
const SCREEN_STAGE_LINGER_MS = 3500;
const MIC_RELEASE_TIMEOUT_MS = 1500;

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
type SpeakOutcome = 'ended' | 'stopped' | 'failed';

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

  // --- הקראה ---
  private playback: SpeechPlayback | null = null;
  private systemSpeaker: SystemSpeaker | null = null;
  private speakSeq = 0;
  private speakActive = false;
  private speechStarted = false;
  private lastSpokenText: string | null = null;
  private speechEndedAt: number | null = null;

  // --- מילת הפעלה ---
  private wake: WakeWordDetector | null = null;
  private wakeSeq = 0;
  private wakePausedByUs = false;
  private wakeTailUntil = 0;
  private wakeTailTimer: unknown = null;
  private wakePollTimer: unknown = null;
  private wakeErrorNotified: string | null = null;

  // --- בדיקות קול (מסך ההגדרות) ---
  private meterSeq = 0;
  private voiceTestBusy = false;

  // --- שונות ---
  private errorTimer: unknown = null;
  private readonly toastTimers = new Map<number, unknown>();
  private toastSeq = 0;
  private servicesTimer: unknown = null;
  private screenStageTimer: unknown = null;
  private sawPhaseEvent = false;
  private readonly resolvedApprovals = new Set<string>();
  private expandedForApproval = false;

  constructor(deps: ControllerDeps) {
    this.deps = deps;
    this.api = deps.api;
    this.store = createStore<UiState>(initialUiState());
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
    t.clearTimeout(this.wakeTailTimer);
    t.clearTimeout(this.screenStageTimer);
    t.clearInterval(this.wakePollTimer);
    t.clearInterval(this.servicesTimer);
    for (const handle of this.toastTimers.values()) t.clearTimeout(handle);
    this.toastTimers.clear();

    // פסילת כל זרימה שעוד באוויר, ושחרור החומרה
    this.listenSeq++;
    this.speakSeq++;
    this.meterSeq++;
    this.wakeSeq++;
    this.listenPhase = 'idle';
    this.speakActive = false;
    this.safely(() => this.mic?.cancel());
    this.safely(() => this.playback?.stop());
    this.safely(() => this.systemSpeaker?.stop());
    const detector = this.wake;
    this.wake = null;
    if (detector) void detector.stop().catch(() => undefined);
    if (this.state.audioPhase !== 'IDLE') void this.api.voice.reportAudioPhase('IDLE').catch(() => undefined);
  }

  /* ---------------- קול: האזנה ---------------- */

  /**
   * לחיצה על המיקרופון / רווח / קיצור מקשים / מילת הפעלה.
   * מדבר -> עוצר הקראה ומתחיל להאזין (barge-in). מאזין -> מסיים ושולח. אחרת -> מתחיל להאזין.
   */
  async toggleListen(source: ListenSource): Promise<void> {
    if (this.disposed) return;
    this.clearError();
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
    this.stopSpeech();
    this.cancelListening();
    if (this.state.micTest === 'meter') void this.stopMicMeter();
    const { activeTurnId, enginePhase } = this.state;
    if (activeTurnId || enginePhase === 'THINKING' || enginePhase === 'EXECUTING' || enginePhase === 'AWAITING_APPROVAL') {
      this.api.assistant.cancel(activeTurnId ?? undefined).catch(() => {
        this.notify('error', he.errors.ipc('cancel'));
      });
    }
  }

  /** האם יש משהו לעצור כרגע (לכפתור העצירה). */
  canStop(state: UiState = this.state): boolean {
    return (
      state.audioPhase !== 'IDLE' ||
      state.micStarting ||
      state.speechOutput !== 'none' ||
      state.activeTurnId !== null ||
      state.enginePhase === 'THINKING' ||
      state.enginePhase === 'EXECUTING'
    );
  }

  private async startListening(_source: ListenSource): Promise<void> {
    const settings = this.state.settings;
    if (!settings) {
      this.notify('info', he.toasts.settingsLoading);
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
      return;
    }
    this.listenPhase = 'listening';
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
      return;
    }
    if (seq !== this.listenSeq || this.disposed) return;
    try {
      await this.handleCapture(seq, result);
    } catch {
      // לא אמור לקרות (כל קריאה חיצונית עטופה), אבל לא משאירים את הממשק תקוע במצב ביניים
      if (seq === this.listenSeq && this.listenPhase !== 'idle') this.endListen();
    }
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
    this.endListen();
  }

  private endListen(): void {
    this.listenPhase = 'idle';
    this.store.setState({ micStarting: false });
    this.setAudioPhase('IDLE');
    this.syncWakePause();
  }

  private async handleCapture(seq: number, result: CaptureResult): Promise<void> {
    if (result.reason === 'cancelled') {
      this.endListen();
      return;
    }
    if (result.reason === 'error') {
      this.endListen();
      this.notify('error', he.toasts.captureFailed);
      this.flashError(he.toasts.captureFailed);
      return;
    }
    if (!result.speechDetected || result.wav.byteLength <= 44) {
      this.endListen();
      this.notify('info', he.toasts.noSpeech);
      return;
    }

    this.listenPhase = 'transcribing';
    this.setAudioPhase('TRANSCRIBING');
    let res: TranscribeResult;
    try {
      res = await this.api.voice.transcribe({
        audio: result.wav,
        mimeType: 'audio/wav',
        durationMs: clampDurationMs(result.durationMs),
      });
    } catch (err) {
      res = { ok: false, code: 'INTERNAL', message_he: he.errors.ipc(errorText(err)) };
    }
    // נעצר בזמן התמלול — זורקים את התוצאה, לא שולחים כלום
    if (seq !== this.listenSeq || this.disposed) return;
    this.endListen();

    if (!res.ok) {
      this.notify('error', he.toasts.transcribeFailed(res.message_he));
      this.flashError(res.message_he);
      return;
    }
    const text = res.text.trim();
    if (!text) {
      this.notify('info', he.toasts.emptyTranscript);
      return;
    }
    const msSince = this.speechEndedAt === null ? Number.POSITIVE_INFINITY : Math.max(0, this.deps.now() - this.speechEndedAt);
    let echo: boolean;
    try {
      echo = this.deps.audio.isLikelyEcho(text, this.lastSpokenText, msSince);
    } catch {
      echo = false;
    }
    if (echo) {
      this.notify('info', he.toasts.echoIgnored);
      return;
    }
    await this.submit(text, 'voice');
  }

  /* ---------------- שליחה ---------------- */

  /** שליחת בקשה מוקלדת. מחזיר true אם main קיבל אותה. */
  async submitText(text: string): Promise<boolean> {
    if (this.disposed || this.state.submitting) return false;
    const clean = text.trim();
    if (!clean) return false;
    this.clearError();
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
    // בדרך כלל turn-started כבר עדכן את השורה; אם לא — מציגים את מה שנשלח בפועל
    if (this.state.lastUser?.turnId !== res.turnId) {
      this.store.setState({ lastUser: { text: clean, source, turnId: res.turnId } });
    }
    return true;
  }

  /* ---------------- הקראה ---------------- */

  private async speakResponse(text: string): Promise<void> {
    const s = this.state.settings;
    if (!s || !s.tts.autoSpeak || s.tts.provider === 'none') return;
    // המשתמש כבר מדבר שוב / בודק מיקרופון — לא מדברים מעליו (הטקסט מוצג על המסך)
    if (this.listenPhase !== 'idle' || this.state.micTest !== 'off' || this.voiceTestBusy) return;
    await this.speak(text, { followUp: true });
  }

  private async speak(text: string, opts: { followUp: boolean }): Promise<void> {
    const s = this.state.settings;
    if (!s || s.tts.provider === 'none' || this.disposed) return;
    const clean = text.trim();
    if (!clean) return;
    this.stopSpeech();
    const seq = ++this.speakSeq;
    this.speakActive = true;
    this.speechStarted = false;
    this.syncWakePause();

    let outcome: SpeakOutcome;
    try {
      outcome = s.tts.provider === 'system' ? await this.speakWithSystem(clean, seq, s) : await this.speakWithCloud(clean, seq, s);
    } catch {
      outcome = 'failed';
      if (seq === this.speakSeq) this.notify('error', he.toasts.speechFailed);
    }
    // נעצר באמצע (barge-in / עצירה / הקראה חדשה) — מי שעצר כבר סגר את המצב
    if (seq !== this.speakSeq || this.disposed) return;
    this.finishSpeaking();

    const latest = this.state.settings;
    if (outcome === 'ended' && opts.followUp && latest?.voice.followUpListening && this.listenPhase === 'idle') {
      await this.startListening('followup');
    }
  }

  private markSpeechStarted(text: string, output: 'audio' | 'system'): void {
    this.speechStarted = true;
    this.lastSpokenText = text;
    this.store.setState({ speechOutput: output });
    this.setAudioPhase('SPEAKING');
  }

  private async speakWithSystem(text: string, seq: number, s: Settings): Promise<SpeakOutcome> {
    const speaker = this.getSystemSpeaker();
    this.markSpeechStarted(text, 'system');
    const result = await speaker.speak(text, { voiceName: s.tts.systemVoiceName || undefined, rate: s.tts.rate });
    if (seq !== this.speakSeq) return 'stopped';
    if (result === 'no-voice') {
      this.notify('warning', he.toasts.noSystemVoice, { ttlMs: 14_000 });
      return 'failed';
    }
    return result;
  }

  private async speakWithCloud(text: string, seq: number, s: Settings): Promise<SpeakOutcome> {
    const chunks = splitForSynthesis(text);
    if (chunks.length === 0) return 'ended';
    const synth = (chunk: string): Promise<SynthesizeResult> =>
      this.api.voice
        .synthesize({ text: chunk })
        .catch((err: unknown): SynthesizeResult => ({ ok: false, code: 'INTERNAL', message_he: he.errors.ipc(errorText(err)) }));

    let pending = synth(chunks[0] as string);
    for (let i = 0; i < chunks.length; i++) {
      const res = await pending;
      if (seq !== this.speakSeq) return 'stopped';
      const rest = chunks.slice(i).join(' ');
      if (!res.ok) {
        // נפילה לקול המערכת — עם הודעה, כדי שלא ייראה כאילו הקול בענן עבד
        this.notify('warning', he.toasts.synthFallback(res.message_he));
        return this.speakWithSystem(rest, seq, s);
      }
      // טעינה מוקדמת של הקטע הבא בזמן שהנוכחי מושמע
      const next = chunks[i + 1];
      if (next !== undefined) pending = synth(next);

      let played: 'ended' | 'stopped';
      try {
        const playback = this.getPlayback();
        this.markSpeechStarted(text, 'audio');
        played = await playback.play(res.audio, res.mimeType);
      } catch {
        if (seq !== this.speakSeq) return 'stopped';
        this.notify('warning', he.toasts.playbackFallback);
        return this.speakWithSystem(rest, seq, s);
      }
      if (seq !== this.speakSeq || played === 'stopped') return 'stopped';
    }
    return 'ended';
  }

  /** עוצר הקראה (אם יש) ומחזיר את מצב האודיו ל-IDLE. */
  private stopSpeech(): void {
    if (!this.speakActive) return;
    this.speakSeq++;
    this.safely(() => this.playback?.stop());
    this.safely(() => this.systemSpeaker?.stop());
    this.finishSpeaking();
  }

  private finishSpeaking(): void {
    this.speakActive = false;
    if (this.speechStarted) {
      // הגנת הד: זוכרים מתי JARVIS סיים לדבר, ומשהים את מילת ההפעלה עוד רגע קצר
      this.speechEndedAt = this.deps.now();
      this.wakeTailUntil = this.speechEndedAt + WAKE_TAIL_MS;
      this.scheduleWakeTail();
    }
    this.speechStarted = false;
    this.store.setState({ speechOutput: 'none' });
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
    if (audioPhase === 'SPEAKING' && speechOutput === 'audio' && this.playback) {
      return { kind: 'playback', source: this.playback };
    }
    if (audioPhase === 'SPEAKING' && speechOutput === 'system') return { kind: 'system', source: null };
    return { kind: 'none', source: null };
  }

  /* ---------------- מילת הפעלה ---------------- */

  restartWakeWord(): void {
    void this.configureWakeWord();
  }

  private async configureWakeWord(): Promise<void> {
    const seq = ++this.wakeSeq;
    const old = this.wake;
    this.wake = null;
    this.wakePausedByUs = false;
    if (old) {
      try {
        await old.stop();
      } catch {
        // עצירה של גלאי ישן שנכשל — לא חוסם הפעלה מחדש
      }
    }
    if (seq !== this.wakeSeq || this.disposed) return;
    const s = this.state.settings;
    if (!s || !s.wakeWord.enabled) {
      this.deps.timers.clearInterval(this.wakePollTimer);
      this.wakePollTimer = null;
      this.wakeErrorNotified = null;
      this.setWake({ status: 'off', error: null, engine: null });
      return;
    }
    const engine = s.wakeWord.engine;
    this.setWake({ status: 'loading', error: null, engine });

    let detector: WakeWordDetector;
    try {
      detector = this.deps.audio.createWakeWordDetector(engine);
    } catch (err) {
      this.failWake(errorText(err), engine);
      return;
    }
    this.wake = detector;
    try {
      await detector.start({
        deviceId: s.voice.micDeviceId || undefined,
        sensitivity: s.wakeWord.sensitivity,
        onDetected: () => this.onWakeDetected(detector),
      });
    } catch (err) {
      if (seq !== this.wakeSeq || this.disposed) return;
      this.wake = null;
      this.failWake(detector.lastError || errorText(err), engine);
      void detector.stop().catch(() => undefined);
      return;
    }
    if (seq !== this.wakeSeq || this.disposed) {
      void detector.stop().catch(() => undefined);
      return;
    }
    this.wakeErrorNotified = null;
    this.syncWakePause();
    if (this.wakePollTimer === null) {
      this.wakePollTimer = this.deps.timers.setInterval(() => this.syncWakeView(), WAKE_POLL_MS);
    }
  }

  private failWake(reason: string, engine: 'openwakeword' | 'porcupine'): void {
    const message = he.wake.unavailable(reason || he.wake.unknownReason);
    this.setWake({ status: 'error', error: message, engine });
    if (this.wakeErrorNotified !== message) {
      this.wakeErrorNotified = message;
      this.notify('warning', message, { ttlMs: 12_000 });
    }
  }

  private onWakeDetected(detector: WakeWordDetector): void {
    if (detector !== this.wake) return;
    this.handleWakeDetection();
  }

  /**
   * זיהוי מילת הפעלה (מהגלאי ב-renderer או מ-main). מתחיל האזנה רק כשאין פעילות קול:
   * בזמן האזנה/תמלול/בדיקה, בזמן ש-JARVIS מדבר ובזנב שאחריו — מתעלמים (מונע הפעלה עצמית).
   */
  private handleWakeDetection(): void {
    if (this.disposed || !this.state.settings?.wakeWord.enabled) return;
    if (this.shouldPauseWake()) return;
    void this.toggleListen('wakeword');
  }

  private shouldPauseWake(): boolean {
    return (
      this.listenPhase !== 'idle' ||
      this.speakActive ||
      this.state.micTest !== 'off' ||
      this.voiceTestBusy ||
      this.deps.now() < this.wakeTailUntil
    );
  }

  private syncWakePause(): void {
    const detector = this.wake;
    if (!detector) return;
    const pause = this.shouldPauseWake();
    try {
      if (pause && !this.wakePausedByUs && detector.state === 'listening') {
        detector.pause();
        this.wakePausedByUs = true;
      } else if (!pause && this.wakePausedByUs) {
        this.wakePausedByUs = false;
        if (detector.state === 'paused') detector.resume();
      }
    } catch {
      // גלאי שנכשל ידווח דרך state/lastError בסנכרון הבא
    }
    this.syncWakeView();
  }

  private scheduleWakeTail(): void {
    this.deps.timers.clearTimeout(this.wakeTailTimer);
    this.wakeTailTimer = this.deps.timers.setTimeout(() => {
      this.wakeTailTimer = null;
      this.syncWakePause();
    }, WAKE_TAIL_MS + 10);
  }

  /** מעתיק את מצב הגלאי האמיתי ל-store (למשל אם נפל באמצע). */
  private syncWakeView(): void {
    const detector = this.wake;
    if (!detector) return;
    if (detector.state === 'error') {
      this.failWake(detector.lastError || he.wake.unknownReason, detector.engine);
      return;
    }
    this.setWake({ status: detector.state, error: null, engine: detector.engine });
  }

  private setWake(next: WakeView): void {
    const cur = this.state.wake;
    if (cur.status === next.status && cur.error === next.error && cur.engine === next.engine) return;
    this.store.setState({ wake: next });
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
    this.store.setState({ micTest: 'recording' });
    this.syncWakePause();
    try {
      const mic = this.getMic();
      await mic.start({ deviceId: s.voice.micDeviceId || undefined, silenceTimeoutMs: 60_000, maxUtteranceSec: 3 });
      const done = mic.done;
      if (!done) return { ok: false, message: he.toasts.captureFailed };
      const result = await done;
      if (this.disposed) return { ok: false, message: he.errors.unknown };
      if (result.reason === 'cancelled' || result.reason === 'error') return { ok: false, message: he.toasts.captureFailed };
      if (!result.speechDetected || result.wav.byteLength <= 44) {
        return { ok: false, message: he.settings.voice.transcribeNoSpeech };
      }
      this.store.setState({ micTest: 'transcribing' });
      const res = await this.api.voice.transcribe({
        audio: result.wav,
        mimeType: 'audio/wav',
        durationMs: clampDurationMs(result.durationMs),
      });
      if (!res.ok) return { ok: false, message: res.message_he };
      const text = res.text.trim();
      return text ? { ok: true, text } : { ok: false, message: he.toasts.emptyTranscript };
    } catch (err) {
      return { ok: false, message: micErrorMessage(err) };
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
    return this.getSystemSpeaker().listVoices();
  }

  /* ---------------- אירועים מ-main ---------------- */

  private handleEvent(event: AssistantEvent): void {
    if (this.disposed) return;
    switch (event.type) {
      case 'phase': {
        this.sawPhaseEvent = true;
        const patch: Partial<UiState> = { enginePhase: event.phase, engineLabel: event.label_he ?? null };
        if (event.turnId) patch.activeTurnId = event.turnId;
        this.store.setState(patch);
        break;
      }
      case 'turn-started':
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
        this.maybeExpandForApproval();
        break;
      }
      case 'approval-resolved':
        this.resolvedApprovals.add(event.approvalId);
        this.removeApproval(event.approvalId);
        if (event.outcome === 'expired') this.notify('warning', he.toasts.approvalExpired);
        break;
      case 'response':
        this.store.setState({
          lastReply: { text: event.text, mode: event.mode, turnId: event.turnId },
          awaitingReply: false,
        });
        this.upsertActions(event.actions);
        if (event.speak) void this.speakResponse(event.text);
        break;
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
        this.store.setState((s) => ({ missedReminders: mergeById(s.missedReminders, event.reminders) }));
        break;
      case 'data-changed':
        this.bumpData(event.scope);
        if (event.scope === 'settings') void this.reloadSettings();
        if (event.scope === 'secrets') {
          void this.refreshServices();
          const s = this.state.settings;
          // מפתח Picovoice חדש -> מפעילים מחדש את הגלאי כדי שיטען אותו
          if (s?.wakeWord.enabled && s.wakeWord.engine === 'porcupine') void this.configureWakeWord();
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
    if (patch.pendingApprovals.length > 0) this.maybeExpandForApproval();
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
    if (!prev) patch.viewMode = next.ui.mode;
    else if (prev.ui.mode !== next.ui.mode && !this.expandedForApproval) patch.viewMode = next.ui.mode;
    this.store.setState(patch);
    if (!prev || wakeSettingsChanged(prev, next)) void this.configureWakeWord();
  }

  private async reloadSettings(): Promise<void> {
    try {
      const settings = await this.api.settings.get();
      if (!this.disposed) this.applySettings(settings);
    } catch {
      // נשארים עם ההגדרות הקודמות
    }
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
    if (persist) this.expandedForApproval = false;
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
    if (this.state.viewMode === 'compact') void this.setViewMode('full');
    this.store.setState(section ? { settingsOpen: true, settingsSection: section } : { settingsOpen: true });
  }

  closeSettings(): void {
    this.store.setState({ settingsOpen: false });
    if (this.state.micTest === 'meter') void this.stopMicMeter();
    this.maybeRestoreCompact();
  }

  setSettingsSection(section: SettingsSectionId): void {
    this.store.setState({ settingsSection: section });
  }

  /** בקשת אישור בתצוגה קומפקטית: מרחיבים זמנית (בלי לשמור), כדי שהדיאלוג יהיה קריא. */
  private maybeExpandForApproval(): void {
    if (this.state.viewMode !== 'compact' || this.state.pendingApprovals.length === 0) return;
    this.expandedForApproval = true;
    void this.setViewMode('full', { persist: false });
  }

  private maybeRestoreCompact(): void {
    if (!this.expandedForApproval) return;
    if (this.state.pendingApprovals.length > 0 || this.state.settingsOpen) return;
    this.expandedForApproval = false;
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

  private setAudioPhase(phase: AudioPhase): void {
    if (this.state.audioPhase === phase) return;
    this.store.setState({ audioPhase: phase });
    this.api.voice.reportAudioPhase(phase).catch(() => undefined);
    this.syncWakePause();
  }

  private getMic(): MicCapture {
    if (!this.mic) this.mic = this.deps.audio.createMicCapture();
    return this.mic;
  }

  private getPlayback(): SpeechPlayback {
    if (!this.playback) this.playback = this.deps.audio.createSpeechPlayback();
    return this.playback;
  }

  private getSystemSpeaker(): SystemSpeaker {
    if (!this.systemSpeaker) this.systemSpeaker = this.deps.audio.createSystemSpeaker();
    return this.systemSpeaker;
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

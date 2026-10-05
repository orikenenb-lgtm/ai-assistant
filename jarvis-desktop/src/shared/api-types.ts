import type {
  AppCandidate,
  ApprovalDecision,
  AssistantEvent,
  AssistantSnapshot,
  AudioPhase,
  BatteryReport,
  DisplayInfo,
  ErrorCode,
  PathValidation,
  ReminderDTO,
  ServiceStatus,
  SystemStatus,
  TaskDTO,
  UiCommand,
  UsageSummaryRow,
} from './types';
import type { SecretName, SecretsStatus, Settings, SettingsPatch } from './settings-schema';

/**
 * ה-API היחיד שה-renderer מקבל (window.jarvis), דרך contextBridge.
 * אין כאן גישה לקבצים, לפקודות מערכת או לערכי מפתחות.
 */

export type Unsubscribe = () => void;

export type Result<T> = ({ ok: true } & T) | { ok: false; code: ErrorCode; message_he: string };

export interface SubmitInput {
  text: string;
  source: 'text' | 'voice' | 'wakeword' | 'ui';
  clientRequestId: string;
}

export type SubmitResult = Result<{ turnId: string; mode: 'ai' | 'local' }>;

export type TranscribeResult = Result<{ text: string; provider: string; durationMs: number }>;

export type SynthesizeResult = Result<{ audio: Uint8Array; mimeType: string; provider: string }>;

export interface JarvisApi {
  readonly version: string;
  readonly platform: string;
  assistant: {
    submit(input: SubmitInput): Promise<SubmitResult>;
    cancel(turnId?: string): Promise<{ cancelled: boolean }>;
    approve(decision: ApprovalDecision): Promise<Result<{ outcome: 'approved' | 'rejected' }>>;
    analyzeScreen(input: { question?: string; displayId?: string; clientRequestId: string }): Promise<SubmitResult>;
    snapshot(): Promise<AssistantSnapshot>;
    onEvent(listener: (event: AssistantEvent) => void): Unsubscribe;
  };
  voice: {
    transcribe(input: { audio: Uint8Array; mimeType: 'audio/wav'; durationMs: number }): Promise<TranscribeResult>;
    synthesize(input: { text: string }): Promise<SynthesizeResult>;
    reportAudioPhase(phase: AudioPhase): Promise<void>;
  };
  settings: {
    get(): Promise<Settings>;
    update(patch: SettingsPatch): Promise<Result<{ settings: Settings }>>;
    validatePath(input: {
      path: string;
      expected: 'exe' | 'shortcut' | 'uri' | 'eplan' | 'file' | 'folder';
    }): Promise<PathValidation>;
    pickPath(purpose: 'app-exe' | 'project-file' | 'project-folder'): Promise<string | null>;
    detectApps(): Promise<AppCandidate[]>;
    testOpen(input: { kind: 'app' | 'project'; id: string }): Promise<Result<{ summary_he: string }>>;
  };
  secrets: {
    status(): Promise<SecretsStatus>;
    set(name: SecretName, value: string): Promise<Result<{ status: SecretsStatus }>>;
    clear(name: SecretName): Promise<SecretsStatus>;
  };
  data: {
    listTasks(filter: 'today' | 'open' | 'all'): Promise<TaskDTO[]>;
    completeTask(id: string): Promise<Result<{ task: TaskDTO }>>;
    listReminders(filter: 'upcoming' | 'missed' | 'all'): Promise<ReminderDTO[]>;
    cancelReminder(id: string): Promise<Result<{ reminder: ReminderDTO }>>;
    acknowledgeReminders(ids: string[]): Promise<{ acknowledged: number }>;
    usageSummary(): Promise<UsageSummaryRow[]>;
    clearHistory(scope: 'conversation' | 'all'): Promise<{ cleared: string[] }>;
  };
  system: {
    status(): Promise<SystemStatus>;
    reportBattery(report: BatteryReport): Promise<void>;
    testService(service: 'llm' | 'stt' | 'tts'): Promise<ServiceStatus>;
    listDisplays(): Promise<DisplayInfo[]>;
  };
  window: {
    setMode(mode: 'full' | 'compact'): Promise<void>;
    setAlwaysOnTop(value: boolean): Promise<void>;
    minimize(): Promise<void>;
    close(): Promise<void>;
    quit(): Promise<void>;
  };
  /**
   * מילת הפעלה "Jarvis" (Porcupine) — המנוע והמפתח נמצאים ב-main.
   * ה-renderer מזרים אודיו 16kHz int16; זיהוי מגיע כ-onCommand({type:'toggle-listen', source:'wakeword'}).
   */
  wakeword: {
    startPorcupine(sensitivity: number): Promise<Result<{ frameLength: number; sampleRate: number }>>;
    stopPorcupine(): Promise<void>;
    pushFrames(samples: Int16Array): void;
  };
  onCommand(listener: (command: UiCommand) => void): Unsubscribe;
}

declare global {
  interface Window {
    jarvis: JarvisApi;
  }
}

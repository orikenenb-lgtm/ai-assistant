import { ipcMain, type WebContents } from 'electron';
import type { z } from 'zod';
import { IPC } from '../../shared/ipc-channels';
import { IPC_REQUEST_SCHEMAS, IPC_SEND_SCHEMAS } from '../../shared/ipc-schemas';
import type { AudioPhase, ServiceStatus } from '../../shared/types';
import type { SettingsPatch } from '../../shared/settings-schema';
import type {
  ApprovalService,
  Clock,
  ConversationEngine,
  Database,
  LauncherService,
  Logger,
  ScreenCaptureService,
  SecretService,
  SettingsService,
  SystemStatusService,
} from '../core/contracts';
import { SettingsValidationError } from '../settings/settings-store';
import type { VoiceService } from '../voice/voice-service';
import type { PorcupineService } from '../wakeword/porcupine-service';
import { isTrustedSender } from './security';

/**
 * רישום כל ה-handlers של IPC. כל בקשה עוברת:
 * 1) אימות שולח (ה-webContents של החלון הראשי, frame ראשי, מקור app:// או שרת הפיתוח).
 * 2) אימות מטען מול סכמת zod הקשיחה של הערוץ.
 * בקשה שנכשלת נדחית ונרשמת בלוג (בלי תוכן).
 */

export interface IpcDeps {
  devOrigin: string | null;
  getWebContents: () => WebContents | null;
  logger: Logger;
  clock: Clock;
  engine: ConversationEngine;
  approvals: ApprovalService;
  voice: VoiceService;
  settings: SettingsService;
  secrets: SecretService;
  launcher: LauncherService;
  db: Database;
  system: SystemStatusService;
  screen: ScreenCaptureService;
  testService(service: 'llm' | 'stt' | 'tts'): Promise<ServiceStatus>;
  pickPath(purpose: 'app-exe' | 'project-file' | 'project-folder'): Promise<string | null>;
  todayLocal(): string;
  clearAllLogs(): void;
  onAudioPhase(phase: AudioPhase): void;
  onSecretsChanged(): void;
  onRemindersChanged(): void;
  wakeword: PorcupineService;
  onWakeDetected(): void;
  window: {
    setMode(mode: 'full' | 'compact'): void;
    setAlwaysOnTop(value: boolean): void;
    minimize(): void;
    close(): void;
    quit(): void;
  };
}

type Schemas = typeof IPC_REQUEST_SCHEMAS;
type Channel = keyof Schemas;

export function registerIpc(deps: IpcDeps): () => void {
  const { logger } = deps;
  const registered: string[] = [];

  function handle<C extends Channel>(channel: C, fn: (input: z.infer<Schemas[C]>) => unknown): void {
    const schema = IPC_REQUEST_SCHEMAS[channel] as z.ZodType;
    ipcMain.handle(channel, async (event, payload: unknown) => {
      if (!isTrustedSender(event, deps.devOrigin, deps.getWebContents)) {
        logger.warn('ipc.untrusted_sender', { channel });
        throw new Error('FORBIDDEN');
      }
      const parsed = schema.safeParse(payload);
      if (!parsed.success) {
        logger.warn('ipc.invalid_payload', { channel, issues: parsed.error.issues.map((i) => i.path.join('.')).slice(0, 5) });
        throw new Error('INVALID_PARAMS');
      }
      try {
        return await fn(parsed.data as z.infer<Schemas[C]>);
      } catch (err) {
        logger.error('ipc.handler_failed', { channel, error: err instanceof Error ? err.message : String(err) });
        throw err instanceof Error ? new Error(err.message) : new Error('INTERNAL');
      }
    });
    registered.push(channel);
  }

  // ---------- שיחה ----------
  handle(IPC.assistantSubmit, (input) => deps.engine.submit(input));
  handle(IPC.assistantCancel, (input) => ({ cancelled: deps.engine.cancel(input.turnId) }));
  handle(IPC.assistantApprove, (input) => {
    const res = deps.approvals.decide(input);
    return res.ok
      ? { ok: true, outcome: input.approved ? 'approved' : 'rejected' }
      : { ok: false, code: res.code ?? 'APPROVAL_MISMATCH', message_he: res.message_he ?? 'האישור לא תקף.' };
  });
  handle(IPC.assistantAnalyzeScreen, (input) => deps.engine.analyzeScreen(input));
  handle(IPC.assistantSnapshot, () => deps.engine.snapshot());

  // ---------- קול ----------
  handle(IPC.voiceTranscribe, (input) => deps.voice.transcribe(input));
  handle(IPC.voiceSynthesize, (input) => deps.voice.synthesize(input));
  handle(IPC.voiceReportAudioPhase, (input) => {
    deps.onAudioPhase(input.phase);
  });

  // ---------- הגדרות ----------
  handle(IPC.settingsGet, () => deps.settings.get());
  handle(IPC.settingsUpdate, (input) => {
    try {
      return { ok: true, settings: deps.settings.update(input as SettingsPatch) };
    } catch (err) {
      if (err instanceof SettingsValidationError) return { ok: false, code: 'INVALID_PARAMS', message_he: err.message_he };
      throw err;
    }
  });
  handle(IPC.settingsValidatePath, (input) => deps.launcher.validatePath(input.path, input.expected));
  handle(IPC.settingsPickPath, (input) => deps.pickPath(input.purpose));
  handle(IPC.settingsDetectApps, () => deps.launcher.detectApps());
  handle(IPC.settingsTestOpen, async (input) => {
    // בדיקת פתיחה מתוך מסך ההגדרות היא פעולה ישירה של המשתמש (לחיצה), לא של המודל
    const s = deps.settings.get();
    const result =
      input.kind === 'app'
        ? await deps.launcher.openApplication({ app_id: input.id }, s)
        : await deps.launcher.openProject({ project_id: input.id }, s);
    return result.ok
      ? { ok: true, summary_he: result.summary_he }
      : { ok: false, code: result.error_code ?? 'LAUNCH_FAILED', message_he: result.summary_he };
  });

  // ---------- סודות ----------
  handle(IPC.secretsStatus, () => deps.secrets.status());
  handle(IPC.secretsSet, (input) => {
    try {
      deps.secrets.set(input.name, input.value);
      deps.onSecretsChanged();
      return { ok: true, status: deps.secrets.status() };
    } catch (err) {
      return { ok: false, code: 'INVALID_PARAMS', message_he: err instanceof Error ? err.message : 'שמירת המפתח נכשלה.' };
    }
  });
  handle(IPC.secretsClear, (input) => {
    deps.secrets.clear(input.name);
    deps.onSecretsChanged();
    return deps.secrets.status();
  });

  // ---------- נתונים ----------
  handle(IPC.dataListTasks, (input) => deps.db.tasks.list(input.filter, deps.todayLocal()));
  handle(IPC.dataCompleteTask, (input) => {
    const task = deps.db.tasks.complete(input.id);
    return task ? { ok: true, task } : { ok: false, code: 'NOT_FOUND', message_he: 'המשימה לא נמצאה.' };
  });
  handle(IPC.dataListReminders, (input) => deps.db.reminders.list(input.filter));
  handle(IPC.dataCancelReminder, (input) => {
    const reminder = deps.db.reminders.cancel(input.id);
    if (!reminder) return { ok: false, code: 'NOT_FOUND', message_he: 'התזכורת לא נמצאה.' };
    // cancel() מחזיר את התזכורת גם אם לא בוטלה (למשל כבר הופעלה) — מדווחים הצלחה רק על ביטול בפועל
    if (reminder.status !== 'cancelled') {
      return { ok: false, code: 'INVALID_PARAMS', message_he: 'אי אפשר לבטל תזכורת שכבר הופעלה או הוחמצה.' };
    }
    deps.onRemindersChanged();
    return { ok: true, reminder };
  });
  handle(IPC.dataAcknowledgeReminders, (input) => ({ acknowledged: deps.db.reminders.acknowledge(input.ids) }));
  handle(IPC.dataUsageSummary, () => deps.db.usage.summary(deps.clock.now()));
  handle(IPC.dataClearHistory, (input) => {
    const cleared: string[] = [];
    deps.db.history.clear();
    cleared.push('conversation');
    if (input.scope === 'all') {
      deps.db.actions.clear();
      deps.db.usage.clear();
      deps.clearAllLogs();
      cleared.push('actions', 'usage', 'logs');
    }
    logger.info('privacy.history_cleared', { scope: input.scope });
    return { cleared };
  });

  // ---------- מערכת ----------
  handle(IPC.systemStatus, () => deps.system.getStatus());
  handle(IPC.systemReportBattery, (input) => {
    deps.system.reportBattery(input);
  });
  handle(IPC.systemTestService, (input) => deps.testService(input.service));
  handle(IPC.systemListDisplays, () => deps.screen.listDisplays());

  // ---------- חלון ----------
  handle(IPC.windowSetMode, (input) => deps.window.setMode(input.mode));
  handle(IPC.windowSetAlwaysOnTop, (input) => deps.window.setAlwaysOnTop(input.value));
  handle(IPC.windowMinimize, () => deps.window.minimize());
  handle(IPC.windowClose, () => deps.window.close());
  handle(IPC.appQuit, () => deps.window.quit());

  // ---------- מילת הפעלה (Porcupine ב-main) ----------
  handle(IPC.wakewordStart, (input) => deps.wakeword.start({ sensitivity: input.sensitivity }));
  handle(IPC.wakewordStop, () => {
    deps.wakeword.stop();
  });

  // הזרמת אודיו: ערוץ send (בלי תשובה). מאומת לפי שולח וגודל; מוגבל בקצב כדי שלא יציף את main.
  let windowStart = 0;
  let framesInWindow = 0;
  const onFrames = (event: Electron.IpcMainEvent, payload: unknown): void => {
    if (!isTrustedSender(event as unknown as Electron.IpcMainInvokeEvent, deps.devOrigin, deps.getWebContents)) return;
    const parsed = IPC_SEND_SCHEMAS[IPC.wakewordFrames].safeParse(payload);
    if (!parsed.success || !deps.wakeword.running) return;
    const now = Date.now();
    if (now - windowStart > 1000) {
      windowStart = now;
      framesInWindow = 0;
    }
    if (++framesInWindow > 100) return;
    if (deps.wakeword.process(parsed.data)) deps.onWakeDetected();
  };
  ipcMain.on(IPC.wakewordFrames, onFrames);

  return () => {
    for (const c of registered) ipcMain.removeHandler(c);
    ipcMain.removeListener(IPC.wakewordFrames, onFrames);
  };
}

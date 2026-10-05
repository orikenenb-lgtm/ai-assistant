import { z } from 'zod';
import { IPC, MAX_AUDIO_BYTES, MAX_TEXT_INPUT, MAX_WAKEWORD_FRAME_SAMPLES } from './ipc-channels';
import { SECRET_NAMES } from './settings-schema';

/**
 * סכמות zod לכל בקשת IPC שה-renderer שולח.
 * main דוחה כל בקשה שלא עוברת אימות — גם אם הגיעה מה-preload שלנו.
 */

const id = z.string().min(1).max(64);

export const SubmitRequestSchema = z
  .object({
    text: z.string().trim().min(1).max(MAX_TEXT_INPUT),
    source: z.enum(['text', 'voice', 'wakeword', 'ui']),
    /** מזהה שה-renderer מייצר לכל שליחה. שליחה כפולה עם אותו מזהה נדחית. */
    clientRequestId: z.string().uuid(),
  })
  .strict();

export const CancelRequestSchema = z.object({ turnId: id.optional() }).strict();

export const ApproveRequestSchema = z
  .object({
    approvalId: id,
    approved: z.boolean(),
    displayId: z.string().max(64).optional(),
  })
  .strict();

export const AnalyzeScreenRequestSchema = z
  .object({
    question: z.string().trim().max(500).optional(),
    displayId: z.string().max(64).optional(),
    clientRequestId: z.string().uuid(),
  })
  .strict();

export const TranscribeRequestSchema = z
  .object({
    audio: z.instanceof(Uint8Array).refine((a) => a.byteLength > 44 && a.byteLength <= MAX_AUDIO_BYTES, {
      message: 'audio size out of range',
    }),
    mimeType: z.literal('audio/wav'),
    durationMs: z.number().int().min(100).max(65_000),
  })
  .strict();

export const SynthesizeRequestSchema = z
  .object({
    // ניתוח מסך יכול להגיע ל-~1800 תווים; ספקי ה-TTS מקבלים יותר (OpenAI עד 4096)
    text: z.string().trim().min(1).max(2500),
  })
  .strict();

export const AudioPhaseReportSchema = z
  .object({ phase: z.enum(['IDLE', 'LISTENING', 'TRANSCRIBING', 'SPEAKING']) })
  .strict();

/** עדכון הגדרות: main ממזג ומאמת מול SettingsSchema המלא. כאן רק בדיקת מבנה בסיסית. */
export const SettingsUpdateSchema = z.record(z.string(), z.unknown());

export const ValidatePathSchema = z
  .object({
    path: z.string().min(1).max(1024),
    expected: z.enum(['exe', 'shortcut', 'uri', 'eplan', 'file', 'folder']),
  })
  .strict();

export const PickPathSchema = z
  .object({ purpose: z.enum(['app-exe', 'project-file', 'project-folder']) })
  .strict();

export const TestOpenSchema = z
  .object({ kind: z.enum(['app', 'project']), id: z.string().max(40) })
  .strict();

export const SecretSetSchema = z
  .object({
    name: z.enum(SECRET_NAMES),
    value: z.string().trim().min(8).max(512),
  })
  .strict();

export const SecretClearSchema = z.object({ name: z.enum(SECRET_NAMES) }).strict();

export const ListTasksSchema = z.object({ filter: z.enum(['today', 'open', 'all']) }).strict();
export const TaskIdSchema = z.object({ id }).strict();
export const ListRemindersSchema = z
  .object({ filter: z.enum(['upcoming', 'missed', 'all']) })
  .strict();
export const ReminderIdSchema = z.object({ id }).strict();
export const AcknowledgeSchema = z.object({ ids: z.array(id).max(200) }).strict();
export const ClearHistorySchema = z.object({ scope: z.enum(['conversation', 'all']) }).strict();

/** Chromium מדווח Infinity כשאין הערכת זמן — ממירים ל-null (zod דוחה מספרים אינסופיים). */
const finiteOrNull = z.preprocess((v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v), z.number().nullable());

export const BatteryReportSchema = z
  .object({
    level: z.number().min(0).max(1),
    charging: z.boolean(),
    chargingTime: finiteOrNull,
    dischargingTime: finiteOrNull,
  })
  .strict();

export const TestServiceSchema = z.object({ service: z.enum(['llm', 'stt', 'tts']) }).strict();

export const WindowModeSchema = z.object({ mode: z.enum(['full', 'compact']) }).strict();
export const AlwaysOnTopSchema = z.object({ value: z.boolean() }).strict();
export const EmptySchema = z.union([z.undefined(), z.object({}).strict()]);

export const WakewordStartSchema = z.object({ sensitivity: z.number().min(0.1).max(0.95) }).strict();
export const WakewordFramesSchema = z
  .instanceof(Int16Array)
  .refine((a) => a.length > 0 && a.length <= MAX_WAKEWORD_FRAME_SAMPLES, { message: 'frame size out of range' });

/** מיפוי ערוץ -> סכמה. main משתמש בזה כדי לרשום handlers, ובדיקות מוודאות שכל ערוץ מכוסה. */
export const IPC_REQUEST_SCHEMAS = {
  [IPC.assistantSubmit]: SubmitRequestSchema,
  [IPC.assistantCancel]: CancelRequestSchema,
  [IPC.assistantApprove]: ApproveRequestSchema,
  [IPC.assistantAnalyzeScreen]: AnalyzeScreenRequestSchema,
  [IPC.assistantSnapshot]: EmptySchema,
  [IPC.voiceTranscribe]: TranscribeRequestSchema,
  [IPC.voiceSynthesize]: SynthesizeRequestSchema,
  [IPC.voiceReportAudioPhase]: AudioPhaseReportSchema,
  [IPC.settingsGet]: EmptySchema,
  [IPC.settingsUpdate]: SettingsUpdateSchema,
  [IPC.settingsValidatePath]: ValidatePathSchema,
  [IPC.settingsPickPath]: PickPathSchema,
  [IPC.settingsDetectApps]: EmptySchema,
  [IPC.settingsTestOpen]: TestOpenSchema,
  [IPC.secretsStatus]: EmptySchema,
  [IPC.secretsSet]: SecretSetSchema,
  [IPC.secretsClear]: SecretClearSchema,
  [IPC.dataListTasks]: ListTasksSchema,
  [IPC.dataCompleteTask]: TaskIdSchema,
  [IPC.dataListReminders]: ListRemindersSchema,
  [IPC.dataCancelReminder]: ReminderIdSchema,
  [IPC.dataAcknowledgeReminders]: AcknowledgeSchema,
  [IPC.dataUsageSummary]: EmptySchema,
  [IPC.dataClearHistory]: ClearHistorySchema,
  [IPC.systemStatus]: EmptySchema,
  [IPC.systemReportBattery]: BatteryReportSchema,
  [IPC.systemTestService]: TestServiceSchema,
  [IPC.systemListDisplays]: EmptySchema,
  [IPC.windowSetMode]: WindowModeSchema,
  [IPC.windowSetAlwaysOnTop]: AlwaysOnTopSchema,
  [IPC.windowMinimize]: EmptySchema,
  [IPC.windowClose]: EmptySchema,
  [IPC.appQuit]: EmptySchema,
  [IPC.wakewordStart]: WakewordStartSchema,
  [IPC.wakewordStop]: EmptySchema,
} as const;

/** סכמות לערוצי send (ipcMain.on). */
export const IPC_SEND_SCHEMAS = {
  [IPC.wakewordFrames]: WakewordFramesSchema,
} as const;

export type SubmitRequest = z.infer<typeof SubmitRequestSchema>;
export type AnalyzeScreenRequest = z.infer<typeof AnalyzeScreenRequestSchema>;
export type TranscribeRequest = z.infer<typeof TranscribeRequestSchema>;
export type SynthesizeRequest = z.infer<typeof SynthesizeRequestSchema>;

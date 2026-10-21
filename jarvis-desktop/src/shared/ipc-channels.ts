/**
 * שמות ערוצי ה-IPC. זו הרשימה הסגורה היחידה — preload חושף רק אותם,
 * ו-main רושם handler רק להם (כל אחד עם סכמת zod ב-ipc-schemas.ts).
 * בלי תלויות, כדי שה-preload יישאר רזה.
 */
export const IPC = {
  // שיחה
  assistantSubmit: 'assistant:submit',
  assistantCancel: 'assistant:cancel',
  assistantApprove: 'assistant:approve',
  assistantAnalyzeScreen: 'assistant:analyze-screen',
  assistantSnapshot: 'assistant:snapshot',
  // קול
  voiceTranscribe: 'voice:transcribe',
  voiceSynthesize: 'voice:synthesize',
  voiceReportAudioPhase: 'voice:report-audio-phase',
  /** ביטול בקשת תמלול/הקראה שבדרך (לפי requestId) — כדי שעצירה תעצור גם את העבודה בענן. */
  voiceCancel: 'voice:cancel',
  // הגדרות
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  settingsValidatePath: 'settings:validate-path',
  settingsPickPath: 'settings:pick-path',
  settingsDetectApps: 'settings:detect-apps',
  settingsTestOpen: 'settings:test-open',
  // סודות (כתיבה בלבד מה-renderer; אין קריאה של ערך)
  secretsStatus: 'secrets:status',
  secretsSet: 'secrets:set',
  secretsClear: 'secrets:clear',
  // נתונים
  dataListTasks: 'data:list-tasks',
  dataCompleteTask: 'data:complete-task',
  dataListReminders: 'data:list-reminders',
  dataCancelReminder: 'data:cancel-reminder',
  dataAcknowledgeReminders: 'data:acknowledge-reminders',
  dataUsageSummary: 'data:usage-summary',
  dataClearHistory: 'data:clear-history',
  // מערכת
  systemStatus: 'system:status',
  systemReportBattery: 'system:report-battery',
  systemTestService: 'system:test-service',
  systemListDisplays: 'system:list-displays',
  // חלון
  windowSetMode: 'window:set-mode',
  windowSetAlwaysOnTop: 'window:set-always-on-top',
  windowMinimize: 'window:minimize',
  windowClose: 'window:close',
  appQuit: 'app:quit',
  // מילת הפעלה (Porcupine רץ ב-main; ה-renderer מזרים פריימים של אודיו מקומית)
  wakewordStart: 'wakeword:start',
  wakewordStop: 'wakeword:stop',
  /** מצב הסשן ב-main (פועל / נפל / נעצר) — כך ה-renderer רואה כשל של המנוע אחרי הפעלה מוצלחת. */
  wakewordStatus: 'wakeword:status',
  wakewordFrames: 'wakeword:frames',
  // אירועים main -> renderer
  evtAssistant: 'evt:assistant',
  evtCommand: 'evt:command',
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];

/** ערוצים חד-כיווניים (send) — בלי תשובה. כרגע רק הזרמת אודיו למילת ההפעלה. */
export const SEND_CHANNELS: readonly string[] = [IPC.wakewordFrames];

/** ערוצים שה-renderer רשאי לקרוא להם ב-invoke. */
export const INVOKE_CHANNELS: readonly string[] = Object.values(IPC).filter(
  (c) => !c.startsWith('evt:') && !SEND_CHANNELS.includes(c),
);

/** ערוצי אירועים שה-renderer רשאי להאזין להם. */
export const EVENT_CHANNELS: readonly string[] = [IPC.evtAssistant, IPC.evtCommand];

/** מגבלת גודל לאודיו שנשלח לתמלול (בתים). 60 שניות WAV 16kHz מונו 16bit ≈ 1.9MB. */
export const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
export const MAX_TEXT_INPUT = 2000;
/** מקסימום דגימות בהודעת אודיו אחת למילת ההפעלה (≈0.25 שניות ב-16kHz). */
export const MAX_WAKEWORD_FRAME_SAMPLES = 4096;

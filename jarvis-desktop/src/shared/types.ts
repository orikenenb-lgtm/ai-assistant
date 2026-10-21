/**
 * טיפוסים משותפים ל-main, preload ו-renderer.
 * הקובץ הזה חייב להישאר "טהור": בלי ייבוא של node, electron או ספריות צד שלישי,
 * כדי שאפשר יהיה לייבא אותו מכל שכבה.
 */

/** מצבי התצוגה הרשמיים של JARVIS. חייבים לשקף פעילות אמיתית. */
export const ASSISTANT_STATES = [
  'IDLE',
  'LISTENING',
  'THINKING',
  'EXECUTING',
  'SPEAKING',
  'AWAITING_APPROVAL',
  'ERROR',
] as const;
export type AssistantState = (typeof ASSISTANT_STATES)[number];

/** המצב שמנוע השיחה (main) מדווח עליו. */
export const ENGINE_PHASES = ['IDLE', 'THINKING', 'EXECUTING', 'AWAITING_APPROVAL', 'ERROR'] as const;
export type EnginePhase = (typeof ENGINE_PHASES)[number];

/** מצב האודיו שה-renderer מדווח עליו (מיקרופון והשמעה קורים ב-renderer). */
export const AUDIO_PHASES = ['IDLE', 'LISTENING', 'TRANSCRIBING', 'SPEAKING'] as const;
export type AudioPhase = (typeof AUDIO_PHASES)[number];

export type InputSource = 'text' | 'voice' | 'wakeword' | 'ui';

/** הכלים היחידים שהמודל רשאי להציע. אין כלי shell. */
export const TOOL_NAMES = [
  'open_application',
  'open_project',
  'get_system_status',
  'create_task',
  'list_tasks',
  'complete_task',
  'create_reminder',
  'list_reminders',
  'cancel_reminder',
  'capture_screen_for_analysis',
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export function isToolName(value: string): value is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(value);
}

export type ErrorCode =
  | 'NOT_CONFIGURED'
  | 'MISSING_API_KEY'
  | 'INVALID_API_KEY'
  | 'NETWORK'
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_ERROR'
  | 'REFUSAL'
  | 'CANCELLED'
  | 'INVALID_PARAMS'
  | 'UNKNOWN_TOOL'
  | 'NOT_ALLOWLISTED'
  | 'PATH_NOT_FOUND'
  | 'PATH_INVALID'
  | 'LAUNCH_FAILED'
  | 'AMBIGUOUS'
  | 'NOT_FOUND'
  | 'PAST_TIME'
  | 'DST_GAP'
  | 'DST_AMBIGUOUS'
  | 'PERMISSION_DENIED'
  | 'APPROVAL_EXPIRED'
  | 'APPROVAL_MISMATCH'
  | 'DUPLICATE'
  | 'CAPTURE_FAILED'
  | 'AUDIO_INVALID'
  | 'EMPTY_TRANSCRIPT'
  | 'BUSY'
  | 'INTERNAL';

export type ActionStatus =
  | 'pending'
  | 'awaiting_approval'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'rejected'
  | 'cancelled'
  | 'deduplicated'
  | 'needs_clarification';

/** פעולה שמוצגת ב-HUD. הסטטוס מגיע תמיד מהקוד המקומי, לא מטקסט של המודל. */
export interface ActionRecord {
  id: string;
  turnId: string;
  /** שם הכלי. יכול להיות מחרוזת לא מוכרת כשהמודל ביקש כלי שאינו קיים (ואז status=rejected). */
  tool: string;
  /** תיאור קצר בעברית, למשל "פתיחת תוכנה: EPLAN". */
  title: string;
  status: ActionStatus;
  /** true כשהסטטוס נקבע לפי תוצאת הכלי בפועל. */
  verified: boolean;
  /** סיכום בעברית מתוך תוצאת הכלי. */
  detail?: string;
  errorCode?: ErrorCode;
  startedAt: string;
  finishedAt?: string;
}

/** התוצאה שכלי מחזיר — גם למודל וגם ל-HUD. */
export interface ToolResult {
  ok: boolean;
  status: 'success' | 'error' | 'needs_clarification' | 'rejected' | 'deduplicated' | 'cancelled';
  /** עובדה מאומתת בעברית, שמתאימה גם להקראה. */
  summary_he: string;
  data?: unknown;
  error_code?: ErrorCode;
  /** אפשרויות לבחירה כשנדרשת הבהרה (למשל כמה פרויקטים מתאימים). */
  options?: Array<{ id: string; label: string }>;
  /** true כשהתוכן הגיע ממקור חיצוני לא מהימן (למשל ניתוח צילום מסך). */
  untrusted?: boolean;
}

export interface DisplayInfo {
  id: string;
  label: string;
  width: number;
  height: number;
  scaleFactor: number;
  primary: boolean;
}

export interface ApprovalRequest {
  approvalId: string;
  turnId: string;
  actionId: string;
  tool: ToolName;
  /** מה בדיוק יתבצע. */
  action_he: string;
  /** על מה/איפה. */
  target_he: string;
  /** מה ההשפעה. */
  impact_he: string;
  reason: 'privacy' | 'tainted' | 'policy';
  warning_he?: string;
  expiresAt: string;
  /** לצילום מסך: רשימת מסכים (גאומטריה בלבד, בלי צילום מקדים). */
  displays?: DisplayInfo[];
  defaultDisplayId?: string;
}

export interface ApprovalDecision {
  approvalId: string;
  approved: boolean;
  /** לצילום מסך: המסך שהמשתמש בחר. חייב להיות אחד מהמסכים שהוצעו. */
  displayId?: string;
}

export interface TaskDTO {
  id: string;
  title: string;
  notes: string | null;
  /** תאריך יעד מקומי (Asia/Jerusalem) בפורמט YYYY-MM-DD, או null. */
  dueDate: string | null;
  status: 'open' | 'done' | 'cancelled';
  createdAt: string;
  completedAt: string | null;
}

export type ReminderStatus = 'scheduled' | 'fired' | 'missed' | 'cancelled' | 'acknowledged';

export interface ReminderDTO {
  id: string;
  text: string;
  /** רגע ההתראה ב-UTC (ISO 8601). */
  dueAtUtc: string;
  /** תצוגה מלאה בעברית לפי Asia/Jerusalem, למשל "יום שלישי, 6 באוקטובר 2026 בשעה 08:00". */
  dueLocal_he: string;
  timezone: string;
  status: ReminderStatus;
  createdAt: string;
  firedAt: string | null;
}

export interface BatteryReport {
  level: number;
  charging: boolean;
  chargingTime: number | null;
  dischargingTime: number | null;
}

export interface ServiceStatus {
  service: 'llm' | 'stt' | 'tts' | 'wakeword';
  provider: string;
  configured: boolean;
  state: 'ok' | 'error' | 'unknown' | 'not_configured' | 'local';
  lastCheckedAt?: string;
  lastError_he?: string;
}

export interface SystemStatus {
  timestamp: string;
  cpu: { usagePercent: number | null; cores: number; model: string };
  memory: { totalBytes: number; usedBytes: number; freeBytes: number; usagePercent: number };
  disks: Array<{ mount: string; totalBytes: number; freeBytes: number; usagePercent: number }>;
  battery: {
    available: boolean;
    levelPercent?: number;
    charging?: boolean;
    source: 'renderer-battery-api' | 'none';
    note_he?: string;
  };
  services: ServiceStatus[];
  uptimeSec: number;
  platform: string;
}

export type ScreenCaptureStage = 'capturing' | 'sending' | 'done' | 'discarded' | 'failed';

/** אירועים ש-main שולח ל-renderer בערוץ assistant:event. */
export type AssistantEvent =
  | { type: 'phase'; phase: EnginePhase; turnId?: string; label_he?: string }
  | { type: 'turn-started'; turnId: string; text: string; source: InputSource; mode: 'ai' | 'local' }
  | { type: 'action'; action: ActionRecord }
  | { type: 'approval-required'; request: ApprovalRequest }
  | {
      type: 'approval-resolved';
      approvalId: string;
      outcome: 'approved' | 'rejected' | 'expired' | 'cancelled';
    }
  | {
      type: 'response';
      turnId: string;
      /** הטקסט שהמודל ניסח (או טקסט מקומי במצב local). */
      text: string;
      /** האם להקריא (לא מקריאים כשהתור בוטל). */
      speak: boolean;
      mode: 'ai' | 'local';
      /** הפעולות שבוצעו בתור הזה, כפי שהקוד המקומי אימת אותן. */
      actions: ActionRecord[];
    }
  | { type: 'error'; turnId?: string; code: ErrorCode; message_he: string; retryable: boolean }
  | { type: 'turn-ended'; turnId: string; outcome: 'completed' | 'cancelled' | 'failed' }
  | { type: 'screen-capture'; stage: ScreenCaptureStage; displayLabel?: string }
  | { type: 'reminder-fired'; reminder: ReminderDTO }
  | { type: 'missed-reminders'; reminders: ReminderDTO[] }
  | { type: 'data-changed'; scope: 'tasks' | 'reminders' | 'settings' | 'secrets' | 'history' | 'usage' };

/** פקודות ש-main שולח ל-renderer (קיצור מקשים, מגש מערכת). */
export type UiCommand =
  | { type: 'toggle-listen'; source: 'hotkey' | 'tray' | 'wakeword' }
  | { type: 'stop' }
  | { type: 'open-settings' }
  | { type: 'view-mode'; mode: 'full' | 'compact' };

export interface AssistantSnapshot {
  phase: EnginePhase;
  activeTurnId: string | null;
  pendingApprovals: ApprovalRequest[];
  missedReminders: ReminderDTO[];
}

export interface AppCandidate {
  name: string;
  path: string;
  kind: 'exe' | 'shortcut' | 'uri';
  suggestedId: string;
}

export interface PathValidation {
  ok: boolean;
  exists: boolean;
  detectedKind: 'exe' | 'shortcut' | 'file' | 'folder' | 'uri' | 'unknown';
  message_he: string;
}

export interface UsageSummaryRow {
  provider: string;
  kind: 'llm' | 'vision' | 'stt' | 'tts';
  model: string;
  period: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  audioSeconds: number;
  characters: number;
}

/**
 * חוזים פנימיים של תהליך main.
 * כל מודול מממש ממשק מכאן, ו-main.ts מרכיב אותם (composition root).
 * כך אפשר לבדוק כל מודול לבד עם mocks, ולהחליף מימוש (למשל סנכרון Supabase ב-V2).
 */
import type { z } from 'zod';
import type {
  ActionRecord,
  AppCandidate,
  ApprovalDecision,
  ApprovalRequest,
  AssistantEvent,
  AssistantSnapshot,
  BatteryReport,
  DisplayInfo,
  ErrorCode,
  InputSource,
  PathValidation,
  ReminderDTO,
  ServiceStatus,
  SystemStatus,
  TaskDTO,
  ToolName,
  ToolResult,
  UsageSummaryRow,
} from '../../shared/types';
import type { SecretName, SecretsStatus, Settings, SettingsPatch } from '../../shared/settings-schema';

/* ------------------------------------------------------------------ */
/* תשתית                                                               */
/* ------------------------------------------------------------------ */

/** שעון שניתן להזרקה — כל קוד שתלוי בזמן מקבל אותו, כדי שהבדיקות יהיו דטרמיניסטיות. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * לוגר עם צמצום מידע: מקבל שם אירוע ונתונים מובנים.
 * המימוש מסנן מפתחות API, טוקנים ונתיבים אישיים; תמלולים לא נרשמים כברירת מחדל.
 */
export interface Logger {
  debug(event: string, data?: Record<string, unknown>): void;
  info(event: string, data?: Record<string, unknown>): void;
  warn(event: string, data?: Record<string, unknown>): void;
  error(event: string, data?: Record<string, unknown>): void;
}

export interface SettingsService {
  get(): Settings;
  /** ממזג, מאמת מול SettingsSchema ושומר אטומית. זורק שגיאה עם הודעה בעברית אם לא תקין. */
  update(patch: SettingsPatch): Settings;
  onChange(listener: (settings: Settings) => void): () => void;
}

export interface SecretService {
  /** מחזיר את הערך לשימוש פנימי ב-main בלבד. לעולם לא נשלח ל-renderer. */
  get(name: SecretName): string | null;
  set(name: SecretName, value: string): void;
  clear(name: SecretName): void;
  status(): SecretsStatus;
}

/* ------------------------------------------------------------------ */
/* אחסון (SQLite). ממשקים שמאפשרים להוסיף סנכרון ענן בהמשך.            */
/* ------------------------------------------------------------------ */

export interface TaskRepository {
  create(input: { title: string; notes?: string | null; dueDate?: string | null; source: InputSource | 'tool' }): TaskDTO;
  /** today = משימות פתוחות שתאריך היעד שלהן היום או קודם, או בלי תאריך. todayLocal בפורמט YYYY-MM-DD. */
  list(filter: 'today' | 'open' | 'all', todayLocal: string): TaskDTO[];
  get(id: string): TaskDTO | null;
  /** מסמן כבוצע. מחזיר null אם לא נמצא. פעולה אידמפוטנטית. */
  complete(id: string): TaskDTO | null;
  /** חיפוש משימות פתוחות לפי טקסט (התאמה מנורמלת, עברית/אנגלית). */
  search(query: string): TaskDTO[];
  /**
   * משימה פתוחה עם אותה כותרת (מנורמלת) ואותו תאריך יעד — למניעת כפילות לפי המצב בפועל, לא לפי יומן פעולות.
   * אופציונלי: מימושי mock יכולים לוותר, והכלים חוזרים ל-list().
   */
  findOpenExact?(titleNorm: string, dueDate: string | null): TaskDTO | null;
  /** משימה סגורה (done/cancelled) עם בדיוק אותה כותרת — כדי לענות "כבר בוצעה" במקום לנחש משימה דומה. */
  findClosedExact?(titleNorm: string): TaskDTO | null;
}

export interface ReminderRepository {
  create(input: { text: string; dueAtUtc: string; timezone: string; dueLocal_he: string }): ReminderDTO;
  list(filter: 'upcoming' | 'missed' | 'all'): ReminderDTO[];
  get(id: string): ReminderDTO | null;
  cancel(id: string): ReminderDTO | null;
  search(query: string): ReminderDTO[];
  /** תזכורות בסטטוס scheduled שמועדן <= nowUtc. */
  dueScheduled(nowUtcIso: string): ReminderDTO[];
  /** מעבר אטומי scheduled -> fired. מחזיר true רק למי שביצע את המעבר (מונע התראה כפולה). */
  markFired(id: string, firedAtUtcIso: string): boolean;
  /** מעבר אטומי scheduled -> missed. */
  markMissed(id: string): boolean;
  /** missed/fired -> acknowledged. */
  acknowledge(ids: string[]): number;
  listMissedUnacknowledged(): ReminderDTO[];
  /** תזכורת מתוזמנת עם אותו טקסט ואותו מועד (מניעת כפילות לפי המצב בפועל). אופציונלי כמו ב-TaskRepository. */
  findScheduledExact?(textNorm: string, dueAtUtc: string): ReminderDTO | null;
  /** תזכורת שכבר הופעלה/סומנה/בוטלה עם בדיוק אותו טקסט. */
  findClosedExact?(textNorm: string): ReminderDTO | null;
  /** תזכורות בסטטוס fired שהופעלו מ-sinceIso והלאה (להצגה מחדש כשהממשק נטען אחרי שהן הופעלו). */
  firedSince?(sinceIso: string): ReminderDTO[];
}

export interface HistoryEntry {
  turnId: string;
  role: 'user' | 'assistant';
  text: string;
  mode: 'ai' | 'local';
  createdAt: string;
}

export interface HistoryRepository {
  append(entry: HistoryEntry): void;
  /** כל רשומות התור (שאלה + תשובה) בטרנזקציה אחת — בלי תור "חצי שמור" אם התהליך נופל באמצע. */
  appendTurn?(entries: readonly HistoryEntry[]): void;
  recent(limitTurns: number): HistoryEntry[];
  prune(retentionDays: number, now: Date): number;
  clear(): void;
}

export interface ActionLogEntry {
  id: string;
  turnId: string;
  tool: string;
  paramsHash: string;
  status: ActionRecord['status'];
  summary: string;
  createdAt: string;
}

export interface ActionLogRepository {
  record(entry: ActionLogEntry): void;
  /** הפעולה המוצלחת האחרונה עם אותו כלי ואותו hash של פרמטרים מאז sinceIso. */
  findRecentSuccess(tool: string, paramsHash: string, sinceIso: string): ActionLogEntry | null;
  /** מחיקת רשומות ישנות מ-olderThanIso (היומן משמש רק למניעת כפילות קצרת טווח). */
  prune?(olderThanIso: string): number;
  clear(): void;
}

export interface UsageEntry {
  provider: string;
  kind: 'llm' | 'vision' | 'stt' | 'tts';
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  audioSeconds?: number;
  characters?: number;
  createdAt: string;
}

export interface UsageRepository {
  record(entry: UsageEntry): void;
  summary(now: Date): UsageSummaryRow[];
  clear(): void;
}

export interface Database {
  tasks: TaskRepository;
  reminders: ReminderRepository;
  history: HistoryRepository;
  actions: ActionLogRepository;
  usage: UsageRepository;
  close(): void;
}

/* ------------------------------------------------------------------ */
/* כלים                                                                 */
/* ------------------------------------------------------------------ */

export interface ToolContext {
  turnId: string;
  actionId: string;
  signal: AbortSignal;
  settings: Settings;
  now: Date;
  /** הפעולה הוזנקה ישירות ע"י המשתמש (כפתור), לא ע"י המודל. */
  userInitiated: boolean;
  /** לצילום מסך: המסך שאושר. */
  approvedDisplayId?: string;
  /** מאפשר לכלי לדווח שלבי ביניים (למשל "מצלם" / "שולח"). */
  emit(event: AssistantEvent): void;
}

export type ToolRisk =
  /** קריאה בלבד — ללא אישור. */
  | 'read'
  /** שינוי מקומי הפיך / פתיחת תוכנה מאושרת — ללא אישור כשהבקשה ברורה. */
  | 'low'
  /** פרטיות (צילום מסך) — אישור לפי הגדרה. */
  | 'privacy'
  /** לא קיים ב-V1. מוגדר כדי שכל כלי עתידי כזה יחייב אישור מפורש. */
  | 'high';

export interface ToolDefinition<I = unknown> {
  name: ToolName;
  /** תיאור באנגלית למודל (כולל דוגמאות בעברית). */
  description: string;
  /** סכמה מלאה (עם מגבלות) לאימות מקומי. חייבת להיות z.object(...).strict(). */
  inputSchema: z.ZodType<I>;
  risk: ToolRisk;
  /** האם לכלי יש תופעת לוואי (רלוונטי למניעת כפילות ולסימון "נגוע"). */
  sideEffect: boolean;
  /** חלון זמן שבו קריאה זהה (אותם פרמטרים) תיחשב כפולה ולא תבוצע שוב. 0 = רק בתוך אותו תור. */
  dedupeWindowMs: number;
  /** כותרת קצרה בעברית ל-HUD. */
  title(input: I, settings: Settings): string;
  /** טקסט אישור (חובה ל-privacy/high, ולכל כלי עם תופעת לוואי בתור "נגוע"). */
  describeForApproval(input: I, settings: Settings): { action_he: string; target_he: string; impact_he: string };
  execute(input: I, ctx: ToolContext): Promise<ToolResult>;
}

/* ------------------------------------------------------------------ */
/* שירותים מקומיים                                                     */
/* ------------------------------------------------------------------ */

export interface LaunchOutcome {
  ok: boolean;
  method: 'spawn' | 'shell-open-path' | 'shell-open-external';
  errorCode?: ErrorCode;
  message_he: string;
  pid?: number;
}

/** מתאם מערכת ההפעלה — מוזרק כדי שבדיקות לא יפתחו תוכנות אמיתיות. */
export interface OsLauncherAdapter {
  /** spawn בלי shell, עם ארגומנטים שהמשתמש הגדיר בלבד. נפתר כשהתהליך התחיל או נכשל. */
  spawnDetached(file: string, args: string[], cwd: string): Promise<{ ok: boolean; pid?: number; error?: string }>;
  /** shell.openPath — פותח קובץ/תיקייה עם התוכנה המשויכת. מחזיר '' בהצלחה או הודעת שגיאה. */
  openPath(path: string): Promise<string>;
  /** shell.openExternal — רק לסכמות URI מאושרות. */
  openExternal(uri: string): Promise<void>;
}

export interface LauncherService {
  openApplication(query: { app_id?: string; app_name?: string }, settings: Settings): Promise<ToolResult>;
  openProject(query: { project_id?: string; project_name?: string }, settings: Settings): Promise<ToolResult>;
  validatePath(path: string, expected: 'exe' | 'shortcut' | 'uri' | 'eplan' | 'file' | 'folder'): Promise<PathValidation>;
  detectApps(): Promise<AppCandidate[]>;
}

export interface SystemStatusService {
  getStatus(): Promise<SystemStatus>;
  reportBattery(report: BatteryReport): void;
  setServiceStatus(status: ServiceStatus): void;
  start(): void;
  stop(): void;
}

export interface CapturedImage {
  /** PNG או JPEG בזיכרון בלבד. לא נכתב לדיסק. */
  data: Buffer;
  mediaType: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
  display: DisplayInfo;
}

export interface ScreenCaptureService {
  listDisplays(): DisplayInfo[];
  capture(displayId: string, maxLongEdgePx: number): Promise<CapturedImage>;
}

/* ------------------------------------------------------------------ */
/* AI וקול                                                              */
/* ------------------------------------------------------------------ */

export class ProviderError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly message_he: string,
    public readonly retryable: boolean,
    options?: { cause?: unknown },
  ) {
    super(`${code}: ${message_he}`, options);
    this.name = 'ProviderError';
  }
}

export interface SttProvider {
  readonly id: string;
  isConfigured(): boolean;
  transcribe(input: { wav: Uint8Array; durationMs: number; vocabularyHint: string; signal: AbortSignal }): Promise<string>;
}

export interface TtsProvider {
  readonly id: string;
  isConfigured(): boolean;
  synthesize(input: { text: string; signal: AbortSignal }): Promise<{ audio: Uint8Array; mimeType: string }>;
}

export interface VisionAnalyzer {
  isConfigured(): boolean;
  /** קריאת vision נפרדת, בלי כלים. מחזיר טקסט ניתוח בעברית. */
  analyze(input: { image: CapturedImage; question: string; signal: AbortSignal }): Promise<string>;
}

/* ------------------------------------------------------------------ */
/* מנוע השיחה ואישורים                                                 */
/* ------------------------------------------------------------------ */

export interface ApprovalService {
  /** יוצר בקשת אישור חד-פעמית שקשורה לכלי + hash של הפרמטרים, ופוקעת. */
  request(input: {
    turnId: string;
    actionId: string;
    tool: ToolName;
    params: unknown;
    texts: { action_he: string; target_he: string; impact_he: string };
    reason: ApprovalRequest['reason'];
    warning_he?: string;
    displays?: DisplayInfo[];
    defaultDisplayId?: string;
    signal: AbortSignal;
  }): Promise<{ approvalId: string; approved: boolean; outcome: 'approved' | 'rejected' | 'expired' | 'cancelled'; displayId?: string }>;
  /** החלטת המשתמש מה-renderer. מאמת: קיים, לא נוצל, לא פג, ו-displayId (אם יש) מתוך הרשימה. */
  decide(decision: ApprovalDecision): { ok: boolean; code?: ErrorCode; message_he?: string };
  /** בודק שהאישור שנוצל שייך בדיוק לאותו כלי ולאותם פרמטרים. */
  verifyBinding(approvalId: string, tool: ToolName, params: unknown): boolean;
  pending(): ApprovalRequest[];
  cancelTurn(turnId: string): void;
}

export interface ConversationEngine {
  submit(input: { text: string; source: InputSource; clientRequestId: string }): Promise<
    { ok: true; turnId: string; mode: 'ai' | 'local' } | { ok: false; code: ErrorCode; message_he: string }
  >;
  analyzeScreen(input: { question?: string; displayId?: string; clientRequestId: string }): Promise<
    { ok: true; turnId: string; mode: 'ai' | 'local' } | { ok: false; code: ErrorCode; message_he: string }
  >;
  cancel(turnId?: string): boolean;
  snapshot(): AssistantSnapshot;
}

/** אירועים יוצאים ל-renderer. main.ts מחבר את זה ל-webContents.send. */
export type EventSink = (event: AssistantEvent) => void;

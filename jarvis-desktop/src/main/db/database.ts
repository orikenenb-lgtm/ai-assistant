import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type {
  ActionLogRepository,
  Clock,
  Database,
  HistoryRepository,
  ReminderRepository,
  TaskRepository,
} from '../core/contracts';
import { createActionLogRepository, type ActionLogRepositoryExtras } from './action-log-repository';
import { createHistoryRepository, type HistoryRepositoryExtras } from './history-repository';
import { MigrationError, runMigrations } from './migrations';
import { createReminderRepository, type ReminderRepositoryExtras } from './reminders-repository';
import { isBusyError, isCorruptionError, runSql } from './sql';
import { createTaskRepository, type TaskRepositoryExtras } from './tasks-repository';
import { createUsageRepository } from './usage-repository';

/**
 * פתיחת מסד הנתונים המקומי (SQLite מובנה ב-Node/Electron — node:sqlite, בלי מודול native נוסף).
 * הקובץ יושב בתיקיית userData (למשל C:\Users\<user>\AppData\Roaming\JARVIS\jarvis.db).
 * WAL לעמידות בקריסה/כיבוי פתאומי, foreign_keys, busy_timeout לחיבור מקביל, ומיגרציות ממוספרות.
 */

export interface OpenDatabaseDeps {
  clock: Clock;
  idFactory?: () => string;
}

/**
 * Database של החוזה + העזרים הנוספים שהמימוש הזה מספק (עד שיתווספו ל-contracts.ts).
 * ניתן להשמה ל-Database, כך שקוד שמצפה לחוזה בלבד לא מושפע.
 */
export interface DataDatabase extends Database {
  tasks: TaskRepository & TaskRepositoryExtras;
  reminders: ReminderRepository & ReminderRepositoryExtras;
  history: HistoryRepository & HistoryRepositoryExtras;
  actions: ActionLogRepository & ActionLogRepositoryExtras;
}

/** BUSY = הקובץ נעול ע"י תהליך אחר (למשל מופע קודם שעוד נסגר) — זמני, שווה לנסות שוב. */
export type DatabaseOpenErrorCode = 'CORRUPT' | 'NEWER_SCHEMA' | 'MIGRATION_FAILED' | 'BUSY' | 'IO';

/** שגיאת פתיחה עם הודעה בעברית למשתמש. */
export class DatabaseOpenError extends Error {
  constructor(
    public readonly code: DatabaseOpenErrorCode,
    public readonly message_he: string,
    options?: { cause?: unknown },
  ) {
    super(message_he, options);
    this.name = 'DatabaseOpenError';
  }
}

function isInMemory(filePath: string): boolean {
  return filePath === ':memory:' || filePath === '';
}

/** מיוצא לבדיקות. */
export function applyPragmas(db: DatabaseSync, inMemory: boolean): void {
  // busy_timeout ראשון — כדי שגם המעבר ל-WAL ימתין לנעילה של חיבור אחר במקום להיכשל מיד
  runSql(db, 'PRAGMA busy_timeout = 3000');
  // WAL לא רלוונטי לזיכרון; בקובץ — כתיבה עמידה ומהירה, וקוראים לא חוסמים כותבים
  if (!inMemory) runSql(db, 'PRAGMA journal_mode = WAL');
  runSql(db, 'PRAGMA foreign_keys = ON');
  // FULL ולא NORMAL: ב-WAL עם NORMAL, טרנזקציה שאושרה ממש לפני הפסקת חשמל עלולה להיעלם.
  // נפח הכתיבה זעיר (משימה/תזכורת בודדת), ותזכורת ש-JARVIS כבר הקריא "קבעתי" חייבת לשרוד.
  runSql(db, 'PRAGMA synchronous = FULL');
}

/** ממפה שגיאת פתיחה לקוד + הודעה בעברית. מיוצא לבדיקות. */
export function toOpenError(err: unknown): DatabaseOpenError {
  if (err instanceof DatabaseOpenError) return err;
  const cause = err instanceof MigrationError ? err.cause : err;
  const corrupt = isCorruptionError(err) || isCorruptionError(cause);
  if (corrupt) {
    return new DatabaseOpenError(
      'CORRUPT',
      'קובץ הנתונים של JARVIS (משימות ותזכורות) פגום ולא ניתן לפתוח אותו. הקובץ לא נמחק.',
      { cause: err },
    );
  }
  if (isBusyError(err) || isBusyError(cause)) {
    return new DatabaseOpenError(
      'BUSY',
      'קובץ הנתונים של JARVIS (משימות ותזכורות) נעול כרגע על ידי תהליך אחר. נסה שוב בעוד רגע.',
      { cause: err },
    );
  }
  if (err instanceof MigrationError) {
    return new DatabaseOpenError(err.code === 'NEWER_SCHEMA' ? 'NEWER_SCHEMA' : 'MIGRATION_FAILED', err.message_he, {
      cause: err,
    });
  }
  return new DatabaseOpenError('IO', 'לא הצלחתי לפתוח את קובץ הנתונים של JARVIS (משימות ותזכורות).', { cause: err });
}

/**
 * פותח (ויוצר אם צריך) את מסד הנתונים ומחזיר את כל המאגרים.
 * זורק DatabaseOpenError עם message_he כשהקובץ פגום, מגרסה חדשה יותר, או לא נגיש.
 */
export function openDatabase(filePath: string, deps: OpenDatabaseDeps): DataDatabase {
  const inMemory = isInMemory(filePath);
  const idFactory = deps.idFactory ?? (() => randomUUID());
  let raw: DatabaseSync | null = null;
  try {
    if (!inMemory) mkdirSync(dirname(filePath), { recursive: true });
    raw = new DatabaseSync(inMemory ? ':memory:' : filePath);
    applyPragmas(raw, inMemory);
    runMigrations(raw);

    const db = raw;
    const repoDeps = { clock: deps.clock, idFactory };
    const tasks = createTaskRepository(db, repoDeps);
    const reminders = createReminderRepository(db, repoDeps);
    const history = createHistoryRepository(db, repoDeps);
    const actions = createActionLogRepository(db, repoDeps);
    const usage = createUsageRepository(db, repoDeps);
    let closed = false;

    return {
      tasks,
      reminders,
      history,
      actions,
      usage,
      close() {
        if (closed) return;
        closed = true;
        try {
          db.close();
        } catch {
          // כבר סגור — אין מה לעשות
        }
      },
    };
  } catch (err) {
    try {
      raw?.close();
    } catch {
      // החיבור לא נפתח עד הסוף
    }
    throw toOpenError(err);
  }
}

/** שגיאות פתיחה זמניות שכדאי לנסות שוב (לא CORRUPT / NEWER_SCHEMA / MIGRATION_FAILED — אלה לא ישתנו). */
export function isRetryableOpenError(err: DatabaseOpenError): boolean {
  return err.code === 'BUSY' || err.code === 'IO';
}

export interface OpenDatabaseRetryOptions {
  /** מספר הניסיונות הכולל (כולל הראשון). ברירת מחדל 3. */
  attempts?: number;
  /** המתנה בין ניסיונות. ברירת מחדל 500ms. */
  delayMs?: number;
  /** מוזרק בבדיקות. ברירת מחדל setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /** נקרא לפני כל ניסיון חוזר (ללוג). */
  onRetry?: (info: { attempt: number; error: DatabaseOpenError }) => void;
  /** מוזרק בבדיקות. ברירת מחדל openDatabase. */
  open?: (filePath: string, deps: OpenDatabaseDeps) => DataDatabase;
}

const DEFAULT_OPEN_ATTEMPTS = 3;
const DEFAULT_OPEN_DELAY_MS = 500;

/**
 * openDatabase עם ניסיונות חוזרים על שגיאות זמניות (BUSY / IO — למשל מופע קודם שעוד משחרר את הקובץ,
 * או אנטי-וירוס שנועל אותו לרגע בהפעלה). קובץ פגום או מגרסה חדשה נזרקים מיד, בלי לחכות.
 * זורק את DatabaseOpenError האחרון אם כל הניסיונות נכשלו.
 */
export async function openDatabaseWithRetry(
  filePath: string,
  deps: OpenDatabaseDeps,
  options: OpenDatabaseRetryOptions = {},
): Promise<DataDatabase> {
  const attempts =
    options.attempts !== undefined && Number.isFinite(options.attempts)
      ? Math.max(1, Math.floor(options.attempts))
      : DEFAULT_OPEN_ATTEMPTS;
  const delayMs =
    options.delayMs !== undefined && Number.isFinite(options.delayMs) ? Math.max(0, options.delayMs) : DEFAULT_OPEN_DELAY_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const open = options.open ?? openDatabase;
  for (let attempt = 1; ; attempt++) {
    try {
      return open(filePath, deps);
    } catch (err) {
      const error = toOpenError(err);
      if (!isRetryableOpenError(error) || attempt >= attempts) throw error;
      try {
        options.onRetry?.({ attempt, error });
      } catch {
        // לוג שנכשל לא מפיל את הפתיחה
      }
      await sleep(delayMs);
    }
  }
}

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { Clock, Database } from '../core/contracts';
import { createActionLogRepository } from './action-log-repository';
import { createHistoryRepository } from './history-repository';
import { MigrationError, runMigrations } from './migrations';
import { createReminderRepository } from './reminders-repository';
import { isCorruptionError, runSql } from './sql';
import { createTaskRepository } from './tasks-repository';
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

export type DatabaseOpenErrorCode = 'CORRUPT' | 'NEWER_SCHEMA' | 'MIGRATION_FAILED' | 'IO';

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

function applyPragmas(db: DatabaseSync, inMemory: boolean): void {
  // WAL לא רלוונטי לזיכרון; בקובץ — כתיבה עמידה ומהירה, וקוראים לא חוסמים כותבים
  if (!inMemory) runSql(db, 'PRAGMA journal_mode = WAL');
  runSql(db, 'PRAGMA foreign_keys = ON');
  runSql(db, 'PRAGMA busy_timeout = 3000');
  runSql(db, 'PRAGMA synchronous = NORMAL');
}

function toOpenError(err: unknown): DatabaseOpenError {
  if (err instanceof DatabaseOpenError) return err;
  const corrupt = isCorruptionError(err) || (err instanceof MigrationError && isCorruptionError(err.cause));
  if (corrupt) {
    return new DatabaseOpenError(
      'CORRUPT',
      'קובץ הנתונים של JARVIS (משימות ותזכורות) פגום ולא ניתן לפתוח אותו. הקובץ לא נמחק.',
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
export function openDatabase(filePath: string, deps: OpenDatabaseDeps): Database {
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

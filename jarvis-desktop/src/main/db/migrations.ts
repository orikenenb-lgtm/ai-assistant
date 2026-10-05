import type { DatabaseSync } from 'node:sqlite';
import { num, runSql, type Row } from './sql';

/**
 * מיגרציות סכמה ממוספרות. הגרסה הנוכחית נשמרת ב-PRAGMA user_version,
 * וכל מיגרציה רצה בטרנזקציה אחת יחד עם עדכון הגרסה — או שהכול נכנס, או ששום דבר לא.
 * לעולם לא משנים מיגרציה קיימת; שינוי סכמה = מיגרציה חדשה בסוף הרשימה.
 *
 * העמודות updated_at ו-deleted קיימות כדי שמתאם סנכרון עתידי (Supabase, V2)
 * יוכל לעבוד ב-last-write-wins עם tombstones — ראה sync.ts.
 */

export interface Migration {
  version: number;
  description: string;
  /** פקודות DDL, כל אחת בנפרד (prepare מריץ פקודה אחת בכל פעם). */
  statements: readonly string[];
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    description: 'initial schema: tasks, reminders, history, action_log, usage',
    statements: [
      `CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        title_norm TEXT NOT NULL,
        notes TEXT,
        due_date TEXT,
        status TEXT NOT NULL CHECK (status IN ('open', 'done', 'cancelled')),
        source TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        deleted INTEGER NOT NULL DEFAULT 0
      )`,
      'CREATE INDEX idx_tasks_status_due ON tasks (status, due_date)',
      'CREATE INDEX idx_tasks_updated ON tasks (updated_at)',

      `CREATE TABLE reminders (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        text_norm TEXT NOT NULL,
        due_at_utc TEXT NOT NULL,
        timezone TEXT NOT NULL,
        due_local_he TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('scheduled', 'fired', 'missed', 'cancelled', 'acknowledged')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        fired_at TEXT,
        deleted INTEGER NOT NULL DEFAULT 0
      )`,
      'CREATE INDEX idx_reminders_status_due ON reminders (status, due_at_utc)',
      'CREATE INDEX idx_reminders_updated ON reminders (updated_at)',

      `CREATE TABLE history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        turn_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        text TEXT NOT NULL,
        mode TEXT NOT NULL CHECK (mode IN ('ai', 'local')),
        created_at TEXT NOT NULL
      )`,
      'CREATE INDEX idx_history_turn ON history (turn_id)',
      'CREATE INDEX idx_history_created ON history (created_at)',

      `CREATE TABLE action_log (
        id TEXT PRIMARY KEY,
        turn_id TEXT NOT NULL,
        tool TEXT NOT NULL,
        params_hash TEXT NOT NULL,
        status TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      )`,
      'CREATE INDEX idx_action_log_dedupe ON action_log (tool, params_hash, created_at)',

      `CREATE TABLE usage (
        id INTEGER PRIMARY KEY,
        provider TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('llm', 'vision', 'stt', 'tts')),
        model TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        audio_seconds REAL NOT NULL DEFAULT 0,
        characters INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )`,
      'CREATE INDEX idx_usage_created ON usage (created_at)',
    ],
  },
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS.reduce((max, m) => Math.max(max, m.version), 0);

/** שגיאה בהרצת מיגרציה / גרסת סכמה לא נתמכת. */
export class MigrationError extends Error {
  constructor(
    public readonly code: 'NEWER_SCHEMA' | 'MIGRATION_FAILED' | 'BAD_MIGRATIONS',
    public readonly message_he: string,
    options?: { cause?: unknown },
  ) {
    super(message_he, options);
    this.name = 'MigrationError';
  }
}

export function readUserVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as Row | undefined;
  return row ? num(row, 'user_version') : 0;
}

/**
 * מריץ את כל המיגרציות שגרסתן גבוהה מהגרסה הנוכחית, כל אחת בטרנזקציה נפרדת.
 * מחזיר את הגרסה הסופית. קובץ מגרסה חדשה יותר של JARVIS — נדחה (לא נוגעים בו).
 */
export function runMigrations(db: DatabaseSync, migrations: readonly Migration[] = MIGRATIONS): number {
  const sorted = [...migrations].sort((a, b) => a.version - b.version);
  sorted.forEach((m, i) => {
    // גרסאות חייבות להיות 1,2,3... — כך PRAGMA user_version מקבל תמיד מספר שלם שבא מהקוד, לא מקלט
    if (!Number.isInteger(m.version) || m.version !== i + 1) {
      throw new MigrationError('BAD_MIGRATIONS', 'רשימת המיגרציות של מסד הנתונים לא תקינה.');
    }
  });
  const latest = sorted.length;
  let current = readUserVersion(db);
  if (current > latest) {
    throw new MigrationError(
      'NEWER_SCHEMA',
      'קובץ הנתונים נוצר בגרסה חדשה יותר של JARVIS. עדכן את JARVIS לגרסה האחרונה כדי לפתוח אותו.',
    );
  }
  for (const m of sorted) {
    if (m.version <= current) continue;
    runSql(db, 'BEGIN IMMEDIATE');
    try {
      for (const statement of m.statements) runSql(db, statement);
      // PRAGMA לא מקבל פרמטרים קשורים; הערך הוא מספר שלם שאומת למעלה ומגיע מהקוד בלבד
      runSql(db, `PRAGMA user_version = ${m.version}`);
      runSql(db, 'COMMIT');
      current = m.version;
    } catch (err) {
      try {
        if (db.isTransaction) runSql(db, 'ROLLBACK');
      } catch {
        // מתעלמים — השגיאה המקורית נזרקת למטה
      }
      throw new MigrationError('MIGRATION_FAILED', `עדכון מבנה קובץ הנתונים (גרסה ${m.version}) נכשל. הנתונים הקיימים לא שונו.`, {
        cause: err,
      });
    }
  }
  return current;
}

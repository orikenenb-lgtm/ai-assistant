import type { DatabaseSync } from 'node:sqlite';

/**
 * עזרים משותפים לשכבת ה-SQLite: קריאת עמודות בבטחה, טרנזקציות וזיהוי קובץ פגום.
 * כל הערכים נכנסים ל-SQL רק כפרמטרים קשורים (?), אף פעם לא בשרשור מחרוזות.
 */

/** שורה כפי ש-node:sqlite מחזיר אותה. */
export type Row = Record<string, unknown>;

export function str(row: Row, key: string): string {
  const v = row[key];
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  throw new Error(`שורה פגומה במסד הנתונים: חסרה העמודה "${key}"`);
}

export function strOrNull(row: Row, key: string): string | null {
  const v = row[key];
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  return null;
}

export function num(row: Row, key: string): number {
  const v = row[key];
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** מספר השורות שהשתנו (node:sqlite מחזיר number או bigint). */
export function changes(result: { changes: number | bigint }): number {
  return typeof result.changes === 'bigint' ? Number(result.changes) : result.changes;
}

/**
 * הרצת פקודת SQL אחת בלי פרמטרים (PRAGMA / BEGIN / COMMIT / DDL) דרך prepare.
 * לא משתמשים ב-db.exec — כלל ה-lint בפרויקט אוסר כל קריאה בשם exec, וכך גם אין
 * אפשרות להריץ כמה פקודות משורשרות במחרוזת אחת.
 */
export function runSql(db: DatabaseSync, sql: string): void {
  db.prepare(sql).run();
}

/**
 * מריץ fn בתוך טרנזקציה (BEGIN IMMEDIATE — נועל כתיבה מיד, כך שאין deadlock בין שני חיבורים).
 * שגיאה => ROLLBACK וזריקה הלאה. טרנזקציה מקוננת פשוט רצה בתוך החיצונית.
 */
export function withTransaction<T>(db: DatabaseSync, fn: () => T): T {
  if (db.isTransaction) return fn();
  runSql(db, 'BEGIN IMMEDIATE');
  try {
    const out = fn();
    runSql(db, 'COMMIT');
    return out;
  } catch (err) {
    try {
      if (db.isTransaction) runSql(db, 'ROLLBACK');
    } catch {
      // ה-ROLLBACK עצמו נכשל (למשל החיבור נסגר) — השגיאה המקורית חשובה יותר
    }
    throw err;
  }
}

/** קוד השגיאה הבסיסי של SQLite (בלי ה-extended bits). */
export function sqliteErrcode(err: unknown): number | null {
  if (err && typeof err === 'object' && 'errcode' in err) {
    const code = (err as { errcode: unknown }).errcode;
    if (typeof code === 'number') return code & 0xff;
  }
  return null;
}

const SQLITE_BUSY = 5;
const SQLITE_LOCKED = 6;
const SQLITE_CORRUPT = 11;
const SQLITE_NOTADB = 26;

/** האם השגיאה היא נעילה זמנית (חיבור/תהליך אחר מחזיק את הקובץ) — שווה לנסות שוב. */
export function isBusyError(err: unknown): boolean {
  const code = sqliteErrcode(err);
  return code === SQLITE_BUSY || code === SQLITE_LOCKED;
}

/** האם השגיאה מעידה שהקובץ פגום או שאינו מסד נתונים. */
export function isCorruptionError(err: unknown): boolean {
  const code = sqliteErrcode(err);
  return code === SQLITE_CORRUPT || code === SQLITE_NOTADB;
}

/** חותמת זמן אחידה (ISO UTC, 24 תווים) — חשוב כי משווים מחרוזות זמן ב-SQL לפי סדר מילוני. */
export function normalizeIso(value: string, fallback: Date): string {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : fallback.toISOString();
}

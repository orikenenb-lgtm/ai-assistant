import { appendFileSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Clock, Logger, LogLevel } from '../core/contracts';

/**
 * לוגר JSONL עם צמצום מידע אישי:
 * - מפתחות/טוקנים מוסתרים (לפי שם שדה ולפי תבנית ערך).
 * - נתיבי משתמש ב-Windows מקוצרים (C:\Users\<user>\...).
 * - טקסט חופשי (תמלולים, בקשות, תשובות) לא נרשם, אלא אם המשתמש הפעיל "לוג מפורט".
 * קובץ לכל יום, ושמירה של 7 ימים אחרונים.
 */

const SECRET_KEY_RE = /(api[_-]?key|token|secret|password|authorization|access[_-]?key|cookie)/i;
const FREE_TEXT_KEY_RE = /^(text|transcript|prompt|question|answer|reply|content|summary_he|body)$/i;
const SECRET_VALUE_RES: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{8,}/g,
  /sk-[A-Za-z0-9_-]{16,}/g,
  /Bearer\s+[A-Za-z0-9._-]{8,}/gi,
  /\b[A-Fa-f0-9]{32,}\b/g,
  /\b[A-Za-z0-9+/]{40,}={0,2}/g,
];
const USER_PATH_RE = /([A-Za-z]:\\Users\\)[^\\/\s"']+/g;
const POSIX_HOME_RE = /(\/home\/|\/Users\/)[^/\s"']+/g;
const MAX_STRING = 300;
const RETENTION_DAYS = 7;

export function redactString(value: string): string {
  let out = value;
  for (const re of SECRET_VALUE_RES) out = out.replace(re, '[REDACTED]');
  out = out.replace(USER_PATH_RE, '$1<user>').replace(POSIX_HOME_RE, '$1<user>');
  if (out.length > MAX_STRING) out = `${out.slice(0, MAX_STRING)}…(${out.length} chars)`;
  return out;
}

export function redact(value: unknown, verbose: boolean, depth = 0, keyName = ''): unknown {
  if (depth > 5) return '[depth]';
  if (keyName && SECRET_KEY_RE.test(keyName)) return '[REDACTED]';
  if (typeof value === 'string') {
    if (!verbose && keyName && FREE_TEXT_KEY_RE.test(keyName)) return `[text:${value.length} chars]`;
    return redactString(value);
  }
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message) };
  }
  if (value instanceof Uint8Array) return `[bytes:${value.byteLength}]`;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, verbose, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redact(v, verbose, depth + 1, k);
    }
    return out;
  }
  return value;
}

export interface FileLoggerOptions {
  dir: string;
  clock: Clock;
  isVerbose: () => boolean;
  mirrorToConsole: boolean;
}

export interface FileLogger extends Logger {
  readonly dir: string;
  /** מוחק את כל קובצי הלוג (חלק מ"מחק הכול"). */
  clearAll(): void;
}

export function createFileLogger(options: FileLoggerOptions): FileLogger {
  const { dir, clock } = options;
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    // אם אין אפשרות ליצור תיקייה — נמשיך עם קונסול בלבד
  }
  pruneOldLogs(dir, clock.now());

  const write = (level: LogLevel, event: string, data?: Record<string, unknown>): void => {
    if (level === 'debug' && !options.isVerbose()) return;
    const now = clock.now();
    const line = {
      ts: now.toISOString(),
      level,
      event,
      ...(data ? { data: redact(data, options.isVerbose()) } : {}),
    };
    const json = JSON.stringify(line);
    if (options.mirrorToConsole) {
      const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
      fn(`[jarvis] ${json}`);
    }
    try {
      appendFileSync(join(dir, `jarvis-${now.toISOString().slice(0, 10)}.log`), `${json}\n`, { encoding: 'utf8' });
    } catch {
      // כשל בכתיבת לוג לא מפיל את האפליקציה
    }
  };

  return {
    dir,
    debug: (e, d) => write('debug', e, d),
    info: (e, d) => write('info', e, d),
    warn: (e, d) => write('warn', e, d),
    error: (e, d) => write('error', e, d),
    clearAll: () => {
      try {
        for (const f of readdirSync(dir)) if (f.startsWith('jarvis-') && f.endsWith('.log')) rmSync(join(dir, f), { force: true });
      } catch {
        // אין מה למחוק
      }
    },
  };
}

function pruneOldLogs(dir: string, now: Date): void {
  try {
    const cutoff = now.getTime() - RETENTION_DAYS * 24 * 3600 * 1000;
    for (const f of readdirSync(dir)) {
      if (!f.startsWith('jarvis-') || !f.endsWith('.log')) continue;
      const full = join(dir, f);
      if (statSync(full).mtimeMs < cutoff) rmSync(full, { force: true });
    }
  } catch {
    // לא קריטי
  }
}

/** לוגר שקט לבדיקות. */
export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };

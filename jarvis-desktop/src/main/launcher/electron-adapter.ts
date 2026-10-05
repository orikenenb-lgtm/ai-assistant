/**
 * מתאם מערכת ההפעלה האמיתי (Electron + child_process). זה הקובץ היחיד בתיקייה שמייבא את electron,
 * כדי ששאר שכבת הפתיחה תיבדק בלי Electron.
 *
 * הגנה כפולה: גם אם קורא אחר ישתמש במתאם, הוא לא יריץ shell, לא יפתח URI עם פרמטרים,
 * ו-ב-Windows לא יפעיל נתיב שלא עבר את כללי path-rules.
 */
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { shell, type Shell } from 'electron';
import type { Logger, OsLauncherAdapter } from '../core/contracts';
import { checkWindowsPath, parseAllowedUri, windowsExtension } from './path-rules';

export type SpawnFn = (file: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

export interface ElectronLauncherAdapterOptions {
  /** לבדיקות: עטיפה של spawn (למשל כדי לוודא את האפשרויות). ברירת מחדל: child_process.spawn. */
  spawnImpl?: SpawnFn;
  /** לבדיקות: מימוש של shell. ברירת מחדל: shell של Electron. */
  shellImpl?: Pick<Shell, 'openPath' | 'openExternal'>;
  /** כמה זמן לחכות לאירוע 'spawn' לפני שמדווחים כשל. ברירת מחדל: 5 שניות. */
  startTimeoutMs?: number;
  /** ב-win32 נאכפים כללי נתיב Windows גם כאן. ברירת מחדל: process.platform. */
  platform?: NodeJS.Platform;
  /** סביבת הבסיס לתהליך החדש. ברירת מחדל: process.env (בלי משתנים פנימיים של Electron/Node). */
  env?: NodeJS.ProcessEnv;
  logger?: Logger;
}

export const SPAWN_TIMEOUT_ERROR = 'TIMEOUT';
const DEFAULT_START_TIMEOUT_MS = 5_000;

/**
 * משתנים שאסור להעביר לתוכנה שנפתחת: ELECTRON_RUN_AS_NODE למשל היה גורם לאפליקציות Electron
 * (Discord, Slack, Teams) לעלות כ-Node במקום כאפליקציה; NODE_OPTIONS יכול להזריק קוד.
 */
const STRIPPED_ENV = /^(ELECTRON_[A-Z0-9_]*|NODE_OPTIONS)$/i;

export function sanitizeChildEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined || STRIPPED_ENV.test(key)) continue;
    out[key] = value;
  }
  return out;
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as NodeJS.ErrnoException).code;
    return code && !err.message.includes(code) ? `${code}: ${err.message}` : err.message;
  }
  return typeof err === 'string' ? err : 'unknown error';
}

export function createElectronLauncherAdapter(options: ElectronLauncherAdapterOptions = {}): OsLauncherAdapter {
  const spawnImpl: SpawnFn = options.spawnImpl ?? ((file, args, opts) => spawn(file, args, opts));
  const shellImpl = options.shellImpl ?? shell;
  const startTimeoutMs = options.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS;
  const platform = options.platform ?? process.platform;
  const logger = options.logger;

  function spawnDetached(rawFile: string, args: string[], rawCwd: string): Promise<{ ok: boolean; pid?: number; error?: string }> {
    let file = rawFile;
    let cwd = rawCwd;
    if (platform === 'win32') {
      const checkedFile = checkWindowsPath(rawFile);
      if (!checkedFile.ok || windowsExtension(checkedFile.normalized) !== '.exe') {
        return Promise.resolve({ ok: false, error: 'EINVAL: target is not an absolute .exe path' });
      }
      const checkedCwd = checkWindowsPath(rawCwd);
      if (!checkedCwd.ok) return Promise.resolve({ ok: false, error: 'EINVAL: invalid working directory' });
      // מפעילים בדיוק את מה שנבדק (מנורמל, בלי מרכאות)
      file = checkedFile.normalized;
      cwd = checkedCwd.normalized;
    }
    if (!Array.isArray(args) || args.some((a) => typeof a !== 'string' || a.includes('\0'))) {
      return Promise.resolve({ ok: false, error: 'EINVAL: invalid arguments' });
    }

    return new Promise((resolve) => {
      let settled = false;
      let child: ChildProcess | undefined;
      const timer = setTimeout(() => {
        child?.unref();
        settle({ ok: false, error: SPAWN_TIMEOUT_ERROR });
      }, startTimeoutMs);
      function settle(result: { ok: boolean; pid?: number; error?: string }): void {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      }

      try {
        child = spawnImpl(file, [...args], {
          cwd,
          detached: true,
          stdio: 'ignore',
          // בלי shell: הארגומנטים עוברים כמו שהם, ותווים כמו & | ; לא מתפרשים כפקודות
          shell: false,
          windowsHide: false,
          env: sanitizeChildEnv(options.env ?? process.env),
        });
      } catch (err) {
        // למשל ארגומנט לא חוקי — spawn זורק מיד
        settle({ ok: false, error: describeError(err) });
        return;
      }
      const proc = child;

      // מאזין קבוע: אירוע 'error' בלי מאזין היה מפיל את תהליך main
      proc.on('error', (err) => {
        if (settled) {
          logger?.warn('launcher.child_error_after_settle', { error: describeError(err) });
          return;
        }
        settle({ ok: false, error: describeError(err) });
      });
      proc.once('spawn', () => {
        const pid = proc.pid;
        // התוכנה חיה בנפרד — JARVIS לא מחכה לה ולא מחזיק אותה
        proc.unref();
        if (settled) {
          logger?.warn('launcher.spawn_after_timeout', { pid });
          return;
        }
        settle(typeof pid === 'number' ? { ok: true, pid } : { ok: true });
      });
    });
  }

  async function openPath(rawPath: string): Promise<string> {
    let path = rawPath;
    if (platform === 'win32') {
      const checked = checkWindowsPath(rawPath);
      if (!checked.ok) return 'invalid path';
      path = checked.normalized;
    }
    try {
      return await shellImpl.openPath(path);
    } catch (err) {
      return describeError(err) || 'openPath failed';
    }
  }

  async function openExternal(uri: string): Promise<void> {
    const parsed = parseAllowedUri(uri);
    // רק הצורה הקנונית "<scheme>:" — שום תוספת לא עוברת, גם אם הגיעה מקורא אחר
    if (!parsed.ok) throw new Error(parsed.message_he);
    if (parsed.uri !== uri) throw new Error('URI must be exactly "<scheme>:"');
    await shellImpl.openExternal(parsed.uri);
  }

  return { spawnDetached, openPath, openExternal };
}

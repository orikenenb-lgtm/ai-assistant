/**
 * שירות פתיחת תוכנות ופרויקטים.
 *
 * עקרונות:
 * - פותחים רק רשומות מתוך settings.launcher (רשימה מאושרת). מה שהמודל כתב משמש רק לבחירת רשומה.
 * - מה שנשלח למערכת ההפעלה הוא תמיד ערך מההגדרות, אחרי בדיקת path-rules ובדיקת קיום בדיסק.
 * - exe → spawn בלי shell עם ארגומנטים שהמשתמש הגדיר בלבד; קיצור דרך / פרויקט → shell.openPath;
 *   URI → shell.openExternal רק לצורה "<scheme>:" מהרשימה המותרת.
 * - JARVIS לא כותב לקובצי פרויקט: הפתיחה נעשית ע"י התוכנה ש-Windows משייך לקובץ.
 * - שום פונקציה כאן לא זורקת החוצה — כל כשל חוזר כ-ToolResult עם קוד והודעה בעברית.
 */
import { promises as fsp } from 'node:fs';
import { win32 as winPath } from 'node:path';
import type { AppEntry, ProjectEntry, Settings } from '../../shared/settings-schema';
import type { AppCandidate, ErrorCode, PathValidation, ToolResult } from '../../shared/types';
import type { LaunchOutcome, LauncherService, Logger, OsLauncherAdapter } from '../core/contracts';
import { FORBIDDEN_LAUNCH_TARGETS } from '../settings/settings-store';
import {
  checkExtension,
  checkWindowsPath,
  kindFromExtension,
  looksLikeShortName,
  parseAllowedUri,
  windowsBasenameLower,
} from './path-rules';
import { displaySafe, resolveApp, resolveProject } from './resolve';

export interface StatLike {
  isFile(): boolean;
  isDirectory(): boolean;
}

export interface LauncherServiceDeps {
  adapter: OsLauncherAdapter;
  stat: (p: string) => Promise<StatLike>;
  logger: Logger;
  /** משתני סביבה לזיהוי תוכנות (ProgramFiles, APPDATA). ברירת מחדל: process.env. */
  env?: NodeJS.ProcessEnv;
  /** קריאת תיקייה לזיהוי תוכנות. ברירת מחדל: fs.promises.readdir. */
  readdir?: (p: string) => Promise<string[]>;
  /**
   * פתרון הנתיב האמיתי (קישורים סמליים ושמות 8.3 כמו POWERS~1.EXE) לפני בדיקת הרשימה החסומה.
   * ברירת מחדל: fs.promises.realpath (ב-Windows מחזיר את השם המלא).
   */
  realpath?: (p: string) => Promise<string>;
  /** מערכת ההפעלה (לבדיקות של detectApps על Linux). ברירת מחדל: process.platform. */
  platform?: NodeJS.Platform;
  /** זמן מקסימלי לבדיקת נתיב — כונן רשת מנותק יכול "להיתקע" עשרות שניות. */
  fsTimeoutMs?: number;
}

type Expected = 'exe' | 'shortcut' | 'uri' | 'eplan' | 'file' | 'folder';
type FileExpected = Exclude<Expected, 'uri'>;
type DetectedKind = PathValidation['detectedKind'];

type Inspection =
  | { ok: true; path: string; detectedKind: DetectedKind; warning_he?: string }
  | {
      ok: false;
      code: 'PATH_INVALID' | 'PATH_NOT_FOUND' | 'NOT_ALLOWLISTED';
      reason_he: string;
      exists: boolean;
      detectedKind: DetectedKind;
    };

const DEFAULT_FS_TIMEOUT_MS = 5_000;
const TIMEOUT_CODE = 'JARVIS_FS_TIMEOUT';
const SETTINGS_HINT = 'הגדרות ← תוכנות ופרויקטים';
/** מגבלות סריקה בזיהוי תוכנות — שלא נסרוק עץ תיקיות ענק בטעות. */
const MAX_SCAN_ENTRIES = 40;

function errCode(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = (err as { code: unknown }).code;
    return typeof code === 'string' || typeof code === 'number' ? String(code) : '';
  }
  return '';
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === 'string' ? err : '';
}

/** הבטחה עם מגבלת זמן. דחייה מאוחרת של ההבטחה המקורית נבלעת (אין unhandled rejection). */
function withTimeout<T>(start: () => Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: TIMEOUT_CODE })), ms);
    Promise.resolve()
      .then(start)
      .then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (err: unknown) => {
          clearTimeout(timer);
          reject(err);
        },
      );
  });
}

/** "ל-EPLAN" / "לפרויקט הגמר" — תחילית ל' נכונה לשם עברי או לועזי. */
function withLamed(name: string): string {
  if (/^[א-ת]/.test(name)) {
    // "ל" + "ה" הידיעה מתמזגות: "הפרויקט שלי" → "לפרויקט שלי"
    return `ל${name.startsWith('ה') && name.length > 2 ? name.slice(1) : name}`;
  }
  return `ל-${name}`;
}

function fail(code: ErrorCode, summary_he: string, data?: Record<string, unknown>): ToolResult {
  return { ok: false, status: 'error', error_code: code, summary_he, ...(data ? { data } : {}) };
}

function clarify(summary_he: string, options: Array<{ id: string; label: string }>): ToolResult {
  return { ok: false, status: 'needs_clarification', error_code: 'AMBIGUOUS', summary_he, options };
}

function isEplanApp(entry: AppEntry): boolean {
  return /eplan/i.test(entry.id) || /eplan/i.test(entry.name);
}

/** הסבר בעברית לכשל הפעלה, לפי קוד השגיאה שמערכת ההפעלה החזירה. */
function spawnFailureHint(raw: string): string {
  if (/^TIMEOUT\b/.test(raw)) {
    // לא טוענים שהתוכנה נכשלה — רק שלא קיבלנו אישור בזמן
    return 'לא התקבל אישור שהתוכנה התחילה לפעול תוך 5 שניות. ייתכן שהיא עדיין נפתחת.';
  }
  if (/ENOENT/.test(raw)) return 'Windows לא מצא את קובץ התוכנה.';
  if (/EACCES|EPERM|\b740\b|elevation/i.test(raw)) {
    return 'אין הרשאה להפעיל את התוכנה — ייתכן שהיא דורשת הרשאות מנהל. אפשר להגדיר במקומה קיצור דרך (‎.lnk), ואז Windows יבקש אישור.';
  }
  if (/ENOEXEC|EFTYPE|UNKNOWN/.test(raw)) return 'Windows לא הצליח להריץ את הקובץ — ייתכן שהוא פגום או לא מתאים למחשב הזה.';
  return 'מערכת ההפעלה סירבה להפעיל את התוכנה.';
}

const ASSOCIATION_ERROR = /associat|1155|0x483|NOASSOC|No application|שיוך|משויכ/i;

export function createLauncherService(deps: LauncherServiceDeps): LauncherService {
  const { adapter, logger } = deps;
  const fsTimeoutMs = deps.fsTimeoutMs ?? DEFAULT_FS_TIMEOUT_MS;
  const readdir = deps.readdir ?? ((p: string) => fsp.readdir(p));
  const realpath = deps.realpath ?? ((p: string) => fsp.realpath(p));

  /* ------------------------------ בדיקת נתיבים ------------------------------ */

  /** תוכנות שאסור להפעיל גם אם נרשמו בהגדרות (מעטפות פקודה, מפרשי סקריפטים) — הגנה כפולה. */
  async function checkExecutablePolicy(path: string): Promise<{ ok: true } | { ok: false; reason_he: string }> {
    const names = [windowsBasenameLower(path)];
    let resolved = false;
    try {
      const real = await withTimeout(() => realpath(path), fsTimeoutMs);
      if (typeof real === 'string' && real.length > 0) {
        names.push(windowsBasenameLower(real));
        resolved = true;
      }
    } catch (err) {
      logger.debug('launcher.realpath_failed', { code: errCode(err) });
    }
    for (const name of names) {
      if (FORBIDDEN_LAUNCH_TARGETS.has(name)) {
        return {
          ok: false,
          reason_he: `"${name}" חסום — JARVIS לא מפעיל מעטפות פקודה או מפרשי סקריפטים.`,
        };
      }
    }
    if (!resolved && names.some(looksLikeShortName)) {
      return {
        ok: false,
        reason_he: 'שם הקובץ מקוצר (בסגנון 8.3, למשל PROGRA~1) ולא הצלחתי לזהות את השם המלא. בחר את הקובץ עם כפתור "עיון".',
      };
    }
    return { ok: true };
  }

  /** בדיקה מלאה של נתיב קובץ/תיקייה מההגדרות: כללי Windows, קיום, סוג, סיומת ומדיניות. */
  async function inspectPath(raw: string, expected: FileExpected): Promise<Inspection> {
    const checked = checkWindowsPath(raw);
    if (!checked.ok) {
      return { ok: false, code: 'PATH_INVALID', reason_he: checked.message_he, exists: false, detectedKind: 'unknown' };
    }
    const path = checked.normalized;
    const extKind = kindFromExtension(path);

    let st: StatLike;
    try {
      st = await withTimeout(() => deps.stat(path), fsTimeoutMs);
    } catch (err) {
      const code = errCode(err);
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        return {
          ok: false,
          code: 'PATH_NOT_FOUND',
          reason_he: `${expected === 'folder' ? 'התיקייה לא נמצאה' : 'הקובץ לא נמצא'} בנתיב ${path}.`,
          exists: false,
          detectedKind: expected === 'folder' ? 'folder' : extKind,
        };
      }
      if (code === TIMEOUT_CODE) {
        return {
          ok: false,
          code: 'PATH_NOT_FOUND',
          reason_he: `הנתיב ${path} לא הגיב בזמן (אולי כונן רשת מנותק או מחשב מרוחק כבוי).`,
          exists: false,
          detectedKind: 'unknown',
        };
      }
      if (code === 'EACCES' || code === 'EPERM') {
        return { ok: false, code: 'PATH_INVALID', reason_he: `אין הרשאת גישה לנתיב ${path}.`, exists: true, detectedKind: 'unknown' };
      }
      logger.warn('launcher.stat_failed', { code });
      return {
        ok: false,
        code: 'PATH_INVALID',
        reason_he: `לא הצלחתי לבדוק את הנתיב ${path}${code ? ` (${code})` : ''}.`,
        exists: false,
        detectedKind: 'unknown',
      };
    }

    const isDir = st.isDirectory();
    const isFile = st.isFile();
    const detectedKind: DetectedKind = isDir ? 'folder' : isFile ? extKind : 'unknown';

    if (expected === 'folder') {
      if (!isDir) {
        return { ok: false, code: 'PATH_INVALID', reason_he: 'הנתיב מצביע על קובץ ולא על תיקייה.', exists: true, detectedKind };
      }
      return { ok: true, path, detectedKind };
    }

    const ext = checkExtension(path, expected);
    if (!ext.ok) return { ok: false, code: 'PATH_INVALID', reason_he: ext.message_he, exists: true, detectedKind };
    const warning_he = ext.warning_he;

    if (!isFile) {
      return {
        ok: false,
        code: 'PATH_INVALID',
        reason_he: isDir ? 'הנתיב מצביע על תיקייה ולא על קובץ.' : 'הנתיב אינו קובץ רגיל.',
        exists: true,
        detectedKind,
      };
    }

    if (expected === 'exe') {
      const policy = await checkExecutablePolicy(path);
      if (!policy.ok) return { ok: false, code: 'NOT_ALLOWLISTED', reason_he: policy.reason_he, exists: true, detectedKind };
    }
    return { ok: true, path, detectedKind, ...(warning_he ? { warning_he } : {}) };
  }

  function inspectionFailure(
    insp: Extract<Inspection, { ok: false }>,
    name: string,
    entity: 'app' | 'project',
    data: Record<string, unknown>,
  ): ToolResult {
    switch (insp.code) {
      case 'PATH_NOT_FOUND':
        return fail(
          'PATH_NOT_FOUND',
          `לא מצאתי את ${name}: ${insp.reason_he} ייתכן ש${entity === 'app' ? 'התוכנה הוסרה או הועברה' : 'הקובץ הועבר או נמחק'} — עדכן את הנתיב ב${SETTINGS_HINT}.`,
          data,
        );
      case 'PATH_INVALID':
        return fail('PATH_INVALID', `הנתיב של ${name} בהגדרות לא תקין: ${insp.reason_he} עדכן אותו ב${SETTINGS_HINT}.`, data);
      case 'NOT_ALLOWLISTED':
        return fail('NOT_ALLOWLISTED', `לא פתחתי את ${name}: ${insp.reason_he}`, data);
    }
  }

  /* ------------------------------ תוכנות ------------------------------ */

  function notConfiguredApp(entry: AppEntry): string {
    if (isEplanApp(entry) && entry.kind === 'exe') {
      return `הנתיב ${withLamed(entry.name)} עדיין לא הוגדר. פתח ${SETTINGS_HINT} ובחר את הקובץ EPLAN.exe.`;
    }
    const what =
      entry.kind === 'exe' ? 'את קובץ ה-‎.exe של התוכנה' : entry.kind === 'shortcut' ? 'את קיצור הדרך' : 'כתובת כמו spotify:';
    return `הנתיב ${withLamed(entry.name)} עדיין לא הוגדר. פתח ${SETTINGS_HINT} ו${entry.kind === 'uri' ? 'הזן' : 'בחר'} ${what}.`;
  }

  function appSuccess(entry: AppEntry, method: LaunchOutcome['method'], summary_he: string, pid?: number): ToolResult {
    logger.info('launcher.app_opened', { app_id: entry.id, method });
    return {
      ok: true,
      status: 'success',
      summary_he,
      data: { app_id: entry.id, name: entry.name, method, ...(pid !== undefined ? { pid } : {}) },
    };
  }

  function launchFailed(entry: AppEntry, method: LaunchOutcome['method'], hint_he: string, raw: string): ToolResult {
    logger.warn('launcher.app_failed', { app_id: entry.id, method, error: raw });
    const detail = raw && !/^TIMEOUT$/.test(raw) ? ` (${displaySafe(raw, 160)})` : '';
    return fail('LAUNCH_FAILED', `לא הצלחתי לפתוח את ${entry.name}: ${hint_he}${detail}`, {
      app_id: entry.id,
      name: entry.name,
      method,
    });
  }

  async function launchApp(entry: AppEntry): Promise<ToolResult> {
    const data = { app_id: entry.id, name: entry.name };
    const target = entry.target.trim();
    if (!target) return fail('NOT_CONFIGURED', notConfiguredApp(entry), data);

    if (entry.kind === 'uri') {
      const uri = parseAllowedUri(target);
      if (!uri.ok) return fail('PATH_INVALID', `הכתובת של ${entry.name} בהגדרות לא תקינה: ${uri.message_he}`, data);
      try {
        await adapter.openExternal(uri.uri);
      } catch (err) {
        return launchFailed(
          entry,
          'shell-open-external',
          `Windows לא הצליח לפתוח את הכתובת ${uri.uri} — ודא שהאפליקציה מותקנת.`,
          errMessage(err),
        );
      }
      // אין לנו דרך לוודא שהאפליקציה עצמה עלתה — רק ש-Windows קיבל את הבקשה. לכן הניסוח זהיר.
      return appSuccess(entry, 'shell-open-external', `ביקשתי מ-Windows לפתוח את ${entry.name} (${uri.uri}).`);
    }

    const insp = await inspectPath(target, entry.kind === 'exe' ? 'exe' : 'shortcut');
    if (!insp.ok) return inspectionFailure(insp, entry.name, 'app', data);

    if (entry.kind === 'exe') {
      if (entry.args.length > 0) logger.info('launcher.configured_args', { app_id: entry.id, count: entry.args.length });
      let outcome: { ok: boolean; pid?: number; error?: string };
      try {
        // רק ערכים מההגדרות: הנתיב המנורמל, הארגומנטים שהמשתמש הגדיר (עותק), ותיקיית התוכנה
        outcome = await adapter.spawnDetached(insp.path, [...entry.args], winPath.dirname(insp.path));
      } catch (err) {
        outcome = { ok: false, error: errMessage(err) || errCode(err) };
      }
      if (!outcome.ok) {
        const raw = outcome.error ?? '';
        return launchFailed(entry, 'spawn', spawnFailureHint(raw), raw);
      }
      return appSuccess(entry, 'spawn', `פתחתי את ${entry.name}.`, outcome.pid);
    }

    // קיצור דרך: Windows פותח אותו בעצמו (כולל בקשת הרשאות מנהל אם הקיצור מוגדר כך)
    if (entry.args.length > 0) logger.warn('launcher.args_ignored_for_shortcut', { app_id: entry.id });
    let openError: string;
    try {
      openError = await adapter.openPath(insp.path);
    } catch (err) {
      openError = errMessage(err) || 'שגיאה לא ידועה';
    }
    if (openError) return launchFailed(entry, 'shell-open-path', 'Windows לא הצליח לפתוח את קיצור הדרך.', openError);
    return appSuccess(entry, 'shell-open-path', `פתחתי את ${entry.name}.`);
  }

  async function openApplication(query: { app_id?: string; app_name?: string }, settings: Settings): Promise<ToolResult> {
    const apps = settings.launcher.apps;
    const res = resolveApp(query, apps);
    switch (res.kind) {
      case 'found':
        return launchApp(res.entry);
      case 'ambiguous': {
        const names = res.candidates.map((c) => c.name);
        return clarify(
          `יש כמה תוכנות מתאימות: ${names.join(' / ')}. לאיזו התכוונת?`,
          res.candidates.map((c) => ({ id: c.id, label: c.name })),
        );
      }
      case 'disabled':
        return fail(
          'NOT_ALLOWLISTED',
          `התוכנה ${res.entry.name} מושבתת בהגדרות, ולכן לא פתחתי אותה. אפשר להפעיל אותה מחדש ב${SETTINGS_HINT}.`,
          { app_id: res.entry.id, name: res.entry.name },
        );
      case 'none':
      case 'no-default': {
        const approved = apps.filter((a) => a.enabled).map((a) => a.name);
        const asked = displaySafe(query.app_name || query.app_id);
        logger.info('launcher.app_not_allowlisted', { asked_length: asked.length });
        return fail(
          'NOT_ALLOWLISTED',
          `${asked ? `"${asked}" לא נמצאת` : 'התוכנה לא נמצאת'} ברשימת התוכנות המאושרות, ולכן לא פתחתי כלום. ${
            approved.length ? `אפשר לפתוח: ${approved.join(', ')}.` : 'עדיין לא הוגדרו תוכנות מאושרות.'
          } להוספת תוכנה: ${SETTINGS_HINT}.`,
          { approved_apps: apps.filter((a) => a.enabled).map((a) => ({ id: a.id, name: a.name })) },
        );
      }
    }
  }

  /* ------------------------------ פרויקטים ------------------------------ */

  function projectOption(p: ProjectEntry): { id: string; label: string } {
    const file = p.path.trim() ? winPath.basename(p.path.trim().replace(/^"|"$/g, '')) : '';
    return { id: p.id, label: file ? `${p.name} (${file})` : p.name };
  }

  async function openProjectEntry(p: ProjectEntry): Promise<ToolResult> {
    const data = { project_id: p.id, name: p.name };
    if (!p.path.trim()) {
      const what = p.kind === 'folder' ? 'את תיקיית הפרויקט' : p.kind === 'eplan' ? 'את קובץ הפרויקט (‎.elk)' : 'את קובץ הפרויקט';
      return fail('NOT_CONFIGURED', `הנתיב ${withLamed(p.name)} עדיין לא הוגדר. פתח ${SETTINGS_HINT} ובחר ${what}.`, data);
    }
    const insp = await inspectPath(p.path, p.kind);
    if (!insp.ok) return inspectionFailure(insp, p.name, 'project', data);
    if (insp.warning_he) logger.warn('launcher.project_unusual_extension', { project_id: p.id });

    let openError: string;
    try {
      openError = await adapter.openPath(insp.path);
    } catch (err) {
      openError = errMessage(err) || 'שגיאה לא ידועה';
    }
    const fileName = winPath.basename(insp.path);
    if (openError) {
      logger.warn('launcher.project_failed', { project_id: p.id, error: openError });
      const program = p.kind === 'eplan' ? 'EPLAN' : 'התוכנה המתאימה';
      const hint =
        p.kind === 'folder'
          ? 'Windows לא הצליח לפתוח את התיקייה.'
          : ASSOCIATION_ERROR.test(openError)
            ? `ל-Windows אין תוכנה משויכת לסוג הקובץ הזה — פתח אותו פעם אחת ידנית עם ${program} וסמן "תמיד".`
            : `Windows החזיר שגיאה. אם ל-Windows אין תוכנה משויכת לסוג הקובץ הזה — פתח אותו פעם אחת ידנית עם ${program} וסמן "תמיד".`;
      return fail('LAUNCH_FAILED', `לא הצלחתי לפתוח את ${p.name} (${fileName}): ${hint} (${displaySafe(openError, 160)})`, {
        ...data,
        file: fileName,
        method: 'shell-open-path',
      });
    }
    logger.info('launcher.project_opened', { project_id: p.id, kind: p.kind });
    return {
      ok: true,
      status: 'success',
      summary_he:
        p.kind === 'folder'
          ? `פתחתי את ${p.name} (${fileName}) בסייר הקבצים.`
          : `פתחתי את ${p.name} (${fileName}) בתוכנה המשויכת.`,
      data: { ...data, file: fileName, method: 'shell-open-path' },
    };
  }

  async function openProject(
    query: { project_id?: string; project_name?: string },
    settings: Settings,
  ): Promise<ToolResult> {
    const res = resolveProject(query, settings.launcher);
    const enabled = settings.launcher.projects.filter((p) => p.enabled);
    switch (res.kind) {
      case 'found':
        return openProjectEntry(res.entry);
      case 'ambiguous':
        return clarify(
          `יש כמה פרויקטים מתאימים: ${res.candidates.map((c) => c.name).join(' / ')}. לאיזה התכוונת?`,
          res.candidates.map(projectOption),
        );
      case 'no-default':
        if (res.candidates.length === 0) {
          return fail('NOT_CONFIGURED', `עדיין לא הוגדרו פרויקטים. אפשר להוסיף פרויקט ב${SETTINGS_HINT}.`);
        }
        return clarify(
          `לא הוגדר פרויקט ברירת מחדל. איזה פרויקט לפתוח: ${res.candidates.map((c) => c.name).join(' / ')}?`,
          res.candidates.map(projectOption),
        );
      case 'disabled':
        return fail(
          'NOT_FOUND',
          `הפרויקט ${res.entry.name} מושבת בהגדרות, ולכן לא פתחתי אותו. אפשר להפעיל אותו מחדש ב${SETTINGS_HINT}.`,
          { project_id: res.entry.id, name: res.entry.name },
        );
      case 'none': {
        const asked = displaySafe(query.project_name || query.project_id);
        return fail(
          'NOT_FOUND',
          `לא מצאתי פרויקט ${asked ? `בשם "${asked}"` : 'כזה'} ברשימת הפרויקטים. ${
            enabled.length ? `הפרויקטים המוגדרים: ${enabled.map((p) => p.name).join(', ')}.` : 'עדיין לא הוגדרו פרויקטים.'
          } להוספה: ${SETTINGS_HINT}.`,
          { projects: enabled.map((p) => ({ id: p.id, name: p.name })) },
        );
      }
    }
  }

  /* ------------------------------ בדיקת נתיב להגדרות ------------------------------ */

  function okMessage(expected: FileExpected, path: string): string {
    const file = winPath.basename(path);
    switch (expected) {
      case 'exe':
        return `קובץ ההפעלה נמצא: ${file}.`;
      case 'shortcut':
        return `קיצור הדרך נמצא: ${file}.`;
      case 'eplan':
        return `קובץ הפרויקט נמצא: ${file}.`;
      case 'file':
        return `הקובץ נמצא: ${file}.`;
      case 'folder':
        return `התיקייה נמצאה: ${path}.`;
    }
  }

  async function validatePath(path: string, expected: Expected): Promise<PathValidation> {
    try {
      if (expected === 'uri') {
        const uri = parseAllowedUri(path);
        if (!uri.ok) return { ok: false, exists: false, detectedKind: 'unknown', message_he: uri.message_he };
        // ל-URI אין קובץ בדיסק (exists=false); אין דרך לבדוק בלי רישום Windows אם האפליקציה מותקנת.
        return {
          ok: true,
          exists: false,
          detectedKind: 'uri',
          message_he: `הכתובת ${uri.uri} תקינה. Windows יפתח אותה באפליקציה הרשומה לה (אם היא מותקנת).`,
        };
      }
      const insp = await inspectPath(path, expected);
      if (!insp.ok) return { ok: false, exists: insp.exists, detectedKind: insp.detectedKind, message_he: insp.reason_he };
      return {
        ok: true,
        exists: true,
        detectedKind: insp.detectedKind,
        message_he: insp.warning_he ? `${okMessage(expected, insp.path)} ${insp.warning_he}` : okMessage(expected, insp.path),
      };
    } catch (err) {
      logger.error('launcher.validate_failed', { error: errMessage(err) });
      return { ok: false, exists: false, detectedKind: 'unknown', message_he: 'לא הצלחתי לבדוק את הנתיב.' };
    }
  }

  /* ------------------------------ זיהוי תוכנות מותקנות ------------------------------ */

  /** משתני סביבה ב-Windows לא תלויי אותיות גדולות/קטנות. */
  function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
    const direct = env[name];
    if (direct) return direct;
    const lower = name.toLowerCase();
    for (const [key, value] of Object.entries(env)) {
      if (key.toLowerCase() === lower && value) return value;
    }
    return undefined;
  }

  async function safeReaddir(dir: string): Promise<string[]> {
    try {
      const entries = await withTimeout(() => readdir(dir), fsTimeoutMs);
      return entries.filter((e) => typeof e === 'string').slice(0, MAX_SCAN_ENTRIES);
    } catch {
      return [];
    }
  }

  async function isExistingFile(p: string): Promise<boolean> {
    try {
      const st = await withTimeout(() => deps.stat(p), fsTimeoutMs);
      return st.isFile();
    } catch {
      return false;
    }
  }

  function slugId(text: string): string {
    const slug = text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/g, '');
    return slug || 'app';
  }

  async function detectEplan(env: NodeJS.ProcessEnv): Promise<AppCandidate[]> {
    const roots: string[] = [];
    for (const name of ['ProgramW6432', 'ProgramFiles', 'ProgramFiles(x86)']) {
      const value = envValue(env, name);
      if (!value) continue;
      const checked = checkWindowsPath(value);
      if (!checked.ok) continue;
      if (!roots.some((r) => r.toLowerCase() === checked.normalized.toLowerCase())) roots.push(checked.normalized);
    }
    const found: Array<{ product: string; version: string; exe: string }> = [];
    for (const root of roots) {
      const eplanDir = winPath.join(root, 'EPLAN');
      for (const product of await safeReaddir(eplanDir)) {
        const productDir = winPath.join(eplanDir, product);
        for (const version of await safeReaddir(productDir)) {
          // מבנה ההתקנה: <ProgramFiles>\EPLAN\<מוצר>\<גרסה>\Bin\EPLAN.exe (למשל Platform\2024.0.3)
          const exe = winPath.join(productDir, version, 'Bin', 'EPLAN.exe');
          const checked = checkWindowsPath(exe);
          if (!checked.ok) continue;
          if (found.some((f) => f.exe.toLowerCase() === checked.normalized.toLowerCase())) continue;
          if (await isExistingFile(checked.normalized)) found.push({ product, version, exe: checked.normalized });
        }
      }
    }
    // הגרסה החדשה ראשונה
    found.sort(
      (a, b) =>
        b.version.localeCompare(a.version, 'en', { numeric: true, sensitivity: 'base' }) ||
        a.product.localeCompare(b.product, 'en'),
    );
    const usedIds = new Set<string>();
    return found.map((f, index) => {
      let id = index === 0 ? 'eplan' : slugId(`eplan-${f.product}-${f.version}`);
      while (usedIds.has(id)) id = slugId(`${id.slice(0, 36)}-${usedIds.size}`);
      usedIds.add(id);
      return { name: `EPLAN ${f.product} ${f.version}`, path: f.exe, kind: 'exe' as const, suggestedId: id };
    });
  }

  async function detectSpotify(env: NodeJS.ProcessEnv): Promise<AppCandidate[]> {
    const appData = envValue(env, 'APPDATA');
    if (appData) {
      const checked = checkWindowsPath(winPath.join(appData, 'Spotify', 'Spotify.exe'));
      if (checked.ok && (await isExistingFile(checked.normalized))) {
        return [{ name: 'Spotify', path: checked.normalized, kind: 'exe', suggestedId: 'spotify' }];
      }
    }
    // גרסת Microsoft Store לא מותקנת בנתיב רגיל — פותחים אותה דרך הכתובת spotify:
    return [{ name: 'Spotify (גרסת Microsoft Store)', path: 'spotify:', kind: 'uri', suggestedId: 'spotify' }];
  }

  async function detectApps(): Promise<AppCandidate[]> {
    const platform = deps.platform ?? process.platform;
    if (platform !== 'win32') return [];
    const env = deps.env ?? process.env;
    try {
      const [eplan, spotify] = await Promise.all([detectEplan(env), detectSpotify(env)]);
      return [...eplan, ...spotify];
    } catch (err) {
      logger.warn('launcher.detect_failed', { error: errMessage(err) });
      return [];
    }
  }

  /* ------------------------------ ממשק ------------------------------ */

  async function guarded(what: string, run: () => Promise<ToolResult>): Promise<ToolResult> {
    try {
      return await run();
    } catch (err) {
      logger.error('launcher.unexpected_error', { what, error: errMessage(err) });
      // לא טוענים "שום דבר לא נפתח" — החריגה יכולה (תיאורטית) לקרות גם אחרי קריאה למערכת ההפעלה
      return fail('INTERNAL', 'אירעה שגיאה פנימית בזמן הפתיחה, ולא הצלחתי לאמת את התוצאה.');
    }
  }

  return {
    openApplication: (query, settings) => guarded('app', () => openApplication(query, settings)),
    openProject: (query, settings) => guarded('project', () => openProject(query, settings)),
    validatePath,
    detectApps,
  };
}

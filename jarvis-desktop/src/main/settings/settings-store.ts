import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Logger, SettingsService } from '../core/contracts';
import { COMMAND_PROXY_EXECUTABLES } from '../launcher/path-rules';
import {
  defaultLauncher,
  defaultSettings,
  SettingsSchema,
  type Settings,
  type SettingsPatch,
} from '../../shared/settings-schema';

/**
 * הגדרות JARVIS בקובץ JSON בתיקיית userData.
 * כל שינוי ממוזג, מאומת מול הסכמה ונשמר אטומית (קובץ זמני + rename).
 * הגדרות פגומות לא נמחקות — הן מגובות לצד הקובץ, ונטענות ברירות מחדל.
 */

export class SettingsValidationError extends Error {
  constructor(
    public readonly message_he: string,
    public readonly issues: string[],
  ) {
    super(message_he);
    this.name = 'SettingsValidationError';
  }
}

const SECTION_KEYS = Object.keys(SettingsSchema.shape) as Array<keyof Settings>;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** מיזוג ברמת מקטע: שדות במקטע מתעדכנים, מערכים מוחלפים בשלמותם. */
export function mergeSettings(current: Settings, patch: unknown): unknown {
  if (!isPlainObject(patch)) throw new SettingsValidationError('עדכון ההגדרות לא תקין.', ['patch must be an object']);
  const next: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (!(SECTION_KEYS as string[]).includes(key)) {
      throw new SettingsValidationError(`מקטע הגדרות לא מוכר: ${key}`, [`unknown section ${key}`]);
    }
    const cur = (current as Record<string, unknown>)[key];
    next[key] = isPlainObject(cur) && isPlainObject(value) ? { ...cur, ...value } : value;
  }
  return next;
}

/**
 * מעטפות פקודה ומפרשי סקריפטים שאסור להגדיר כ"תוכנה מאושרת":
 * דרכן אפשר היה להריץ פקודות שרירותיות דרך ארגומנטים — בדיוק מה ש-V1 אוסר.
 */
export const FORBIDDEN_LAUNCH_TARGETS = new Set([
  'cmd.exe',
  'powershell.exe',
  'powershell_ise.exe',
  'pwsh.exe',
  'wscript.exe',
  'cscript.exe',
  'mshta.exe',
  'rundll32.exe',
  'regsvr32.exe',
  'regedit.exe',
  'reg.exe',
  'bash.exe',
  'wsl.exe',
  'wt.exe',
  'conhost.exe',
  'msiexec.exe',
  'schtasks.exe',
  'certutil.exe',
  'bitsadmin.exe',
  'installutil.exe',
  'msbuild.exe',
  'node.exe',
  'python.exe',
  'pythonw.exe',
  'py.exe',
  'java.exe',
  'javaw.exe',
]);

export function launchTargetBasename(target: string): string {
  const parts = target.trim().split(/[\\/]/);
  return (parts[parts.length - 1] ?? '').toLowerCase();
}

/** localhost, כתובות loopback וטווחי רשת פרטית (RFC 1918) בלבד. */
export function isLocalNetworkHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h === '::1') return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

/** בדיקות עקביות שהסכמה לבדה לא מכסה. */
export function checkConsistency(s: Settings): string[] {
  const issues: string[] = [];
  const appIds = new Set<string>();
  for (const a of s.launcher.apps) {
    if (appIds.has(a.id)) issues.push(`מזהה תוכנה כפול: ${a.id}`);
    appIds.add(a.id);
    const base = launchTargetBasename(a.target);
    if ((a.kind === 'exe' || a.kind === 'shortcut') && /^\s*"?(\\\\|\/\/)/.test(a.target)) {
      issues.push(`"${a.name}": תוכנה מאושרת חייבת להיות בכונן מקומי, לא בתיקיית רשת.`);
    }
    const forbidden = FORBIDDEN_LAUNCH_TARGETS.has(base) || COMMAND_PROXY_EXECUTABLES.includes(base);
    if (a.kind !== 'uri' && (forbidden || /\.(bat|cmd|ps1|vbs|vbe|js|jse|wsf|wsh|hta|scr|msi|reg)$/i.test(base))) {
      issues.push(`לא ניתן להגדיר את "${base}" כתוכנה מאושרת — מעטפות פקודה וסקריפטים חסומים בגרסה הזו.`);
    }
  }
  const projectIds = new Set<string>();
  for (const p of s.launcher.projects) {
    if (projectIds.has(p.id)) issues.push(`מזהה פרויקט כפול: ${p.id}`);
    projectIds.add(p.id);
  }
  if (s.launcher.defaultProjectId && !projectIds.has(s.launcher.defaultProjectId)) {
    issues.push('פרויקט ברירת המחדל לא קיים ברשימת הפרויקטים.');
  }
  if (s.stt.provider === 'local-openai-compatible') {
    try {
      const u = new URL(s.stt.localBaseUrl);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') issues.push('כתובת שרת התמלול המקומי חייבת להתחיל ב-http או https.');
      else if (!isLocalNetworkHost(u.hostname)) {
        // אודיו נשלח לשרת הזה — מגבילים למחשב הזה או לרשת הביתית, כדי שלא ישמש ערוץ להוצאת מידע
        issues.push('שרת התמלול המקומי חייב להיות במחשב הזה או ברשת המקומית (localhost / 127.0.0.1 / 192.168.x.x / 10.x.x.x).');
      }
    } catch {
      issues.push('כתובת שרת התמלול המקומי לא תקינה.');
    }
  }
  return issues;
}

function formatZodIssues(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): string[] {
  return error.issues.map((i) => `${i.path.map(String).join('.') || '(root)'}: ${i.message}`);
}

export interface SettingsStoreOptions {
  file: string;
  logger: Logger;
  now?: () => Date;
}

export function createSettingsStore(options: SettingsStoreOptions): SettingsService {
  const { file, logger } = options;
  const now = options.now ?? (() => new Date());
  const listeners = new Set<(s: Settings) => void>();
  let current = load();

  function load(): Settings {
    if (!existsSync(file)) {
      const fresh = defaultSettings();
      persist(fresh);
      return fresh;
    }
    try {
      const raw: unknown = JSON.parse(readFileSync(file, 'utf8'));
      const withLauncher = isPlainObject(raw) && !('launcher' in raw) ? { ...raw, launcher: defaultLauncher() } : raw;
      const parsed = SettingsSchema.safeParse(withLauncher);
      if (parsed.success && checkConsistency(parsed.data).length === 0) return parsed.data;
      logger.warn('settings.invalid_on_disk', {
        issues: parsed.success ? checkConsistency(parsed.data) : formatZodIssues(parsed.error),
      });
    } catch (err) {
      logger.warn('settings.unreadable', { error: err instanceof Error ? err.message : String(err) });
    }
    // גיבוי הקובץ הפגום ושימוש בברירות מחדל
    try {
      renameSync(file, `${file}.invalid-${now().toISOString().replace(/[:.]/g, '-')}`);
    } catch {
      // לא קריטי
    }
    const fresh = defaultSettings();
    persist(fresh);
    return fresh;
  }

  function persist(s: Settings): void {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(s, null, 2), { encoding: 'utf8' });
    renameSync(tmp, file);
  }

  return {
    get: () => current,
    update(patch: SettingsPatch): Settings {
      const merged = mergeSettings(current, patch);
      const parsed = SettingsSchema.safeParse(merged);
      if (!parsed.success) {
        const issues = formatZodIssues(parsed.error);
        throw new SettingsValidationError(`ההגדרות לא נשמרו: ${issues.slice(0, 3).join('; ')}`, issues);
      }
      const consistency = checkConsistency(parsed.data);
      if (consistency.length) {
        throw new SettingsValidationError(`ההגדרות לא נשמרו: ${consistency.join(' ')}`, consistency);
      }
      current = parsed.data;
      persist(current);
      logger.info('settings.updated', { sections: Object.keys(patch as object) });
      for (const l of listeners) {
        try {
          l(current);
        } catch (err) {
          logger.error('settings.listener_failed', { error: err instanceof Error ? err.message : String(err) });
        }
      }
      return current;
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * MOCKS לבדיקות של צוות הכלים המקומיים. כל מה שכאן מדמה שירות חיצוני (מערכת הפעלה, Electron, דיסק)
 * ומסומן MOCK בשם — שום דבר כאן לא פותח תוכנה אמיתית ולא נוגע בדיסק.
 */
import type { DesktopCapturerSource, Display, NativeImage } from 'electron';
import { defaultSettings, type AppEntry, type ProjectEntry, type Settings } from '../../../src/shared/settings-schema';
import type { AssistantEvent } from '../../../src/shared/types';
import type { Logger, OsLauncherAdapter, ToolContext } from '../../../src/main/core/contracts';
import type { StatLike } from '../../../src/main/launcher/launcher';

export interface MockLogger extends Logger {
  entries: Array<{ level: string; event: string; data?: Record<string, unknown> }>;
}

export function mockLogger(): MockLogger {
  const entries: MockLogger['entries'] = [];
  const push = (level: string) => (event: string, data?: Record<string, unknown>) => {
    entries.push({ level, event, ...(data ? { data } : {}) });
  };
  return { entries, debug: push('debug'), info: push('info'), warn: push('warn'), error: push('error') };
}

export interface MockAdapterCalls {
  spawn: Array<{ file: string; args: string[]; cwd: string }>;
  openPath: string[];
  openExternal: string[];
}

export interface MockAdapter extends OsLauncherAdapter {
  calls: MockAdapterCalls;
  totalCalls(): number;
}

/** MOCK של מתאם מערכת ההפעלה: רושם כל קריאה ומחזיר תוצאה שנקבעה מראש. */
export function mockAdapter(behavior: {
  spawn?: { ok: boolean; pid?: number; error?: string } | Error;
  openPath?: string | Error;
  openExternal?: Error;
} = {}): MockAdapter {
  const calls: MockAdapterCalls = { spawn: [], openPath: [], openExternal: [] };
  return {
    calls,
    totalCalls: () => calls.spawn.length + calls.openPath.length + calls.openExternal.length,
    async spawnDetached(file, args, cwd) {
      calls.spawn.push({ file, args: [...args], cwd });
      if (behavior.spawn instanceof Error) throw behavior.spawn;
      return behavior.spawn ?? { ok: true, pid: 4242 };
    },
    async openPath(p) {
      calls.openPath.push(p);
      if (behavior.openPath instanceof Error) throw behavior.openPath;
      return behavior.openPath ?? '';
    },
    async openExternal(uri) {
      calls.openExternal.push(uri);
      if (behavior.openExternal) throw behavior.openExternal;
    },
  };
}

/** MOCK של מערכת קבצים: מפת נתיב (לא תלוי אותיות, כמו ב-Windows) → קובץ/תיקייה. */
export function mockStat(entries: Record<string, 'file' | 'dir'>): ((p: string) => Promise<StatLike>) & { calls: string[] } {
  const map = new Map(Object.entries(entries).map(([k, v]) => [k.toLowerCase(), v]));
  const calls: string[] = [];
  const fn = async (p: string): Promise<StatLike> => {
    calls.push(p);
    const kind = map.get(p.toLowerCase());
    if (!kind) throw Object.assign(new Error(`ENOENT: no such file or directory, stat '${p}'`), { code: 'ENOENT' });
    return { isFile: () => kind === 'file', isDirectory: () => kind === 'dir' };
  };
  return Object.assign(fn, { calls });
}

/** MOCK של readdir לפי מפה (לא תלוי אותיות). */
export function mockReaddir(tree: Record<string, string[]>): (p: string) => Promise<string[]> {
  const map = new Map(Object.entries(tree).map(([k, v]) => [k.toLowerCase(), v]));
  return async (p: string) => {
    const list = map.get(p.toLowerCase());
    if (!list) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    return list;
  };
}

export const EPLAN_EXE = 'C:\\Program Files\\EPLAN\\Platform\\2024.0.3\\Bin\\EPLAN.exe';
export const FINAL_ELK = 'D:\\Projects\\Final\\final.elk';

export function app(partial: Partial<AppEntry> & Pick<AppEntry, 'id' | 'name' | 'kind'>): AppEntry {
  return { aliases: [], target: '', args: [], enabled: true, builtin: false, ...partial };
}

export function project(partial: Partial<ProjectEntry> & Pick<ProjectEntry, 'id' | 'name'>): ProjectEntry {
  return { aliases: [], path: '', kind: 'eplan', enabled: true, ...partial };
}

/** הגדרות ברירת מחדל עם שינויים ב-launcher. */
export function settingsWith(launcher: Partial<Settings['launcher']> = {}, mutate?: (s: Settings) => void): Settings {
  const s = defaultSettings();
  s.launcher = { ...s.launcher, ...launcher };
  mutate?.(s);
  return s;
}

/** ברירת המחדל עם נתיב EPLAN וקובץ פרויקט מוגדרים. */
export function configuredSettings(): Settings {
  const s = defaultSettings();
  s.launcher.apps = s.launcher.apps.map((a) => (a.id === 'eplan' ? { ...a, target: EPLAN_EXE, args: ['/NoSplash'] } : a));
  s.launcher.projects = s.launcher.projects.map((p) => (p.id === 'final-project' ? { ...p, path: FINAL_ELK } : p));
  return s;
}

export function mockToolContext(overrides: Partial<ToolContext> = {}): ToolContext & { events: AssistantEvent[] } {
  const events: AssistantEvent[] = [];
  const ctx: ToolContext & { events: AssistantEvent[] } = {
    turnId: 'turn-1',
    actionId: 'action-1',
    signal: new AbortController().signal,
    settings: defaultSettings(),
    now: new Date('2026-10-05T10:00:00Z'),
    userInitiated: false,
    emit: (e) => {
      events.push(e);
    },
    events,
    ...overrides,
  };
  return ctx;
}

/* ------------------------------ Electron MOCKS ------------------------------ */

export interface MockNativeImageLog {
  resizes: Array<{ width?: number; height?: number; quality?: string }>;
  jpegQualities: number[];
  pngCalls: number;
}

/** MOCK של NativeImage: מידות בלבד, ובאפרים בגודל שנקבע מראש (pngBytes(w,h) / jpegBytes(q)). */
export function mockNativeImage(
  width: number,
  height: number,
  opts: {
    empty?: boolean;
    pngBytes?: (w: number, h: number) => number;
    jpegBytes?: (quality: number) => number;
    log?: MockNativeImageLog;
  } = {},
): NativeImage & { log: MockNativeImageLog } {
  const log: MockNativeImageLog = opts.log ?? { resizes: [], jpegQualities: [], pngCalls: 0 };
  const img = {
    log,
    isEmpty: () => Boolean(opts.empty) || width === 0 || height === 0,
    getSize: () => ({ width, height }),
    resize: (o: { width?: number; height?: number; quality?: string }) => {
      log.resizes.push(o);
      return mockNativeImage(o.width ?? width, o.height ?? height, { ...opts, log });
    },
    toPNG: () => {
      log.pngCalls++;
      return Buffer.alloc(opts.pngBytes ? opts.pngBytes(width, height) : 1000, 0x89);
    },
    toJPEG: (q: number) => {
      log.jpegQualities.push(q);
      return Buffer.alloc(opts.jpegBytes ? opts.jpegBytes(q) : 500, 0xff);
    },
  };
  return img as unknown as NativeImage & { log: MockNativeImageLog };
}

export function mockDisplay(id: number, width: number, height: number, scaleFactor: number): Display {
  return { id, size: { width, height }, scaleFactor, bounds: { x: 0, y: 0, width, height } } as unknown as Display;
}

export function mockSource(display_id: string, thumbnail: NativeImage, index = 0): DesktopCapturerSource {
  return { id: `screen:${index}:0`, name: `Screen ${index + 1}`, display_id, thumbnail } as unknown as DesktopCapturerSource;
}

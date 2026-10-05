/**
 * מצב המחשב — נתונים אמיתיים בלבד:
 * - מעבד: הפרשי זמני os.cpus() בין שתי דגימות (דוגם ברקע כל 2 שניות אחרי start();
 *   אם אין דגימה עדכנית — מדידה מהירה של 300ms).
 * - זיכרון: os.totalmem / os.freemem.
 * - כוננים: fs.promises.statfs על כונן המערכת (ועל כוננים נוספים שהוגדרו).
 * - סוללה: רק מה שה-renderer דיווח מ-Battery API, עם היוריסטיקה שמרנית.
 * - שירותים: ההגדרות + סטטוסים שדווחו (בדיקת חיבור).
 * אין כאן טמפרטורות או כל מדד אחר שאין לו מקור אמיתי — עדיף "לא ידוע" מאשר מספר מומצא.
 */
import { promises as fsp } from 'node:fs';
import * as nodeOs from 'node:os';
import type { BatteryReport, ServiceStatus, SystemStatus } from '../../shared/types';
import type { Clock, Logger, SystemStatusService } from '../core/contracts';

export type OsLike = Pick<typeof nodeOs, 'cpus' | 'totalmem' | 'freemem' | 'uptime' | 'platform'>;

export interface StatFsLike {
  bsize: number;
  blocks: number;
  bavail: number;
}

export interface SystemStatusDeps {
  logger: Logger;
  clock: Clock;
  getConfiguredServices: () => ServiceStatus[];
  os?: OsLike;
  statfs?: (p: string) => Promise<StatFsLike>;
  /** כוננים נוספים לדיווח (למשל 'D:\\'). כונן המערכת נכלל תמיד. */
  diskRoots?: () => string[];
  samplerIntervalMs?: number;
  /** משתני סביבה (SystemDrive). ברירת מחדל: process.env. */
  env?: NodeJS.ProcessEnv;
  /** המתנה בין שתי דגימות במדידה המהירה — מוזרק כדי שהבדיקות יהיו דטרמיניסטיות. */
  delay?: (ms: number) => Promise<void>;
  /** זמן מקסימלי ל-statfs (כונן רשת מנותק יכול להיתקע). */
  fsTimeoutMs?: number;
}

export interface CpuTimesSnapshot {
  idle: number;
  total: number;
}

const DEFAULT_SAMPLER_MS = 2_000;
const QUICK_SAMPLE_MS = 300;
const DEFAULT_FS_TIMEOUT_MS = 2_000;
const MAX_DISKS = 8;
const SERVICES = new Set<ServiceStatus['service']>(['llm', 'stt', 'tts', 'wakeword']);

export const NO_BATTERY_NOTE_HE = 'לא זוהתה סוללה (או שהמחשב מחובר לחשמל וטעון במלואו).';
const NO_REPORT_NOTE_HE = 'עדיין לא התקבל דיווח סוללה מהממשק.';

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function clampPercent(n: number): number {
  return Math.min(100, Math.max(0, n));
}

/** סכום זמני כל הליבות (מילישניות מצטברות מאז האתחול). */
export function snapshotCpu(cpus: ReadonlyArray<nodeOs.CpuInfo>): CpuTimesSnapshot {
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    const t = cpu.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { idle, total };
}

/** אחוז ניצול בין שתי דגימות. null כשאין הפרש תקין (לא עבר זמן, או שהמונים התאפסו). */
export function cpuUsagePercent(prev: CpuTimesSnapshot, next: CpuTimesSnapshot): number | null {
  const total = next.total - prev.total;
  const idle = next.idle - prev.idle;
  if (!Number.isFinite(total) || !Number.isFinite(idle) || total <= 0 || idle < 0 || idle > total) return null;
  return round1(clampPercent((1 - idle / total) * 100));
}

/**
 * סוללה לפי דיווח Battery API של Chromium. מחשב שולחני מדווח "טוען, 100%, זמן טעינה 0",
 * ולכן "יש סוללה" רק כשהדיווח מעיד על כך בבירור: פריקה, רמה מתחת ל-100%, או זמן טעינה סופי וחיובי.
 */
export function evaluateBattery(report: BatteryReport | null): SystemStatus['battery'] {
  if (!report) return { available: false, source: 'none', note_he: NO_REPORT_NOTE_HE };
  const discharging = report.charging === false;
  const partial = report.level < 1;
  const chargingTimeKnown =
    typeof report.chargingTime === 'number' && Number.isFinite(report.chargingTime) && report.chargingTime > 0;
  if (discharging || partial || chargingTimeKnown) {
    return {
      available: true,
      levelPercent: Math.round(report.level * 100),
      charging: report.charging,
      source: 'renderer-battery-api',
    };
  }
  return { available: false, source: 'renderer-battery-api', note_he: NO_BATTERY_NOTE_HE };
}

function isValidBatteryReport(r: unknown): r is BatteryReport {
  if (typeof r !== 'object' || r === null) return false;
  const b = r as Record<string, unknown>;
  const optionalNumber = (v: unknown) => v === null || (typeof v === 'number' && !Number.isNaN(v));
  return (
    typeof b.level === 'number' &&
    Number.isFinite(b.level) &&
    b.level >= 0 &&
    b.level <= 1 &&
    typeof b.charging === 'boolean' &&
    optionalNumber(b.chargingTime) &&
    optionalNumber(b.dischargingTime)
  );
}

function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const direct = env[name];
  if (direct) return direct;
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(env)) if (key.toLowerCase() === lower && value) return value;
  return undefined;
}

/** שורש כונן המערכת: ‎C:\‎ ב-Windows (לפי SystemDrive), ‎/‎ בשאר המערכות. */
export function systemDiskRoot(platform: string, env: NodeJS.ProcessEnv): string {
  if (platform !== 'win32') return '/';
  const drive = (envValue(env, 'SystemDrive') ?? '').trim().match(/^([a-zA-Z]):?[\\/]?$/);
  return `${(drive?.[1] ?? 'C').toUpperCase()}:\\`;
}

/** נרמול שורש כונן לצורך הסרת כפילויות. null = לא תקין. */
export function normalizeDiskRoot(root: string, platform: string): string | null {
  if (typeof root !== 'string') return null;
  const r = root.trim();
  if (!r || r.includes('\0')) return null;
  if (platform === 'win32') {
    const drive = r.match(/^([a-zA-Z]):[\\/]?$/);
    if (drive?.[1]) return `${drive[1].toUpperCase()}:\\`;
    // נקודת עיגון בתיקייה או שיתוף רשת: נתיב מלא בלבד
    if (/^[a-zA-Z]:[\\/]/.test(r) || /^[\\/]{2}[^\\/.?][^\\/]*[\\/][^\\/]+/.test(r)) {
      const withBackslashes = r.replace(/\//g, '\\');
      return withBackslashes.endsWith('\\') ? withBackslashes : `${withBackslashes}\\`;
    }
    return null;
  }
  return r.startsWith('/') ? r : null;
}

function rootKey(root: string, platform: string): string {
  // ב-Windows אין הבדל בין אותיות גדולות לקטנות בנתיבים
  return platform === 'win32' ? root.toLowerCase() : root;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function createSystemStatusService(deps: SystemStatusDeps): SystemStatusService {
  const { logger, clock } = deps;
  const os: OsLike = deps.os ?? nodeOs;
  const statfs = deps.statfs ?? ((p: string) => fsp.statfs(p));
  const samplerIntervalMs = Math.max(250, deps.samplerIntervalMs ?? DEFAULT_SAMPLER_MS);
  const staleAfterMs = samplerIntervalMs * 3;
  const delay = deps.delay ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const fsTimeoutMs = deps.fsTimeoutMs ?? DEFAULT_FS_TIMEOUT_MS;

  let samplerTimer: ReturnType<typeof setInterval> | null = null;
  let samplerPrev: CpuTimesSnapshot | null = null;
  let lastSample: { usage: number; atMs: number } | null = null;
  let quickMeasure: Promise<number | null> | null = null;
  let battery: BatteryReport | null = null;
  const reportedServices = new Map<ServiceStatus['service'], ServiceStatus>();

  function takeCpuSnapshot(): CpuTimesSnapshot | null {
    try {
      const cpus = os.cpus();
      return cpus.length > 0 ? snapshotCpu(cpus) : null;
    } catch (err) {
      logger.debug('system.cpus_failed', { error: errMessage(err) });
      return null;
    }
  }

  function samplerTick(): void {
    const next = takeCpuSnapshot();
    if (samplerPrev && next) {
      const usage = cpuUsagePercent(samplerPrev, next);
      if (usage !== null) lastSample = { usage, atMs: clock.now().getTime() };
    }
    samplerPrev = next;
  }

  async function cpuUsage(): Promise<number | null> {
    if (lastSample && clock.now().getTime() - lastSample.atMs <= staleAfterMs) return lastSample.usage;
    // מדידה מהירה אחת משותפת לכל הקוראים בו-זמנית
    if (!quickMeasure) {
      quickMeasure = (async () => {
        const first = takeCpuSnapshot();
        if (!first) return null;
        await delay(QUICK_SAMPLE_MS);
        const second = takeCpuSnapshot();
        return second ? cpuUsagePercent(first, second) : null;
      })().finally(() => {
        quickMeasure = null;
      });
    }
    return quickMeasure;
  }

  function statfsWithTimeout(root: string): Promise<StatFsLike> {
    return new Promise<StatFsLike>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('statfs timeout')), fsTimeoutMs);
      Promise.resolve()
        .then(() => statfs(root))
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

  function diskRoots(platform: string): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    const add = (raw: string): void => {
      const norm = normalizeDiskRoot(raw, platform);
      if (!norm) return;
      const key = rootKey(norm, platform);
      if (seen.has(key)) return;
      seen.add(key);
      out.push(norm);
    };
    add(systemDiskRoot(platform, deps.env ?? process.env));
    try {
      for (const r of deps.diskRoots?.() ?? []) add(r);
    } catch (err) {
      logger.warn('system.disk_roots_failed', { error: errMessage(err) });
    }
    return out.slice(0, MAX_DISKS);
  }

  async function readDisks(platform: string): Promise<SystemStatus['disks']> {
    const roots = diskRoots(platform);
    const results = await Promise.all(
      roots.map(async (mount) => {
        try {
          const s = await statfsWithTimeout(mount);
          const totalBytes = Number(s.blocks) * Number(s.bsize);
          const freeBytes = Number(s.bavail) * Number(s.bsize);
          if (!Number.isFinite(totalBytes) || totalBytes <= 0 || !Number.isFinite(freeBytes) || freeBytes < 0) return null;
          const free = Math.min(freeBytes, totalBytes);
          return {
            mount,
            totalBytes,
            freeBytes: free,
            usagePercent: round1(clampPercent(((totalBytes - free) / totalBytes) * 100)),
          };
        } catch (err) {
          // כונן שלא קיים / לא זמין — מדלגים, לא ממציאים
          logger.debug('system.statfs_failed', { mount, error: errMessage(err) });
          return null;
        }
      }),
    );
    return results.filter((d): d is NonNullable<typeof d> => d !== null);
  }

  function services(): ServiceStatus[] {
    let configured: ServiceStatus[] = [];
    try {
      configured = deps.getConfiguredServices();
    } catch (err) {
      logger.warn('system.configured_services_failed', { error: errMessage(err) });
    }
    const merged = configured.map((c) => {
      const reported = reportedServices.get(c.service);
      // דיווח ישן לא גובר על ההגדרות: ספק/מודל אחר, שירות שכבר לא מוגדר, או מצב מקומי → ההגדרות קובעות
      if (!reported || reported.provider !== c.provider || !c.configured || c.state === 'not_configured' || c.state === 'local') {
        return { ...c };
      }
      return { ...c, ...reported, configured: c.configured };
    });
    for (const r of reportedServices.values()) {
      if (!configured.some((c) => c.service === r.service)) merged.push({ ...r });
    }
    return merged;
  }

  async function getStatus(): Promise<SystemStatus> {
    const platform = (() => {
      try {
        return os.platform();
      } catch {
        return process.platform;
      }
    })();
    const [usage, disks] = await Promise.all([cpuUsage(), readDisks(platform)]);

    const cpus: nodeOs.CpuInfo[] = (() => {
      try {
        return os.cpus();
      } catch {
        return [];
      }
    })();
    const totalBytes = os.totalmem();
    const freeBytes = Math.min(os.freemem(), totalBytes);
    const usedBytes = Math.max(0, totalBytes - freeBytes);

    return {
      timestamp: clock.now().toISOString(),
      cpu: {
        usagePercent: usage,
        cores: cpus.length,
        model: cpus[0]?.model?.trim() || 'לא ידוע',
      },
      memory: {
        totalBytes,
        usedBytes,
        freeBytes,
        usagePercent: totalBytes > 0 ? round1(clampPercent((usedBytes / totalBytes) * 100)) : 0,
      },
      disks,
      battery: evaluateBattery(battery),
      services: services(),
      uptimeSec: Math.max(0, Math.round(os.uptime())),
      platform,
    };
  }

  return {
    getStatus,
    reportBattery(report: BatteryReport): void {
      if (!isValidBatteryReport(report)) {
        logger.warn('system.invalid_battery_report');
        return;
      }
      battery = {
        level: report.level,
        charging: report.charging,
        chargingTime: report.chargingTime,
        dischargingTime: report.dischargingTime,
      };
    },
    setServiceStatus(status: ServiceStatus): void {
      if (!status || !SERVICES.has(status.service)) {
        logger.warn('system.invalid_service_status');
        return;
      }
      reportedServices.set(status.service, { ...status });
    },
    start(): void {
      if (samplerTimer) return;
      samplerPrev = takeCpuSnapshot();
      samplerTimer = setInterval(samplerTick, samplerIntervalMs);
      // הדוגם לא מחזיק את התהליך בחיים בזמן יציאה
      if (typeof samplerTimer === 'object' && samplerTimer && 'unref' in samplerTimer) samplerTimer.unref();
    },
    stop(): void {
      if (samplerTimer) clearInterval(samplerTimer);
      samplerTimer = null;
      samplerPrev = null;
      lastSample = null;
    },
  };
}

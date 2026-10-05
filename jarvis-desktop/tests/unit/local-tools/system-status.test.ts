import type { CpuInfo } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { systemClock, type Clock } from '../../../src/main/core/contracts';
import {
  NO_BATTERY_NOTE_HE,
  cpuUsagePercent,
  createSystemStatusService,
  evaluateBattery,
  normalizeDiskRoot,
  snapshotCpu,
  systemDiskRoot,
  type OsLike,
  type StatFsLike,
  type SystemStatusDeps,
} from '../../../src/main/system/system-status';
import { createSystemTool, formatSize, formatSystemSummary } from '../../../src/main/tools/system-tools';
import type { ServiceStatus, SystemStatus } from '../../../src/shared/types';
import { mockLogger, mockToolContext } from './local-tools.mock';

const GIB = 1024 ** 3;
const fixedClock: Clock = { now: () => new Date('2026-10-05T10:00:00.000Z') };

function cpu(user: number, sys: number, idle: number): CpuInfo {
  return { model: ' Intel(R) Core(TM) i7-MOCK ', speed: 3000, times: { user, nice: 0, sys, idle, irq: 0 } };
}

/** MOCK של מודול os: כל קריאה ל-cpus מחזירה את הדגימה הבאה ברשימה (האחרונה חוזרת). */
function mockOs(samples: CpuInfo[][], mem = { total: 64 * GIB, free: 38 * GIB }): OsLike & { cpusCalls: () => number } {
  let i = 0;
  return {
    cpus: () => samples[Math.min(i++, samples.length - 1)] ?? [],
    totalmem: () => mem.total,
    freemem: () => mem.free,
    uptime: () => 3600.4,
    platform: () => 'win32',
    cpusCalls: () => i,
  } as OsLike & { cpusCalls: () => number };
}

// שתי ליבות; בין הדגימות עברו 1000ms לכל ליבה, מתוכן 750 idle → ניצול 25%
const SAMPLE_A = [cpu(100, 50, 850), cpu(100, 50, 850)];
const SAMPLE_B = [cpu(300, 100, 1600), cpu(300, 100, 1600)];

function mockStatfs(table: Record<string, StatFsLike | Error | 'hang'>): ((p: string) => Promise<StatFsLike>) & { calls: string[] } {
  const calls: string[] = [];
  const fn = async (p: string): Promise<StatFsLike> => {
    calls.push(p);
    const v = table[p];
    if (v === 'hang') return new Promise(() => {});
    if (!v) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    if (v instanceof Error) throw v;
    return v;
  };
  return Object.assign(fn, { calls });
}

const C_DRIVE: StatFsLike = { bsize: 4096, blocks: (500 * GIB) / 4096, bavail: (212 * GIB) / 4096 };

function service(overrides: Partial<SystemStatusDeps> = {}) {
  const delay = vi.fn(async (_ms: number) => {});
  const svc = createSystemStatusService({
    logger: mockLogger(),
    clock: fixedClock,
    getConfiguredServices: () => [],
    os: mockOs([SAMPLE_A, SAMPLE_B]),
    statfs: mockStatfs({ 'C:\\': C_DRIVE }),
    env: { SystemDrive: 'C:' },
    delay,
    ...overrides,
  });
  return { svc, delay };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('system status: CPU math (mock os)', () => {
  it('computes usage from os.cpus() time deltas', () => {
    expect(cpuUsagePercent(snapshotCpu(SAMPLE_A), snapshotCpu(SAMPLE_B))).toBe(25);
    expect(cpuUsagePercent(snapshotCpu(SAMPLE_A), snapshotCpu(SAMPLE_A))).toBeNull(); // לא עבר זמן
    expect(cpuUsagePercent(snapshotCpu(SAMPLE_B), snapshotCpu(SAMPLE_A))).toBeNull(); // מונים התאפסו
  });

  it('getStatus without a background sample does a quick 300ms two-sample measurement (mock)', async () => {
    const { svc, delay } = service();
    const s = await svc.getStatus();
    expect(delay).toHaveBeenCalledWith(300);
    expect(s.cpu).toEqual({ usagePercent: 25, cores: 2, model: 'Intel(R) Core(TM) i7-MOCK' });
  });

  it('concurrent getStatus calls share one quick measurement (mock)', async () => {
    const os = mockOs([SAMPLE_A, SAMPLE_B]);
    const { svc, delay } = service({ os });
    const [a, b] = await Promise.all([svc.getStatus(), svc.getStatus()]);
    expect(a.cpu.usagePercent).toBe(25);
    expect(b.cpu.usagePercent).toBe(25);
    expect(delay).toHaveBeenCalledTimes(1);
  });

  it('the background sampler (every 2s after start) feeds getStatus without a quick measurement (mock)', async () => {
    vi.useFakeTimers();
    const { svc, delay } = service({ os: mockOs([SAMPLE_A, SAMPLE_B]) });
    svc.start();
    svc.start(); // אידמפוטנטי
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(2000);
    const s = await svc.getStatus();
    expect(s.cpu.usagePercent).toBe(25);
    expect(delay).not.toHaveBeenCalled();
    svc.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports null (not a made-up number) when os.cpus() is empty (mock)', async () => {
    const { svc } = service({ os: mockOs([[]]) });
    const s = await svc.getStatus();
    expect(s.cpu.usagePercent).toBeNull();
    expect(s.cpu.cores).toBe(0);
  });
});

describe('system status: memory, disks, battery, services (mock)', () => {
  it('memory from totalmem/freemem', async () => {
    const { svc } = service();
    const s = await svc.getStatus();
    expect(s.memory).toEqual({ totalBytes: 64 * GIB, usedBytes: 26 * GIB, freeBytes: 38 * GIB, usagePercent: 40.6 });
    expect(s.uptimeSec).toBe(3600);
    expect(s.platform).toBe('win32');
    expect(s.timestamp).toBe('2026-10-05T10:00:00.000Z');
  });

  it('disks: system drive + extra roots, de-duplicated case-insensitively, failures and hangs skipped (mock)', async () => {
    const statfs = mockStatfs({
      'C:\\': C_DRIVE,
      'D:\\': { bsize: 512, blocks: (1000 * GIB) / 512, bavail: (900 * GIB) / 512 },
      'Z:\\': 'hang',
    });
    const { svc } = service({
      statfs,
      fsTimeoutMs: 20,
      diskRoots: () => ['d:', 'D:\\', 'c:/', 'Z:\\', 'E:\\', 'not a root', ''],
    });
    const s = await svc.getStatus();
    expect(statfs.calls).toEqual(['C:\\', 'D:\\', 'Z:\\', 'E:\\']);
    expect(s.disks).toEqual([
      { mount: 'C:\\', totalBytes: 500 * GIB, freeBytes: 212 * GIB, usagePercent: 57.6 },
      { mount: 'D:\\', totalBytes: 1000 * GIB, freeBytes: 900 * GIB, usagePercent: 10 },
    ]);
  });

  it('system drive root follows %SystemDrive% on Windows and "/" elsewhere', () => {
    expect(systemDiskRoot('win32', { SystemDrive: 'D:' })).toBe('D:\\');
    expect(systemDiskRoot('win32', { SYSTEMDRIVE: 'e:' })).toBe('E:\\');
    expect(systemDiskRoot('win32', {})).toBe('C:\\');
    expect(systemDiskRoot('linux', { SystemDrive: 'D:' })).toBe('/');
    expect(normalizeDiskRoot('\\\\nas\\share', 'win32')).toBe('\\\\nas\\share\\');
    expect(normalizeDiskRoot('\\\\.\\PhysicalDrive0', 'win32')).toBeNull();
    expect(normalizeDiskRoot('relative', 'linux')).toBeNull();
  });

  it('battery heuristics: a battery only when the report clearly shows one', () => {
    // מחשב שולחני / מחובר וטעון במלואו
    expect(evaluateBattery({ level: 1, charging: true, chargingTime: 0, dischargingTime: null })).toEqual({
      available: false,
      source: 'renderer-battery-api',
      note_he: NO_BATTERY_NOTE_HE,
    });
    expect(evaluateBattery({ level: 1, charging: true, chargingTime: null, dischargingTime: null }).available).toBe(false);
    // פריקה
    expect(evaluateBattery({ level: 1, charging: false, chargingTime: null, dischargingTime: 7200 })).toEqual({
      available: true,
      levelPercent: 100,
      charging: false,
      source: 'renderer-battery-api',
    });
    // טעינה חלקית
    expect(evaluateBattery({ level: 0.437, charging: true, chargingTime: null, dischargingTime: null })).toMatchObject({
      available: true,
      levelPercent: 44,
      charging: true,
    });
    // זמן טעינה סופי וחיובי
    expect(evaluateBattery({ level: 1, charging: true, chargingTime: 600, dischargingTime: null }).available).toBe(true);
    // אין דיווח בכלל
    expect(evaluateBattery(null)).toMatchObject({ available: false, source: 'none' });
  });

  it('reportBattery stores valid reports and ignores invalid ones (mock)', async () => {
    const { svc } = service();
    svc.reportBattery({ level: 0.5, charging: false, chargingTime: null, dischargingTime: 3600 });
    svc.reportBattery({ level: 7, charging: false, chargingTime: null, dischargingTime: null });
    const s = await svc.getStatus();
    expect(s.battery).toMatchObject({ available: true, levelPercent: 50, charging: false });
  });

  it('services: reported statuses override configured ones only for the same, still-configured provider (mock)', async () => {
    const configured: ServiceStatus[] = [
      { service: 'llm', provider: 'anthropic', configured: true, state: 'unknown' },
      { service: 'stt', provider: 'openai', configured: false, state: 'not_configured' },
      { service: 'tts', provider: 'azure', configured: true, state: 'unknown' },
    ];
    const { svc } = service({ getConfiguredServices: () => configured });
    svc.setServiceStatus({ service: 'llm', provider: 'anthropic', configured: true, state: 'ok', lastCheckedAt: '2026-10-05T09:59:00Z' });
    svc.setServiceStatus({ service: 'stt', provider: 'openai', configured: true, state: 'ok' }); // ישן: המפתח כבר הוסר
    svc.setServiceStatus({ service: 'tts', provider: 'openai', configured: true, state: 'error' }); // ספק אחר
    svc.setServiceStatus({ service: 'wakeword', provider: 'porcupine', configured: true, state: 'local' });
    const s = await svc.getStatus();
    expect(s.services).toEqual([
      { service: 'llm', provider: 'anthropic', configured: true, state: 'ok', lastCheckedAt: '2026-10-05T09:59:00Z' },
      { service: 'stt', provider: 'openai', configured: false, state: 'not_configured' },
      { service: 'tts', provider: 'azure', configured: true, state: 'unknown' },
      { service: 'wakeword', provider: 'porcupine', configured: true, state: 'local' },
    ]);
  });

  it('has no temperature (or any other unsourced) fields (mock)', async () => {
    const { svc } = service();
    const s = await svc.getStatus();
    expect(JSON.stringify(s)).not.toMatch(/temp|fan|celsius/i);
    expect(Object.keys(s).sort()).toEqual(['battery', 'cpu', 'disks', 'memory', 'platform', 'services', 'timestamp', 'uptimeSec']);
  });
});

describe('system status: REAL values on this machine', () => {
  it('reads real CPU %, RAM and the root disk', async () => {
    const svc = createSystemStatusService({ logger: mockLogger(), clock: systemClock, getConfiguredServices: () => [] });
    const s = await svc.getStatus();
    expect(s.cpu.cores).toBeGreaterThan(0);
    expect(typeof s.cpu.usagePercent).toBe('number');
    expect(s.cpu.usagePercent).toBeGreaterThanOrEqual(0);
    expect(s.cpu.usagePercent).toBeLessThanOrEqual(100);
    expect(s.memory.totalBytes).toBeGreaterThan(0);
    expect(s.memory.usedBytes + s.memory.freeBytes).toBe(s.memory.totalBytes);
    expect(s.platform).toBe(process.platform);
    if (process.platform !== 'win32') {
      expect(s.disks[0]?.mount).toBe('/');
      expect(s.disks[0]?.totalBytes).toBeGreaterThan(0);
    }
    expect(s.battery.available).toBe(false); // אין דיווח מה-renderer בבדיקה
    expect(formatSystemSummary(s)).toMatch(/^מעבד \d+%/);
  });
});

describe('get_system_status tool', () => {
  const sample: SystemStatus = {
    timestamp: '2026-10-05T10:00:00.000Z',
    cpu: { usagePercent: 23.2, cores: 16, model: 'MOCK CPU' },
    memory: { totalBytes: 63.7 * GIB, usedBytes: 26.1 * GIB, freeBytes: 37.6 * GIB, usagePercent: 41 },
    disks: [{ mount: 'C:\\', totalBytes: 930 * GIB, freeBytes: 212 * GIB, usagePercent: 77.2 }],
    battery: { available: false, source: 'renderer-battery-api', note_he: NO_BATTERY_NOTE_HE },
    services: [{ service: 'llm', provider: 'claude-opus-5-5', configured: true, state: 'ok' }],
    uptimeSec: 100,
    platform: 'win32',
  };

  it('formats a speakable Hebrew summary from real values', () => {
    expect(formatSystemSummary(sample)).toBe(
      'מעבד 23%, זיכרון 41% בשימוש (26.1 מתוך 63.7 GB), בכונן C: פנויים 212 GB. סוללה: לא זוהתה. Claude: מחובר.',
    );
    const withBattery = formatSystemSummary({
      ...sample,
      cpu: { ...sample.cpu, usagePercent: null },
      battery: { available: true, levelPercent: 64, charging: true, source: 'renderer-battery-api' },
      services: [
        { service: 'stt', provider: 'openai', configured: false, state: 'not_configured' },
        { service: 'llm', provider: 'anthropic', configured: true, state: 'error' },
      ],
    });
    expect(withBattery).toContain('עומס המעבד לא נמדד');
    expect(withBattery).toContain('סוללה: 64%, בטעינה.');
    expect(withBattery).toContain('Claude: שגיאה, תמלול: לא מוגדר.');
    expect(formatSize(9.25 * GIB)).toBe('9.3 GB');
    expect(formatSize(1536 * GIB)).toBe('1.5 TB');
  });

  it('is a read-only tool with a strict empty input', async () => {
    const getStatus = vi.fn(async () => sample);
    const tool = createSystemTool({ getStatus, reportBattery: vi.fn(), setServiceStatus: vi.fn(), start: vi.fn(), stop: vi.fn() });
    expect(tool.name).toBe('get_system_status');
    expect(tool.risk).toBe('read');
    expect(tool.sideEffect).toBe(false);
    expect(tool.inputSchema.safeParse({}).success).toBe(true);
    expect(tool.inputSchema.safeParse({ cmd: 'x' }).success).toBe(false);
    expect(tool.description).toMatch(/temperature/i);
    const res = await tool.execute({}, mockToolContext());
    expect(res).toMatchObject({ ok: true, status: 'success', data: sample });
    expect(res.summary_he).toContain('מעבד 23%');
  });

  it('returns INTERNAL (not an exception) when the status cannot be read (mock)', async () => {
    const tool = createSystemTool({
      getStatus: vi.fn(async () => {
        throw new Error('boom');
      }),
      reportBattery: vi.fn(),
      setServiceStatus: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    });
    const res = await tool.execute({}, mockToolContext());
    expect(res).toMatchObject({ ok: false, error_code: 'INTERNAL' });
  });
});

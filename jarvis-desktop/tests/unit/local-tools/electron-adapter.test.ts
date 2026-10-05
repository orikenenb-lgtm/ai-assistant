import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

// MOCK של shell של Electron — הבדיקות לא טוענות את Electron האמיתי
const mockShell = vi.hoisted(() => ({
  openPath: vi.fn(async (_p: string) => ''),
  openExternal: vi.fn(async (_u: string) => undefined),
}));
vi.mock('electron', () => ({ shell: mockShell }));

import {
  createElectronLauncherAdapter,
  sanitizeChildEnv,
  SPAWN_TIMEOUT_ERROR,
  type SpawnFn,
} from '../../../src/main/launcher/electron-adapter';

const workDir = mkdtempSync(join(tmpdir(), 'jarvis-adapter-test-'));
afterAll(() => rmSync(workDir, { recursive: true, force: true }));

/** עוטף את spawn האמיתי ורושם את האפשרויות שהועברו. */
function recordingSpawn(): { fn: SpawnFn; calls: Array<{ file: string; args: readonly string[]; options: SpawnOptions }> } {
  const calls: Array<{ file: string; args: readonly string[]; options: SpawnOptions }> = [];
  const fn: SpawnFn = (file, args, options) => {
    calls.push({ file, args, options });
    return spawn(file, args, options);
  };
  return { fn, calls };
}

async function waitForFile(path: string, timeoutMs = 8000): Promise<string> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (existsSync(path)) {
      const text = readFileSync(path, 'utf8');
      if (text.endsWith('\n')) return text;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`file not written: ${path}`);
}

/** סקריפט שכותב את הארגומנטים וחלק מהסביבה לקובץ (argv[1] = נתיב הפלט כשמריצים עם -e). */
const CHILD_SCRIPT = [
  "const fs = require('fs');",
  'const out = process.argv[1];',
  'const payload = { args: process.argv.slice(2), cwd: process.cwd(),',
  '  runAsNode: process.env.ELECTRON_RUN_AS_NODE ?? null, nodeOptions: process.env.NODE_OPTIONS ?? null,',
  '  keep: process.env.JARVIS_TEST_KEEP ?? null };',
  "fs.writeFileSync(out, JSON.stringify(payload) + '\\n');",
].join('\n');

class FakeChild extends EventEmitter {
  pid = 777;
  unref = vi.fn();
}

describe('electron launcher adapter: spawnDetached against a real node process', () => {
  it("resolves on the 'spawn' event with a pid, passes args literally (shell:false) and detaches", async () => {
    const out = join(workDir, 'argv.json');
    const { fn, calls } = recordingSpawn();
    const adapter = createElectronLauncherAdapter({
      spawnImpl: fn,
      platform: 'linux',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '--require /nonexistent/evil.js', JARVIS_TEST_KEEP: 'yes' },
    });
    const tricky = ['a & echo hacked', '$(whoami)', '`id`', '| calc', '; rm -rf /', '"quoted"', '%PATH%'];
    const res = await adapter.spawnDetached(process.execPath, ['-e', CHILD_SCRIPT, out, ...tricky], workDir);

    expect(res.ok).toBe(true);
    expect(typeof res.pid).toBe('number');
    expect(calls).toHaveLength(1);
    const opts = calls[0]?.options;
    expect(opts?.shell).toBe(false);
    expect(opts?.detached).toBe(true);
    expect(opts?.stdio).toBe('ignore');
    expect(opts?.windowsHide).toBe(false);
    expect(opts?.cwd).toBe(workDir);

    const payload = JSON.parse(await waitForFile(out)) as {
      args: string[];
      cwd: string;
      runAsNode: string | null;
      nodeOptions: string | null;
      keep: string | null;
    };
    // בלי shell: התווים המיוחדים הגיעו כמו שהם, ושום פקודה לא התפרשה
    expect(payload.args).toEqual(tricky);
    expect(payload.cwd).toBe(workDir);
    // משתנים פנימיים של Electron/Node לא עוברים לתוכנה שנפתחת; השאר כן
    expect(payload.runAsNode).toBeNull();
    expect(payload.nodeOptions).toBeNull();
    expect(payload.keep).toBe('yes');
  });

  it("resolves ok:false on the 'error' event (nonexistent file)", async () => {
    const adapter = createElectronLauncherAdapter({ platform: 'linux' });
    const res = await adapter.spawnDetached(join(workDir, 'does-not-exist.exe'), [], workDir);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/ENOENT/);
  });

  it('guards with a start timeout when neither spawn nor error arrives (mock child)', async () => {
    const child = new FakeChild();
    const adapter = createElectronLauncherAdapter({
      platform: 'linux',
      startTimeoutMs: 30,
      spawnImpl: () => child as unknown as ChildProcess,
    });
    const res = await adapter.spawnDetached('/bin/true', [], '/');
    expect(res).toEqual({ ok: false, error: SPAWN_TIMEOUT_ERROR });
    expect(child.unref).toHaveBeenCalled();
    // אירוע spawn מאוחר לא משנה את התוצאה ולא זורק
    expect(() => child.emit('spawn')).not.toThrow();
  });

  it("an 'error' after a successful spawn never crashes main (listener stays attached) (mock child)", async () => {
    const child = new FakeChild();
    const adapter = createElectronLauncherAdapter({ platform: 'linux', spawnImpl: () => child as unknown as ChildProcess });
    const pending = adapter.spawnDetached('/bin/true', [], '/');
    child.emit('spawn');
    expect(await pending).toEqual({ ok: true, pid: 777 });
    expect(child.unref).toHaveBeenCalled();
    expect(() => child.emit('error', new Error('late failure'))).not.toThrow();
  });

  it('a synchronous spawn throw resolves ok:false instead of rejecting (mock spawn)', async () => {
    const adapter = createElectronLauncherAdapter({
      platform: 'linux',
      spawnImpl: () => {
        throw Object.assign(new Error('bad arg'), { code: 'ERR_INVALID_ARG_VALUE' });
      },
    });
    const res = await adapter.spawnDetached('/bin/true', [], '/');
    expect(res.ok).toBe(false);
    expect(res.error).toContain('ERR_INVALID_ARG_VALUE');
  });

  it('refuses NUL bytes in args, and on win32 anything that is not an absolute .exe path (mock spawn)', async () => {
    const spawnImpl = vi.fn<SpawnFn>();
    const linux = createElectronLauncherAdapter({ platform: 'linux', spawnImpl });
    expect((await linux.spawnDetached('/bin/true', ['a\0b'], '/')).ok).toBe(false);
    const win = createElectronLauncherAdapter({ platform: 'win32', spawnImpl });
    for (const file of ['notepad.exe', 'C:\\x\\run.bat', 'C:\\x\\run.cmd', '\\\\?\\C:\\x\\a.exe', 'C:\\a\\..\\cmd.exe']) {
      expect((await win.spawnDetached(file, [], 'C:\\x')).ok, file).toBe(false);
    }
    expect((await win.spawnDetached('C:\\x\\a.exe', [], 'relative')).ok).toBe(false);
    expect(spawnImpl).not.toHaveBeenCalled();
  });
});

describe('electron launcher adapter: shell (mock)', () => {
  it('openExternal passes only canonical allowed "<scheme>:" URIs to shell.openExternal (mock)', async () => {
    mockShell.openExternal.mockClear();
    const adapter = createElectronLauncherAdapter({ platform: 'win32' });
    await adapter.openExternal('spotify:');
    expect(mockShell.openExternal).toHaveBeenCalledWith('spotify:');
    for (const bad of ['spotify:track:1', 'Spotify:', 'https://evil.example', 'file:///C:/Windows/System32/calc.exe', 'ms-settings:']) {
      await expect(adapter.openExternal(bad), bad).rejects.toThrow();
    }
    expect(mockShell.openExternal).toHaveBeenCalledTimes(1);
  });

  it('openPath returns shell.openPath\'s error string, and converts throws to strings (mock)', async () => {
    const adapter = createElectronLauncherAdapter({ platform: 'win32' });
    mockShell.openPath.mockResolvedValueOnce('');
    expect(await adapter.openPath('D:\\Projects\\final.elk')).toBe('');
    mockShell.openPath.mockResolvedValueOnce('No application is associated');
    expect(await adapter.openPath('D:\\Projects\\final.elk')).toBe('No application is associated');
    mockShell.openPath.mockRejectedValueOnce(new Error('boom'));
    expect(await adapter.openPath('D:\\Projects\\final.elk')).toBe('boom');
    mockShell.openPath.mockClear();
    expect(await adapter.openPath('relative.elk')).not.toBe('');
    expect(mockShell.openPath).not.toHaveBeenCalled();
  });
});

describe('sanitizeChildEnv', () => {
  it('drops ELECTRON_* and NODE_OPTIONS case-insensitively and keeps the rest', () => {
    expect(
      sanitizeChildEnv({ PATH: 'x', electron_run_as_node: '1', ELECTRON_NO_ASAR: '1', Node_Options: '--x', APPDATA: 'y' }),
    ).toEqual({ PATH: 'x', APPDATA: 'y' });
  });
});

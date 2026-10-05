import { describe, expect, it } from 'vitest';
import { describeChangesForDialog, launcherChangesRequiringConfirmation, pathKey } from '../../../src/main/settings/launcher-guard';
import { checkConsistency, isLocalNetworkHost } from '../../../src/main/settings/settings-store';
import { defaultSettings, type AppEntry } from '../../../src/shared/settings-schema';

const s0 = defaultSettings();
const withApps = (apps: AppEntry[]) => ({ launcher: { ...s0.launcher, apps } });
const eplan = s0.launcher.apps.find((a) => a.id === 'eplan')!;

describe('launcher guard: changes to approved apps need a native confirmation', () => {
  it('a new EPLAN path typed in the renderer needs confirmation; the same path picked in the OS dialog does not', () => {
    const patch = withApps(s0.launcher.apps.map((a) => (a.id === 'eplan' ? { ...a, target: 'C:\\EPLAN\\Bin\\EPLAN.exe' } : a)));
    expect(launcherChangesRequiringConfirmation(s0, patch, new Set())).toHaveLength(1);
    expect(launcherChangesRequiringConfirmation(s0, patch, new Set([pathKey('c:/eplan/bin/eplan.exe')]))).toHaveLength(0);
  });

  it('arguments always need confirmation, even for a picked path', () => {
    const patch = withApps([...s0.launcher.apps, { ...eplan, id: 'evil', target: 'C:\\Tools\\x.exe', args: ['/run', 'payload'] }]);
    const changes = launcherChangesRequiringConfirmation(s0, patch, new Set([pathKey('C:\\Tools\\x.exe')]));
    expect(changes).toEqual([expect.objectContaining({ id: 'evil', reason: 'args' })]);
    expect(describeChangesForDialog(changes)).toContain('/run payload');
  });

  it('unchanged entries, URI apps and toggling enabled do not ask again', () => {
    const patch = withApps(s0.launcher.apps.map((a) => ({ ...a, enabled: !a.enabled })));
    expect(launcherChangesRequiringConfirmation(s0, patch, new Set())).toHaveLength(0);
    const uri = withApps([...s0.launcher.apps, { ...eplan, id: 'discord', kind: 'uri', target: 'discord:' }]);
    expect(launcherChangesRequiringConfirmation(s0, uri, new Set())).toHaveLength(0);
  });

  it('switching kind from uri to exe counts as a new target', () => {
    const patch = withApps(s0.launcher.apps.map((a) => (a.id === 'spotify' ? { ...a, kind: 'exe' as const, target: 'C:\\x\\Spotify.exe' } : a)));
    expect(launcherChangesRequiringConfirmation(s0, patch, new Set())).toHaveLength(1);
  });
});

describe('settings consistency: network paths and local STT host', () => {
  it('rejects UNC paths for executables and shortcuts', () => {
    const s = defaultSettings();
    s.launcher.apps.push({ ...eplan, id: 'net', target: '\\\\server\\share\\tool.exe' });
    expect(checkConsistency(s).join(' ')).toMatch(/רשת/);
  });

  it('only allows loopback / private-network hosts for the local STT server', () => {
    for (const h of ['localhost', '127.0.0.1', '::1', '[::1]', '10.0.0.5', '192.168.1.20', '172.16.0.1', '172.31.255.255']) expect(isLocalNetworkHost(h), h).toBe(true);
    for (const h of ['example.com', '8.8.8.8', '172.32.0.1', '192.169.0.1', 'evil.local', '127.0.0.1.nip.io']) expect(isLocalNetworkHost(h), h).toBe(false);
    const s = defaultSettings();
    s.stt.provider = 'local-openai-compatible';
    s.stt.localBaseUrl = 'https://exfil.example.com/v1';
    expect(checkConsistency(s).join(' ')).toMatch(/רשת המקומית/);
    s.stt.localBaseUrl = 'http://127.0.0.1:8000/v1';
    expect(checkConsistency(s)).toEqual([]);
  });
});

import { mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSettingsStore, SettingsValidationError, checkConsistency } from '../../../src/main/settings/settings-store';
import { createSecretStore, type SafeStorageLike } from '../../../src/main/secrets/secret-store';
import { silentLogger } from '../../../src/main/app/logger';
import { defaultSettings } from '../../../src/shared/settings-schema';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'jarvis-test-'));
}

describe('settings store', () => {
  it('creates defaults with the built-in EPLAN/Spotify entries and the final-project slot', () => {
    const dir = tempDir();
    const store = createSettingsStore({ file: join(dir, 'settings.json'), logger: silentLogger });
    const s = store.get();
    expect(s.profile.timezone).toBe('Asia/Jerusalem');
    expect(s.launcher.apps.map((a) => a.id)).toEqual(['eplan', 'spotify', 'notepad', 'calculator']);
    expect(s.launcher.defaultProjectId).toBe('final-project');
    expect(s.stt.openaiModel).toBe('gpt-transcribe');
    expect(existsSync(join(dir, 'settings.json'))).toBe(true);
  });

  it('merges a partial section patch, persists it, and notifies listeners', () => {
    const dir = tempDir();
    const file = join(dir, 'settings.json');
    const store = createSettingsStore({ file, logger: silentLogger });
    let notified = 0;
    store.onChange(() => notified++);
    const next = store.update({ ui: { alwaysOnTop: true } });
    expect(next.ui.alwaysOnTop).toBe(true);
    expect(next.ui.mode).toBe('full');
    expect(notified).toBe(1);
    const reloaded = createSettingsStore({ file, logger: silentLogger });
    expect(reloaded.get().ui.alwaysOnTop).toBe(true);
  });

  it('rejects invalid values and unknown keys without changing the stored settings', () => {
    const dir = tempDir();
    const store = createSettingsStore({ file: join(dir, 'settings.json'), logger: silentLogger });
    expect(() => store.update({ ai: { effort: 'turbo' as never } })).toThrow(SettingsValidationError);
    expect(() => store.update({ ui: { bogus: 1 } as never })).toThrow(SettingsValidationError);
    expect(() => store.update({ nope: {} } as never)).toThrow(SettingsValidationError);
    expect(store.get().ai.effort).toBe('low');
  });

  it('refuses to register command shells or scripts as approved applications', () => {
    const dir = tempDir();
    const store = createSettingsStore({ file: join(dir, 'settings.json'), logger: silentLogger });
    const apps = store.get().launcher.apps;
    const evil = [
      ...apps,
      { id: 'shell', name: 'shell', aliases: [], kind: 'exe' as const, target: 'C:\\Windows\\System32\\cmd.exe', args: ['/c', 'calc'], enabled: true, builtin: false },
    ];
    expect(() => store.update({ launcher: { ...store.get().launcher, apps: evil } })).toThrow(/cmd\.exe/);
    const ps = [
      ...apps,
      { id: 'ps', name: 'ps', aliases: [], kind: 'exe' as const, target: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\POWERSHELL.EXE', args: [], enabled: true, builtin: false },
    ];
    expect(() => store.update({ launcher: { ...store.get().launcher, apps: ps } })).toThrow(SettingsValidationError);
    const script = [
      ...apps,
      { id: 'bat', name: 'bat', aliases: [], kind: 'shortcut' as const, target: 'C:\\tools\\run.bat', args: [], enabled: true, builtin: false },
    ];
    expect(() => store.update({ launcher: { ...store.get().launcher, apps: script } })).toThrow(SettingsValidationError);
  });

  it('flags duplicate ids and a missing default project', () => {
    const s = defaultSettings();
    s.launcher.apps.push({ ...s.launcher.apps[0]! });
    s.launcher.defaultProjectId = 'missing';
    const issues = checkConsistency(s);
    expect(issues.some((i) => i.includes('eplan'))).toBe(true);
    expect(issues.some((i) => i.includes('ברירת המחדל'))).toBe(true);
  });

  it('backs up a corrupt settings file instead of deleting it, and loads defaults', () => {
    const dir = tempDir();
    const file = join(dir, 'settings.json');
    writeFileSync(file, '{ not json', 'utf8');
    const store = createSettingsStore({ file, logger: silentLogger, now: () => new Date('2026-10-05T12:00:00Z') });
    expect(store.get().schemaVersion).toBe(1);
    expect(readdirSync(dir).some((f) => f.startsWith('settings.json.invalid-'))).toBe(true);
  });
});

/** MOCK של safeStorage: "מצפין" בהיפוך בתים, כדי לבדוק שהקובץ לא מכיל את הערך הגלוי. */
function mockSafeStorage(available = true): SafeStorageLike {
  return {
    isAsyncEncryptionAvailable: async () => available,
    encryptStringAsync: async (s: string) => Buffer.from(Buffer.from(s, 'utf8').reverse()),
    decryptStringAsync: async (b: Buffer) => ({ shouldReEncrypt: false, result: Buffer.from(b).reverse().toString('utf8') }),
  };
}

describe('secret store (mock safeStorage)', () => {
  it('stores keys encrypted on disk, never in plain text, and reloads them', async () => {
    const dir = tempDir();
    const file = join(dir, 'secrets.json');
    const store = createSecretStore({ file, safeStorage: mockSafeStorage(), logger: silentLogger });
    await store.init();
    store.set('anthropicApiKey', 'sk-ant-test-1234567890');
    await store.flush();
    expect(readFileSync(file, 'utf8')).not.toContain('sk-ant-test-1234567890');
    const again = createSecretStore({ file, safeStorage: mockSafeStorage(), logger: silentLogger });
    await again.init();
    expect(again.get('anthropicApiKey')).toBe('sk-ant-test-1234567890');
    expect(again.status().entries.find((e) => e.name === 'anthropicApiKey')).toEqual({
      name: 'anthropicApiKey',
      configured: true,
      source: 'secure-store',
    });
  });

  it('keeps keys in memory only when encryption is unavailable', async () => {
    const dir = tempDir();
    const file = join(dir, 'secrets.json');
    const store = createSecretStore({ file, safeStorage: mockSafeStorage(false), logger: silentLogger });
    await store.init();
    store.set('openaiApiKey', 'sk-openai-abcdefgh12345');
    await store.flush();
    expect(store.get('openaiApiKey')).toBe('sk-openai-abcdefgh12345');
    expect(existsSync(file)).toBe(false);
    expect(store.status().secureStorageAvailable).toBe(false);
    expect(store.status().entries.find((e) => e.name === 'openaiApiKey')?.source).toBe('session');
  });

  it('falls back to environment variables and clears stored keys', async () => {
    const dir = tempDir();
    const store = createSecretStore({
      file: join(dir, 'secrets.json'),
      safeStorage: mockSafeStorage(),
      logger: silentLogger,
      env: { AZURE_SPEECH_KEY: 'env-azure-key-123' },
    });
    await store.init();
    expect(store.get('azureSpeechKey')).toBe('env-azure-key-123');
    store.set('anthropicApiKey', 'sk-ant-zzzzzzzzzz');
    store.clear('anthropicApiKey');
    await store.flush();
    expect(store.get('anthropicApiKey')).toBeNull();
  });

  it('rejects keys that are too short or contain whitespace', async () => {
    const store = createSecretStore({ file: join(tempDir(), 's.json'), safeStorage: mockSafeStorage(), logger: silentLogger });
    await store.init();
    expect(() => store.set('anthropicApiKey', 'short')).toThrow();
    expect(() => store.set('anthropicApiKey', 'has space inside key')).toThrow();
  });
});

import { describe, expect, it } from 'vitest';
import { createLauncherService, type LauncherServiceDeps } from '../../../src/main/launcher/launcher';
import {
  EPLAN_EXE,
  FINAL_ELK,
  app,
  configuredSettings,
  mockAdapter,
  mockLogger,
  mockReaddir,
  mockStat,
  project,
  settingsWith,
  type MockAdapter,
} from './local-tools.mock';

const FS = {
  [EPLAN_EXE]: 'file',
  [FINAL_ELK]: 'file',
  'C:\\Windows\\System32\\notepad.exe': 'file',
  'C:\\Windows\\System32\\calc.exe': 'file',
  'C:\\Windows\\System32\\cmd.exe': 'file',
  'C:\\Tools\\SHELL~1.EXE': 'file',
  'C:\\Users\\ori\\Desktop\\Teams.lnk': 'file',
  'D:\\Projects': 'dir',
  'D:\\Projects\\Pump\\pump.elk': 'file',
  'D:\\Projects\\Pump\\pump.edb': 'dir',
  'D:\\Projects\\odd.zw1': 'file',
  'D:\\Projects\\evil.exe': 'file',
} as const;

function setup(overrides: Partial<LauncherServiceDeps> & { adapter?: MockAdapter } = {}) {
  const adapter = overrides.adapter ?? mockAdapter();
  const stat = mockStat({ ...FS });
  const logger = mockLogger();
  const launcher = createLauncherService({
    stat,
    logger,
    // realpath MOCK: זהות (כמו קובץ רגיל בלי קישורים)
    realpath: async (p) => p,
    platform: 'win32',
    ...overrides,
    adapter,
  });
  return { launcher, adapter, stat, logger };
}

describe('launcher.openApplication (mock adapter + mock fs)', () => {
  it('opens EPLAN by spawning the exact configured target with ONLY the configured args (mock)', async () => {
    const { launcher, adapter } = setup();
    const res = await launcher.openApplication({ app_id: 'eplan', app_name: 'EPLAN /Variant:evil --run calc' }, configuredSettings());
    expect(res.ok).toBe(true);
    expect(res.status).toBe('success');
    expect(res.summary_he).toBe('פתחתי את EPLAN.');
    expect(adapter.calls.spawn).toEqual([
      { file: EPLAN_EXE, args: ['/NoSplash'], cwd: 'C:\\Program Files\\EPLAN\\Platform\\2024.0.3\\Bin' },
    ]);
    expect(adapter.calls.openPath).toEqual([]);
    expect(adapter.calls.openExternal).toEqual([]);
    expect(res.data).toEqual({ app_id: 'eplan', name: 'EPLAN', method: 'spawn', pid: 4242 });
  });

  it('resolves Hebrew aliases ("אי פלאן") to the same allowlisted entry (mock)', async () => {
    const { launcher, adapter } = setup();
    const res = await launcher.openApplication({ app_name: 'אי פלאן' }, configuredSettings());
    expect(res.ok).toBe(true);
    expect(adapter.calls.spawn[0]?.file).toBe(EPLAN_EXE);
  });

  it('quoted "Copy as path" targets are normalized before reaching the OS (mock)', async () => {
    const { launcher, adapter } = setup();
    const s = configuredSettings();
    s.launcher.apps = s.launcher.apps.map((a) => (a.id === 'eplan' ? { ...a, target: `"${EPLAN_EXE}"` } : a));
    const res = await launcher.openApplication({ app_id: 'eplan' }, s);
    expect(res.ok).toBe(true);
    expect(adapter.calls.spawn[0]?.file).toBe(EPLAN_EXE);
  });

  it('missing EPLAN path → NOT_CONFIGURED with the helpful settings message, OS never touched (mock)', async () => {
    const { launcher, adapter, stat } = setup();
    const res = await launcher.openApplication({ app_id: 'eplan' }, settingsWith());
    expect(res.ok).toBe(false);
    expect(res.error_code).toBe('NOT_CONFIGURED');
    expect(res.summary_he).toBe('הנתיב ל-EPLAN עדיין לא הוגדר. פתח הגדרות ← תוכנות ופרויקטים ובחר את הקובץ EPLAN.exe.');
    expect(adapter.totalCalls()).toBe(0);
    expect(stat.calls).toEqual([]);
  });

  it('configured path that does not exist → PATH_NOT_FOUND including the path (mock)', async () => {
    const { launcher, adapter } = setup();
    const s = configuredSettings();
    const missing = 'C:\\Program Files\\EPLAN\\Platform\\2.9\\Bin\\EPLAN.exe';
    s.launcher.apps = s.launcher.apps.map((a) => (a.id === 'eplan' ? { ...a, target: missing } : a));
    const res = await launcher.openApplication({ app_id: 'eplan' }, s);
    expect(res.error_code).toBe('PATH_NOT_FOUND');
    expect(res.summary_he).toContain(missing);
    expect(res.summary_he).toContain('הגדרות ← תוכנות ופרויקטים');
    expect(adapter.totalCalls()).toBe(0);
  });

  it('target that is a folder → PATH_INVALID; relative or ".." targets → PATH_INVALID without touching disk (mock)', async () => {
    const { launcher, adapter, stat } = setup();
    const withTarget = (target: string) => {
      const s = configuredSettings();
      s.launcher.apps = s.launcher.apps.map((a) => (a.id === 'eplan' ? { ...a, target } : a));
      return s;
    };
    expect((await launcher.openApplication({ app_id: 'eplan' }, withTarget('D:\\Projects'))).error_code).toBe('PATH_INVALID');
    stat.calls.length = 0;
    for (const bad of ['EPLAN.exe', 'C:\\Program Files\\..\\Windows\\System32\\calc.exe', '\\\\?\\C:\\x\\EPLAN.exe']) {
      const res = await launcher.openApplication({ app_id: 'eplan' }, withTarget(bad));
      expect(res.error_code, bad).toBe('PATH_INVALID');
    }
    expect(stat.calls).toEqual([]);
    expect(adapter.totalCalls()).toBe(0);
  });

  it('uri app "spotify:" → openExternal with the canonical URI only (mock)', async () => {
    const { launcher, adapter } = setup();
    const res = await launcher.openApplication({ app_name: 'ספוטיפיי' }, settingsWith());
    expect(res.ok).toBe(true);
    expect(adapter.calls.openExternal).toEqual(['spotify:']);
    expect(adapter.calls.spawn).toEqual([]);
    expect(res.data).toMatchObject({ app_id: 'spotify', method: 'shell-open-external' });
    // ניסוח זהיר: Windows קיבל את הבקשה — לא טוענים שהאפליקציה בהכרח עלתה
    expect(res.summary_he).toContain('ביקשתי מ-Windows לפתוח את Spotify');
  });

  it('a URI with parameters in settings is refused before reaching the OS (mock)', async () => {
    const { launcher, adapter } = setup();
    const s = settingsWith();
    s.launcher.apps = s.launcher.apps.map((a) => (a.id === 'spotify' ? { ...a, target: 'spotify:track:evil' } : a));
    const res = await launcher.openApplication({ app_id: 'spotify' }, s);
    expect(res.error_code).toBe('PATH_INVALID');
    expect(adapter.totalCalls()).toBe(0);
  });

  it('non-allowlisted app → NOT_ALLOWLISTED listing the approved apps; adapter never called (mock)', async () => {
    const { launcher, adapter, stat } = setup();
    const res = await launcher.openApplication({ app_name: 'Photoshop' }, configuredSettings());
    expect(res.ok).toBe(false);
    expect(res.error_code).toBe('NOT_ALLOWLISTED');
    expect(res.summary_he).toContain('EPLAN');
    expect(res.summary_he).toContain('Spotify');
    expect(res.summary_he).toContain('מחשבון');
    expect(adapter.totalCalls()).toBe(0);
    expect(stat.calls).toEqual([]);
  });

  it('a malicious app_name like "calc.exe & del C:\\" resolves to nothing and never reaches the OS (mock)', async () => {
    const { launcher, adapter, stat } = setup();
    for (const evil of [
      'calc.exe & del C:\\',
      'C:\\Windows\\System32\\cmd.exe /c del C:\\',
      'notepad.exe; rm -rf /',
      'spotify:track:1 && calc',
    ]) {
      const res = await launcher.openApplication({ app_name: evil }, configuredSettings());
      expect(res.error_code, evil).toBe('NOT_ALLOWLISTED');
    }
    const byId = await launcher.openApplication({ app_id: 'calc.exe & del C:\\' }, configuredSettings());
    expect(byId.error_code).toBe('NOT_ALLOWLISTED');
    expect(adapter.totalCalls()).toBe(0);
    expect(stat.calls).toEqual([]);
  });

  it('even when punctuation noise normalizes to an approved alias, only the settings target and args reach the OS (mock)', async () => {
    const { launcher, adapter } = setup();
    const res = await launcher.openApplication({ app_name: '"; calc; "' }, configuredSettings());
    expect(res.ok).toBe(true);
    expect(adapter.calls.spawn).toEqual([
      { file: 'C:\\Windows\\System32\\calc.exe', args: [], cwd: 'C:\\Windows\\System32' },
    ]);
  });

  it('a tie between two allowlisted apps → needs_clarification with options, nothing launched (mock)', async () => {
    const { launcher, adapter } = setup();
    const s = settingsWith({
      apps: [
        app({ id: 'player-a', name: 'Player A', kind: 'uri', target: 'spotify:', aliases: ['נגן מוזיקה'] }),
        app({ id: 'player-b', name: 'Player B', kind: 'uri', target: 'discord:', aliases: ['נגן מוזיקה'] }),
      ],
    });
    const res = await launcher.openApplication({ app_name: 'נגן מוזיקה' }, s);
    expect(res.status).toBe('needs_clarification');
    expect(res.error_code).toBe('AMBIGUOUS');
    expect(res.options).toEqual([
      { id: 'player-a', label: 'Player A' },
      { id: 'player-b', label: 'Player B' },
    ]);
    expect(adapter.totalCalls()).toBe(0);
  });

  it('a disabled app is not opened (mock)', async () => {
    const { launcher, adapter } = setup();
    const s = configuredSettings();
    s.launcher.apps = s.launcher.apps.map((a) => (a.id === 'eplan' ? { ...a, enabled: false } : a));
    const res = await launcher.openApplication({ app_id: 'eplan' }, s);
    expect(res.error_code).toBe('NOT_ALLOWLISTED');
    expect(res.summary_he).toContain('מושבתת');
    expect(adapter.totalCalls()).toBe(0);
  });

  it('command shells are refused even if hand-edited into settings, including via 8.3 short names (mock)', async () => {
    const shellApp = (target: string) =>
      settingsWith({ apps: [app({ id: 'tool', name: 'Tool', kind: 'exe', target, args: ['/c', 'calc'] })] });
    {
      const { launcher, adapter } = setup();
      const res = await launcher.openApplication({ app_id: 'tool' }, shellApp('C:\\Windows\\System32\\CMD.EXE'));
      expect(res.error_code).toBe('NOT_ALLOWLISTED');
      expect(adapter.totalCalls()).toBe(0);
    }
    {
      // שם מקוצר שמפנה בפועל ל-powershell.exe
      const { launcher, adapter } = setup({
        realpath: async () => 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      });
      const res = await launcher.openApplication({ app_id: 'tool' }, shellApp('C:\\Tools\\SHELL~1.EXE'));
      expect(res.error_code).toBe('NOT_ALLOWLISTED');
      expect(adapter.totalCalls()).toBe(0);
    }
    {
      // שם מקוצר שאי אפשר לפתור → לא מפעילים (אי אפשר לוודא שהוא לא חסום)
      const { launcher, adapter } = setup({
        realpath: async () => {
          throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
        },
      });
      const res = await launcher.openApplication({ app_id: 'tool' }, shellApp('C:\\Tools\\SHELL~1.EXE'));
      expect(res.error_code).toBe('NOT_ALLOWLISTED');
      expect(res.summary_he).toContain('8.3');
      expect(adapter.totalCalls()).toBe(0);
    }
  });

  it('command-proxy system tools (LOLBins) are refused as well (mock)', async () => {
    const { launcher, adapter } = setup({ stat: mockStat({ 'C:\\Windows\\System32\\forfiles.exe': 'file' }) });
    const s = settingsWith({ apps: [app({ id: 'ff', name: 'FF', kind: 'exe', target: 'C:\\Windows\\System32\\forfiles.exe' })] });
    const res = await launcher.openApplication({ app_id: 'ff' }, s);
    expect(res.error_code).toBe('NOT_ALLOWLISTED');
    expect(adapter.totalCalls()).toBe(0);
  });

  it('OS spawn failure → LAUNCH_FAILED with a Hebrew reason (mock)', async () => {
    const { launcher } = setup({ adapter: mockAdapter({ spawn: { ok: false, error: 'EACCES: spawn EACCES' } }) });
    const res = await launcher.openApplication({ app_id: 'eplan' }, configuredSettings());
    expect(res.ok).toBe(false);
    expect(res.error_code).toBe('LAUNCH_FAILED');
    expect(res.summary_he).toContain('לא הצלחתי לפתוח את EPLAN');
    expect(res.summary_he).toContain('הרשאות מנהל');
  });

  it('spawn start timeout is reported honestly as "not confirmed", not as a definite failure (mock)', async () => {
    const { launcher } = setup({ adapter: mockAdapter({ spawn: { ok: false, error: 'TIMEOUT' } }) });
    const res = await launcher.openApplication({ app_id: 'eplan' }, configuredSettings());
    expect(res.error_code).toBe('LAUNCH_FAILED');
    expect(res.summary_he).toContain('ייתכן שהיא עדיין נפתחת');
  });

  it('an adapter that throws never escapes as an exception (mock)', async () => {
    const { launcher } = setup({ adapter: mockAdapter({ spawn: new Error('boom') }) });
    const res = await launcher.openApplication({ app_id: 'eplan' }, configuredSettings());
    expect(res.error_code).toBe('LAUNCH_FAILED');
  });

  it('a shortcut app is opened with openPath, never spawn (mock)', async () => {
    const { launcher, adapter } = setup();
    const s = settingsWith({
      apps: [app({ id: 'teams', name: 'Teams', kind: 'shortcut', target: 'C:\\Users\\ori\\Desktop\\Teams.lnk' })],
    });
    const res = await launcher.openApplication({ app_name: 'teams' }, s);
    expect(res.ok).toBe(true);
    expect(adapter.calls.openPath).toEqual(['C:\\Users\\ori\\Desktop\\Teams.lnk']);
    expect(adapter.calls.spawn).toEqual([]);
  });

  it('a stuck network path times out as PATH_NOT_FOUND instead of hanging (mock)', async () => {
    const { launcher, adapter } = setup({ stat: () => new Promise(() => {}), fsTimeoutMs: 20 });
    const s = configuredSettings();
    s.launcher.apps = s.launcher.apps.map((a) => (a.id === 'eplan' ? { ...a, target: '\\\\nas\\apps\\EPLAN\\EPLAN.exe' } : a));
    const res = await launcher.openApplication({ app_id: 'eplan' }, s);
    expect(res.error_code).toBe('PATH_NOT_FOUND');
    expect(res.summary_he).toContain('לא הגיב בזמן');
    expect(adapter.totalCalls()).toBe(0);
  });
});

describe('launcher.openProject (mock adapter + mock fs)', () => {
  it('opens the project via openPath with the configured path — never spawn, never model input (mock)', async () => {
    const { launcher, adapter } = setup();
    const res = await launcher.openProject({ project_name: 'פרויקט הגמר' }, configuredSettings());
    expect(res.ok).toBe(true);
    expect(res.summary_he).toBe('פתחתי את פרויקט הגמר (final.elk) בתוכנה המשויכת.');
    expect(res.data).toEqual({ project_id: 'final-project', name: 'פרויקט הגמר', file: 'final.elk', method: 'shell-open-path' });
    expect(adapter.calls.openPath).toEqual([FINAL_ELK]);
    expect(adapter.calls.spawn).toEqual([]);
    expect(adapter.calls.openExternal).toEqual([]);
  });

  it('a path given as project_name is only a search string: nothing outside settings is opened (mock)', async () => {
    const { launcher, adapter, stat } = setup();
    for (const evil of ['C:\\Windows\\System32\\calc.exe', 'D:\\Projects\\evil.exe', '..\\..\\x.elk']) {
      const res = await launcher.openProject({ project_name: evil }, configuredSettings());
      expect(res.ok, evil).toBe(false);
      expect(res.error_code, evil).toBe('NOT_FOUND');
    }
    expect(adapter.totalCalls()).toBe(0);
    expect(stat.calls).toEqual([]);
  });

  it('no query → the default project (mock)', async () => {
    const { launcher, adapter } = setup();
    const res = await launcher.openProject({}, configuredSettings());
    expect(res.ok).toBe(true);
    expect(adapter.calls.openPath).toEqual([FINAL_ELK]);
  });

  it('default project without a path → NOT_CONFIGURED with a Hebrew hint (mock)', async () => {
    const { launcher, adapter } = setup();
    const res = await launcher.openProject({}, settingsWith());
    expect(res.error_code).toBe('NOT_CONFIGURED');
    expect(res.summary_he).toContain('הנתיב לפרויקט הגמר עדיין לא הוגדר');
    expect(res.summary_he).toContain('.elk');
    expect(adapter.totalCalls()).toBe(0);
  });

  it('several plausible projects and no exact id → needs_clarification with options, never a guess (mock)', async () => {
    const { launcher, adapter } = setup();
    const s = settingsWith({
      projects: [
        project({ id: 'pump-a', name: 'פרויקט אלפא', path: 'D:\\Projects\\Pump\\pump.elk' }),
        project({ id: 'pump-b', name: 'פרויקט אלפי', path: FINAL_ELK }),
      ],
      defaultProjectId: '',
    });
    const res = await launcher.openProject({ project_name: 'פרויקט אלפו' }, s);
    expect(res.status).toBe('needs_clarification');
    expect(res.options?.map((o) => o.id).sort()).toEqual(['pump-a', 'pump-b']);
    expect(res.options?.find((o) => o.id === 'pump-a')?.label).toBe('פרויקט אלפא (pump.elk)');
    expect(adapter.totalCalls()).toBe(0);

    // שני פרויקטים עם אותו כינוי בדיוק → גם כן הבהרה
    const shared = settingsWith({
      projects: [
        project({ id: 'a', name: 'מכונה א', aliases: ['הפרויקט של דני'], path: FINAL_ELK }),
        project({ id: 'b', name: 'מכונה ב', aliases: ['הפרויקט של דני'], path: FINAL_ELK }),
      ],
      defaultProjectId: '',
    });
    expect((await launcher.openProject({ project_name: 'הפרויקט של דני' }, shared)).status).toBe('needs_clarification');
    expect(adapter.totalCalls()).toBe(0);
  });

  it('an exact id wins even when names are similar (mock)', async () => {
    const { launcher, adapter } = setup();
    const s = settingsWith({
      projects: [
        project({ id: 'pump-a', name: 'פרויקט אלפא', path: 'D:\\Projects\\Pump\\pump.elk' }),
        project({ id: 'pump-b', name: 'פרויקט אלפי', path: FINAL_ELK }),
      ],
      defaultProjectId: '',
    });
    const res = await launcher.openProject({ project_id: 'pump-b', project_name: 'פרויקט אלפו' }, s);
    expect(res.ok).toBe(true);
    expect(adapter.calls.openPath).toEqual([FINAL_ELK]);
  });

  it('no default and no query → asks which project instead of guessing (mock)', async () => {
    const { launcher, adapter } = setup();
    const s = configuredSettings();
    s.launcher.defaultProjectId = '';
    const res = await launcher.openProject({}, s);
    expect(res.status).toBe('needs_clarification');
    expect(res.options?.[0]?.id).toBe('final-project');
    expect(adapter.totalCalls()).toBe(0);
    const none = await launcher.openProject({}, settingsWith({ projects: [], defaultProjectId: '' }));
    expect(none.error_code).toBe('NOT_CONFIGURED');
  });

  it('missing project file → PATH_NOT_FOUND with the path (mock)', async () => {
    const { launcher, adapter } = setup();
    const s = configuredSettings();
    s.launcher.projects = s.launcher.projects.map((p) => ({ ...p, path: 'D:\\Old\\final.elk' }));
    const res = await launcher.openProject({}, s);
    expect(res.error_code).toBe('PATH_NOT_FOUND');
    expect(res.summary_he).toContain('D:\\Old\\final.elk');
    expect(adapter.totalCalls()).toBe(0);
  });

  it('a project that points to an executable is refused (mock)', async () => {
    const { launcher, adapter } = setup();
    for (const kind of ['eplan', 'file'] as const) {
      const s = settingsWith({ projects: [project({ id: 'x', name: 'X', path: 'D:\\Projects\\evil.exe', kind })], defaultProjectId: 'x' });
      const res = await launcher.openProject({}, s);
      expect(res.error_code, kind).toBe('PATH_INVALID');
    }
    expect(adapter.totalCalls()).toBe(0);
  });

  it('openPath error (no associated app) → LAUNCH_FAILED with the "open once with EPLAN" hint (mock)', async () => {
    const { launcher } = setup({ adapter: mockAdapter({ openPath: 'No application is associated with the specified file for this operation.' }) });
    const res = await launcher.openProject({}, configuredSettings());
    expect(res.ok).toBe(false);
    expect(res.error_code).toBe('LAUNCH_FAILED');
    expect(res.summary_he).toContain('ל-Windows אין תוכנה משויכת לסוג הקובץ הזה');
    expect(res.summary_he).toContain('EPLAN');
    expect(res.summary_he).toContain('"תמיד"');
  });

  it('a drive-root folder project still gets a readable summary (mock)', async () => {
    const { launcher, adapter } = setup({ stat: mockStat({ 'E:\\': 'dir' }) });
    const s = settingsWith({ projects: [project({ id: 'usb', name: 'הדיסק החיצוני', kind: 'folder', path: 'E:\\' })], defaultProjectId: 'usb' });
    const res = await launcher.openProject({}, s);
    expect(res.ok).toBe(true);
    expect(adapter.calls.openPath).toEqual(['E:\\']);
    expect(res.summary_he).toBe('פתחתי את הדיסק החיצוני (E:\\) בסייר הקבצים.');
  });

  it('folder projects open in Explorer (mock)', async () => {
    const { launcher, adapter } = setup();
    const s = settingsWith({ projects: [project({ id: 'dir', name: 'תיקיית הפרויקטים', kind: 'folder', path: 'D:\\Projects\\' })], defaultProjectId: 'dir' });
    const res = await launcher.openProject({}, s);
    expect(res.ok).toBe(true);
    expect(adapter.calls.openPath).toEqual(['D:\\Projects']);
    expect(res.summary_he).toContain('בסייר הקבצים');
  });
});

describe('launcher.validatePath (mock fs)', () => {
  it('validates exe / eplan / folder / uri with Hebrew messages (mock)', async () => {
    const { launcher } = setup();
    expect(await launcher.validatePath(EPLAN_EXE, 'exe')).toMatchObject({ ok: true, exists: true, detectedKind: 'exe' });
    const missing = await launcher.validatePath('C:\\nope\\EPLAN.exe', 'exe');
    expect(missing).toMatchObject({ ok: false, exists: false });
    expect(missing.message_he).toContain('לא נמצא');
    expect(await launcher.validatePath('D:\\Projects', 'folder')).toMatchObject({ ok: true, detectedKind: 'folder' });
    expect(await launcher.validatePath('D:\\Projects', 'exe')).toMatchObject({ ok: false, exists: true, detectedKind: 'folder' });
    expect(await launcher.validatePath('spotify:', 'uri')).toMatchObject({ ok: true, detectedKind: 'uri' });
    expect((await launcher.validatePath('spotify:track:1', 'uri')).ok).toBe(false);
    const odd = await launcher.validatePath('D:\\Projects\\odd.zw1', 'eplan');
    expect(odd.ok).toBe(true);
    expect(odd.message_he).toContain('אינה סיומת מוכרת');
    const edb = await launcher.validatePath('D:\\Projects\\Pump\\pump.edb', 'eplan');
    expect(edb).toMatchObject({ ok: false, exists: true, detectedKind: 'folder' });
    expect(edb.message_he).toContain('.elk');
    expect((await launcher.validatePath('C:\\Windows\\System32\\cmd.exe', 'exe')).ok).toBe(false);
    expect((await launcher.validatePath('relative\\x.exe', 'exe')).message_he).toContain('אות כונן');
  });

  it('access denied does not claim the path exists (mock)', async () => {
    const { launcher } = setup({
      stat: async () => {
        throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
      },
    });
    const res = await launcher.validatePath('D:\\Secret\\x.elk', 'eplan');
    expect(res).toMatchObject({ ok: false, exists: false, detectedKind: 'unknown' });
    expect(res.message_he).toContain('אין הרשאת גישה');
  });
});

describe('launcher.detectApps (mock fs, no shell)', () => {
  const env = {
    ProgramFiles: 'C:\\Program Files',
    PROGRAMW6432: 'C:\\Program Files',
    'ProgramFiles(x86)': 'C:\\Program Files (x86)',
    APPDATA: 'C:\\Users\\ori\\AppData\\Roaming',
  };

  it('finds EPLAN Platform and Electric P8 installs (newest first) and Spotify in %APPDATA% (mock)', async () => {
    const stat = mockStat({
      'C:\\Program Files\\EPLAN\\Platform\\2024.0.3\\Bin\\EPLAN.exe': 'file',
      'C:\\Program Files (x86)\\EPLAN\\Electric P8\\2.9.4\\Bin\\EPLAN.exe': 'file',
      'C:\\Users\\ori\\AppData\\Roaming\\Spotify\\Spotify.exe': 'file',
    });
    const readdir = mockReaddir({
      'C:\\Program Files\\EPLAN': ['Platform', 'Common'],
      'C:\\Program Files\\EPLAN\\Platform': ['2024.0.3', '2023.0.3'],
      'C:\\Program Files\\EPLAN\\Common': ['x'],
      'C:\\Program Files (x86)\\EPLAN': ['Electric P8'],
      'C:\\Program Files (x86)\\EPLAN\\Electric P8': ['2.9.4'],
    });
    const { launcher, adapter } = setup({ stat, readdir, env, platform: 'win32' });
    const found = await launcher.detectApps();
    expect(found).toEqual([
      { name: 'EPLAN Platform 2024.0.3', path: 'C:\\Program Files\\EPLAN\\Platform\\2024.0.3\\Bin\\EPLAN.exe', kind: 'exe', suggestedId: 'eplan' },
      { name: 'EPLAN Electric P8 2.9.4', path: 'C:\\Program Files (x86)\\EPLAN\\Electric P8\\2.9.4\\Bin\\EPLAN.exe', kind: 'exe', suggestedId: 'eplan-electric-p8-2-9-4' },
      { name: 'Spotify', path: 'C:\\Users\\ori\\AppData\\Roaming\\Spotify\\Spotify.exe', kind: 'exe', suggestedId: 'spotify' },
    ]);
    for (const c of found) expect(c.suggestedId).toMatch(/^[a-z0-9][a-z0-9_-]{0,39}$/);
    expect(adapter.totalCalls()).toBe(0);
  });

  it('suggests the spotify: URI when the desktop installer version is absent (mock)', async () => {
    const { launcher } = setup({ stat: mockStat({}), readdir: mockReaddir({}), env, platform: 'win32' });
    expect(await launcher.detectApps()).toEqual([
      { name: 'Spotify (גרסת Microsoft Store)', path: 'spotify:', kind: 'uri', suggestedId: 'spotify' },
    ]);
  });

  it('returns [] on non-Windows platforms', async () => {
    const { launcher } = setup({ platform: 'linux', env });
    expect(await launcher.detectApps()).toEqual([]);
  });
});

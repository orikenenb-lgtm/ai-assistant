import { describe, expect, it } from 'vitest';
import {
  checkExtension,
  checkWindowsPath,
  isAbsoluteWindowsPath,
  isDevicePath,
  kindFromExtension,
  looksLikeShortName,
  parseAllowedUri,
  unquoteWindowsPath,
} from '../../../src/main/launcher/path-rules';

describe('path-rules: absolute Windows paths (path.win32 on Linux)', () => {
  it('accepts drive-letter and UNC paths', () => {
    expect(isAbsoluteWindowsPath('C:\\Program Files\\EPLAN\\Platform\\2024.0.3\\Bin\\EPLAN.exe')).toBe(true);
    expect(isAbsoluteWindowsPath('d:/Projects/final.elk')).toBe(true);
    expect(isAbsoluteWindowsPath('\\\\server\\share\\Projects\\final.elk')).toBe(true);
    expect(isAbsoluteWindowsPath('//server/share/x.elk')).toBe(true);
  });

  it('rejects relative, drive-relative, root-relative and POSIX paths', () => {
    for (const p of ['EPLAN.exe', '.\\EPLAN.exe', 'C:EPLAN.exe', '\\Windows\\notepad.exe', '/usr/bin/x', '\\\\server', '']) {
      expect(isAbsoluteWindowsPath(p), p).toBe(false);
    }
  });

  it('rejects device paths (\\\\.\\ and \\\\?\\) in both slash styles', () => {
    for (const p of ['\\\\.\\C:\\x.exe', '\\\\?\\C:\\x.exe', '//./pipe/x', '//?/UNC/server/share/x', '\\\\?\\UNC\\server\\share\\x']) {
      expect(isDevicePath(p), p).toBe(true);
      expect(isAbsoluteWindowsPath(p), p).toBe(false);
      const res = checkWindowsPath(p);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.issue).toBe('device_path');
    }
  });

  it('normalizes separators and strips "Copy as path" quotes', () => {
    const res = checkWindowsPath('"C:/Program Files/EPLAN/Platform/2024.0.3/Bin/EPLAN.exe"');
    expect(res).toEqual({ ok: true, normalized: 'C:\\Program Files\\EPLAN\\Platform\\2024.0.3\\Bin\\EPLAN.exe' });
    expect(unquoteWindowsPath('  "C:\\a b\\c.elk"  ')).toBe('C:\\a b\\c.elk');
  });

  it('strips invisible bidi marks that Windows dialogs add to pasted Hebrew paths', () => {
    // "מאפיינים ← אבטחה ← שם אובייקט" מוסיף U+202A בהתחלה; העתקה מטקסט עברי מוסיפה RLM בסוף
    const res = checkWindowsPath('\u202AC:\\Users\\אורי\\מסמכים\\פרויקט גמר\\final.elk\u200F');
    expect(res).toEqual({ ok: true, normalized: 'C:\\Users\\אורי\\מסמכים\\פרויקט גמר\\final.elk' });
    expect(unquoteWindowsPath('"\u2067C:\\a\\b.exe\u2069"')).toBe('C:\\a\\b.exe');
  });

  it('keeps drive and UNC share roots but strips other trailing separators', () => {
    expect(checkWindowsPath('C:\\')).toEqual({ ok: true, normalized: 'C:\\' });
    expect(checkWindowsPath('C:\\Projects\\')).toEqual({ ok: true, normalized: 'C:\\Projects' });
    expect(checkWindowsPath('\\\\nas\\share')).toEqual({ ok: true, normalized: '\\\\nas\\share\\' });
  });

  it('rejects ".." segments (also with mixed separators) but allows "." segments', () => {
    for (const p of ['C:\\Projects\\..\\Windows\\System32\\cmd.exe', 'C:/a/../b.exe', '\\\\server\\share\\..\\x']) {
      const res = checkWindowsPath(p);
      expect(res.ok, p).toBe(false);
      if (!res.ok) expect(res.issue).toBe('parent_segment');
    }
    expect(checkWindowsPath('C:\\Projects\\.\\final.elk')).toEqual({ ok: true, normalized: 'C:\\Projects\\final.elk' });
  });

  it('rejects NUL bytes, invalid characters, alternate data streams and env vars', () => {
    const nul = checkWindowsPath('C:\\a\0b.exe');
    expect(nul.ok).toBe(false);
    if (!nul.ok) expect(nul.issue).toBe('nul_byte');
    for (const p of ['C:\\a|b.exe', 'C:\\a<b>.exe', 'C:\\a?.exe', 'C:\\a*.exe', 'C:\\a\tb.exe', 'C:\\EPLAN.exe:evil']) {
      const res = checkWindowsPath(p);
      expect(res.ok, p).toBe(false);
      if (!res.ok) expect(res.issue).toBe('invalid_chars');
    }
    const env = checkWindowsPath('%ProgramFiles%\\EPLAN\\EPLAN.exe');
    expect(env.ok).toBe(false);
    if (!env.ok) {
      expect(env.issue).toBe('env_var');
      expect(env.message_he).toMatch(/משתני סביבה/);
    }
  });

  it('rejects trailing dots/spaces (Windows silently strips them: "cmd.exe." == "cmd.exe")', () => {
    for (const p of ['C:\\Windows\\System32\\cmd.exe.', 'C:\\Tools \\x.exe', 'C:\\Tools.\\x.exe', 'C:\\x.exe...']) {
      const res = checkWindowsPath(p);
      expect(res.ok, p).toBe(false);
      if (!res.ok) expect(res.issue).toBe('trailing_dot_space');
    }
    // רווחים בקצוות של כל הערך נחתכים (כמו ש-Windows היה עושה) — התוצאה היא הנתיב הקנוני
    expect(checkWindowsPath('  C:\\Tools\\x.exe  ')).toEqual({ ok: true, normalized: 'C:\\Tools\\x.exe' });
  });

  it('rejects reserved device names, even with an extension', () => {
    for (const p of ['C:\\x\\CON', 'C:\\x\\nul.txt', 'C:\\COM1\\a.elk', 'C:\\x\\lpt9.elk', 'C:\\x\\CONIN$']) {
      const res = checkWindowsPath(p);
      expect(res.ok, p).toBe(false);
      if (!res.ok) expect(res.issue).toBe('reserved_name');
    }
  });

  it('gives Hebrew messages for every failure', () => {
    for (const p of ['', 'relative.exe', 'C:\\a\\..\\b', '\\\\.\\x']) {
      const res = checkWindowsPath(p);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.message_he).toMatch(/[\u05d0-\u05ea]/);
    }
  });

  it('flags 8.3 short names that must be resolved before deny-list checks', () => {
    expect(looksLikeShortName('POWERS~1.EXE')).toBe(true);
    expect(looksLikeShortName('EPLAN.exe')).toBe(false);
  });
});

describe('path-rules: extension rules', () => {
  it('exe requires .exe (case-insensitive); a shortcut gets a helpful hint', () => {
    expect(checkExtension('C:\\x\\EPLAN.EXE', 'exe')).toEqual({ ok: true });
    const lnk = checkExtension('C:\\x\\EPLAN.lnk', 'exe');
    expect(lnk.ok).toBe(false);
    if (!lnk.ok) expect(lnk.message_he).toMatch(/קיצור דרך/);
    expect(checkExtension('C:\\x\\run.bat', 'exe').ok).toBe(false);
    expect(checkExtension('C:\\x\\run.com', 'exe').ok).toBe(false);
  });

  it('shortcut requires .lnk / .url / .appref-ms', () => {
    for (const p of ['a.lnk', 'a.URL', 'a.appref-ms']) expect(checkExtension(`C:\\${p}`, 'shortcut').ok, p).toBe(true);
    expect(checkExtension('C:\\a.exe', 'shortcut').ok).toBe(false);
  });

  it('EPLAN project: recommended extensions pass, others pass only with a warning, executables never', () => {
    for (const ext of ['.elk', '.elp', '.els', '.ell', '.elr', '.elx']) {
      expect(checkExtension(`D:\\p\\final${ext}`, 'eplan')).toEqual({ ok: true });
    }
    const zip = checkExtension('D:\\p\\final.zw1', 'eplan');
    expect(zip.ok).toBe(true);
    if (zip.ok) expect(zip.warning_he).toMatch(/אינה סיומת מוכרת/);
    for (const bad of ['x.exe', 'x.bat', 'x.cmd', 'x.ps1', 'x.lnk', 'x.js', 'x.vbs', 'x.msi', 'x.hta', 'x.scr', 'x.appx']) {
      expect(checkExtension(`D:\\p\\${bad}`, 'eplan').ok, bad).toBe(false);
      expect(checkExtension(`D:\\p\\${bad}`, 'file').ok, bad).toBe(false);
    }
    const edb = checkExtension('D:\\p\\final.edb', 'eplan');
    expect(edb.ok).toBe(false);
    if (!edb.ok) expect(edb.message_he).toMatch(/\.elk/);
  });

  it('kindFromExtension detects exe / shortcut / file', () => {
    expect(kindFromExtension('C:\\a\\b.EXE')).toBe('exe');
    expect(kindFromExtension('C:\\a\\b.lnk')).toBe('shortcut');
    expect(kindFromExtension('C:\\a\\b.elk')).toBe('file');
  });
});

describe('path-rules: URI rules (exactly "<scheme>:")', () => {
  it('accepts only allowed schemes, canonicalized to lower case', () => {
    expect(parseAllowedUri('spotify:')).toEqual({ ok: true, uri: 'spotify:', scheme: 'spotify' });
    expect(parseAllowedUri('Spotify:')).toEqual({ ok: true, uri: 'spotify:', scheme: 'spotify' });
    expect(parseAllowedUri('msteams:').ok).toBe(true);
  });

  it('rejects any path, query, parameters or unknown schemes — the model can never inject parameters', () => {
    for (const u of [
      'spotify:track:123',
      'spotify://open',
      'spotify:?q=x',
      'spotify:#x',
      'spotify: calc',
      'steam://run/123',
      'ms-settings:',
      'file:',
      'javascript:',
      'http:',
      'search-ms:',
      'spotify',
      '',
      'spotify:\0',
    ]) {
      const res = parseAllowedUri(u);
      expect(res.ok, JSON.stringify(u)).toBe(false);
      if (!res.ok) expect(res.message_he).toMatch(/[\u05d0-\u05ea]/);
    }
  });
});

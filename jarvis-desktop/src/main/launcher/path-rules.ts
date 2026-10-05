/**
 * כללי נתיבים ל-Windows — פונקציות טהורות, בלי גישה לדיסק.
 * משתמשים ב-path.win32 במפורש: מערכת היעד היא Windows גם כשהבדיקות רצות על Linux.
 * כל נתיב או URI שמגיע מההגדרות עובר כאן לפני שמשהו נשלח למערכת ההפעלה.
 */
import { win32 as winPath } from 'node:path';
import { ALLOWED_URI_SCHEMES } from '../../shared/settings-schema';

export type AllowedUriScheme = (typeof ALLOWED_URI_SCHEMES)[number];

/** אורך מקסימלי — זהה למגבלה בסכמת ההגדרות. */
export const MAX_WINDOWS_PATH_LENGTH = 1024;

export const EXE_EXTENSIONS: readonly string[] = ['.exe'];
export const SHORTCUT_EXTENSIONS: readonly string[] = ['.lnk', '.url', '.appref-ms'];
/** סיומות של פרויקט EPLAN: ‎.elk רגיל, ‎.elp ארוז, ‎.els פשוט, ‎.ell מנוהל, ‎.elr סגור, ‎.elx מוגן. */
export const EPLAN_PROJECT_EXTENSIONS: readonly string[] = ['.elk', '.elp', '.els', '.ell', '.elr', '.elx'];

/**
 * סיומות שפתיחה שלהן ב-Windows מריצה קוד (או מתקינה משהו). "פרויקט" הוא מסמך — אסור שיהיה אחד מאלה,
 * אחרת "פתיחת פרויקט" הייתה הופכת לדרך עוקפת להריץ תוכנה שלא ברשימה המאושרת.
 */
export const EXECUTABLE_EXTENSIONS: readonly string[] = [
  '.exe', '.com', '.bat', '.cmd', '.ps1', '.psm1', '.psd1', '.ps1xml', '.psc1', '.vbs', '.vbe', '.vb',
  '.js', '.jse', '.wsf', '.wsh', '.ws', '.msi', '.msp', '.mst', '.msix', '.msixbundle', '.appx',
  '.appxbundle', '.appinstaller', '.scr', '.pif', '.hta', '.cpl', '.msc', '.jar', '.reg', '.inf',
  '.application', '.xbap', '.lnk', '.url', '.appref-ms', '.website', '.scf', '.shb', '.shs', '.sct',
  '.dll', '.ocx', '.sys', '.drv', '.chm', '.gadget', '.settingcontent-ms', '.library-ms',
  '.search-ms', '.searchconnector-ms', '.diagcab', '.py', '.pyw', '.pyc', '.pyz', '.mshxml', '.msh',
];

/**
 * תוכנות מערכת שמריצות פקודה או קוד אחר דרך הארגומנטים שלהן ("LOLBins").
 * משלים את FORBIDDEN_LAUNCH_TARGETS שבהגדרות — הגנה כפולה בזמן הפעלה, גם אם ההגדרות נערכו ידנית.
 */
export const COMMAND_PROXY_EXECUTABLES: readonly string[] = [
  'forfiles.exe', 'pcalua.exe', 'scriptrunner.exe', 'cmstp.exe', 'msdt.exe', 'hh.exe', 'runas.exe',
  'wmic.exe', 'msxsl.exe', 'odbcconf.exe', 'mavinject.exe', 'ieexec.exe', 'regasm.exe', 'regsvcs.exe',
  'presentationhost.exe', 'infdefaultinstall.exe', 'syncappvpublishingserver.exe', 'at.exe', 'sc.exe',
  'winrs.exe', 'finger.exe', 'bash.exe', 'wsl.exe', 'wslhost.exe', 'ubuntu.exe',
];

export type WindowsPathIssue =
  | 'empty'
  | 'too_long'
  | 'nul_byte'
  | 'device_path'
  | 'env_var'
  | 'relative'
  | 'parent_segment'
  | 'invalid_chars'
  | 'trailing_dot_space'
  | 'reserved_name';

export type WindowsPathCheck =
  | { ok: true; normalized: string }
  | { ok: false; issue: WindowsPathIssue; message_he: string };

const ISSUE_MESSAGES: Record<WindowsPathIssue, string> = {
  empty: 'לא הוזן נתיב.',
  too_long: 'הנתיב ארוך מדי.',
  nul_byte: 'הנתיב מכיל תו לא חוקי.',
  device_path: 'נתיבי התקן מיוחדים (כמו \\\\.\\ או \\\\?\\) אינם מותרים. בחר קובץ רגיל בכונן.',
  env_var: 'נתיב עם משתני סביבה (כמו %ProgramFiles%) אינו נתמך. בחר את הקובץ עם כפתור "עיון" כדי לקבל נתיב מלא.',
  relative:
    'הנתיב חייב להיות מלא, כולל אות כונן — למשל C:\\Program Files\\... — או נתיב רשת שמתחיל ב-\\\\שרת\\תיקייה.',
  parent_segment: 'הנתיב לא יכול להכיל ".." (מעבר לתיקייה עליונה). בחר את הקובץ ישירות.',
  invalid_chars: 'הנתיב מכיל תווים שאינם חוקיים בשמות קבצים ב-Windows.',
  trailing_dot_space: 'שם בנתיב מסתיים בנקודה או ברווח — Windows מתעלם מהם, ולכן הנתיב לא חד-משמעי.',
  reserved_name: 'הנתיב מכיל שם שמור של Windows (כמו CON, NUL או COM1).',
};

/** תווים אסורים בשמות קבצים ב-Windows (כולל תווי בקרה). נקודתיים נבדקות בנפרד. */
// eslint-disable-next-line no-control-regex -- בכוונה: תווי בקרה אסורים בנתיב
const INVALID_NAME_CHARS = /[<>"|?*\u0000-\u001f]/;
/** שמות התקן שמורים — Windows מתייחס אליהם כהתקן גם עם סיומת (NUL.txt). */
const RESERVED_NAME = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)(\.[^.]*)?$/i;
const DRIVE_ABSOLUTE = /^[a-zA-Z]:[\\/]/;
const UNC_PREFIX = /^[\\/]{2}([^\\/]+)[\\/]([^\\/]+)/;
const ENV_VAR = /%[^%\\/]+%/;

/** נתיב התקן: ‎\\.\‎ או ‎\\?\‎ (גם בלוכסנים רגילים). */
export function isDevicePath(p: string): boolean {
  return /^[\\/]{2}[.?](?:[\\/]|$)/.test(p);
}

/**
 * מסיר רווחים ומרכאות עוטפות. "העתק כנתיב" בסייר הקבצים מעתיק עם מרכאות,
 * והמשתמש מדביק את זה כמו שזה בהגדרות.
 */
export function unquoteWindowsPath(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

/** נתיב מלא ב-Windows: אות כונן עם מפריד (C:\...) או UNC (\\server\share\...). לא נתיב התקן. */
export function isAbsoluteWindowsPath(p: string): boolean {
  if (typeof p !== 'string' || p.length === 0 || p.includes('\0')) return false;
  if (isDevicePath(p)) return false;
  if (DRIVE_ABSOLUTE.test(p)) return true;
  return UNC_PREFIX.test(p);
}

function fail(issue: WindowsPathIssue): WindowsPathCheck {
  return { ok: false, issue, message_he: ISSUE_MESSAGES[issue] };
}

/** מסיר מפריד בסוף הנתיב, חוץ משורש כונן (C:\) או שורש שיתוף רשת (\\server\share\). */
function stripTrailingSeparator(p: string): string {
  if (/^[a-zA-Z]:\\$/.test(p)) return p;
  const unc = /^\\\\[^\\]+\\[^\\]+\\?$/.test(p);
  if (unc) return p.endsWith('\\') ? p : `${p}\\`;
  return p.replace(/\\+$/, '');
}

/**
 * בדיקה מלאה של נתיב Windows שמגיע מההגדרות.
 * מחזיר את הנתיב המנורמל (מפרידים אחידים, בלי מרכאות) — זה הערך היחיד שמותר להעביר הלאה למערכת ההפעלה.
 */
export function checkWindowsPath(raw: string): WindowsPathCheck {
  if (typeof raw !== 'string') return fail('empty');
  if (raw.includes('\0')) return fail('nul_byte');
  const p = unquoteWindowsPath(raw);
  if (!p) return fail('empty');
  if (p.length > MAX_WINDOWS_PATH_LENGTH) return fail('too_long');
  if (isDevicePath(p)) return fail('device_path');
  if (ENV_VAR.test(p)) return fail('env_var');
  if (!isAbsoluteWindowsPath(p)) return fail('relative');

  // החלק שאחרי השורש: אחרי "C:" בנתיב כונן, או אחרי "\\" בנתיב רשת — בשני המקרים שני תווים.
  const rest = p.slice(2);
  const segments = rest.split(/[\\/]+/).filter((s) => s.length > 0);
  if (segments.some((s) => s === '..')) return fail('parent_segment');
  // נקודתיים אחרי אות הכונן = Alternate Data Stream (file.exe:stream) — לא מאפשרים.
  if (rest.includes(':')) return fail('invalid_chars');
  for (const segment of segments) {
    if (segment === '.') continue;
    if (INVALID_NAME_CHARS.test(segment)) return fail('invalid_chars');
    // Windows מוחק נקודות ורווחים בסוף שם ("cmd.exe." = "cmd.exe") — מקור לבלבול בין קבצים, לכן נדחה.
    if (/[. ]$/.test(segment)) return fail('trailing_dot_space');
    if (RESERVED_NAME.test(segment)) return fail('reserved_name');
  }

  const normalized = stripTrailingSeparator(winPath.normalize(p));
  // בדיקה כפולה אחרי נרמול: עדיין נתיב מלא, לא נתיב התקן, ואין מקטע "..".
  if (!isAbsoluteWindowsPath(normalized) || isDevicePath(normalized)) return fail('relative');
  if (normalized.split(/[\\/]+/).some((s) => s === '..')) return fail('parent_segment');
  return { ok: true, normalized };
}

/** הסיומת באותיות קטנות, כולל הנקודה (".exe"), או מחרוזת ריקה. */
export function windowsExtension(p: string): string {
  return winPath.extname(p).toLowerCase();
}

/** שם הקובץ (החלק האחרון בנתיב) באותיות קטנות — Windows לא מבחין בין אותיות גדולות לקטנות. */
export function windowsBasenameLower(p: string): string {
  return winPath.basename(p).toLowerCase();
}

/**
 * שם קצר בסגנון 8.3 (למשל POWERS~1.EXE). אי אפשר לדעת מהשם לבד לאיזה קובץ הוא מפנה,
 * ולכן קוד שבודק "רשימה חסומה" לפי שם חייב לפתור אותו לשם המלא (realpath) לפני הבדיקה.
 */
export function looksLikeShortName(name: string): boolean {
  return /~\d/.test(name);
}

/** זיהוי סוג לפי סיומת בלבד (בלי דיסק). */
export function kindFromExtension(p: string): 'exe' | 'shortcut' | 'file' {
  const ext = windowsExtension(p);
  if (EXE_EXTENSIONS.includes(ext)) return 'exe';
  if (SHORTCUT_EXTENSIONS.includes(ext)) return 'shortcut';
  return 'file';
}

export type ExtensionCheck = { ok: true; warning_he?: string } | { ok: false; message_he: string };

/**
 * כללי סיומות:
 * exe → ‎.exe; shortcut → ‎.lnk/.url/.appref-ms;
 * eplan → מומלץ ‎.elk/.elp/.els/.ell/.elr/.elx (אחר מותר עם אזהרה, ובתנאי שהקובץ קיים — נבדק אצל הקורא);
 * file → כל מסמך שאינו קובץ הפעלה/סקריפט/קיצור דרך.
 */
export function checkExtension(p: string, expected: 'exe' | 'shortcut' | 'eplan' | 'file'): ExtensionCheck {
  const ext = windowsExtension(p);
  switch (expected) {
    case 'exe':
      if (EXE_EXTENSIONS.includes(ext)) return { ok: true };
      if (SHORTCUT_EXTENSIONS.includes(ext)) {
        return { ok: false, message_he: 'זה קיצור דרך ולא קובץ הפעלה. בחר סוג "קיצור דרך", או את קובץ ה-‎.exe עצמו.' };
      }
      return { ok: false, message_he: 'הקובץ חייב להיות קובץ הפעלה (‎.exe).' };
    case 'shortcut':
      if (SHORTCUT_EXTENSIONS.includes(ext)) return { ok: true };
      return { ok: false, message_he: 'קיצור דרך חייב להיות קובץ ‎.lnk, ‎.url או ‎.appref-ms.' };
    case 'eplan':
      if (EPLAN_PROJECT_EXTENSIONS.includes(ext)) return { ok: true };
      if (EXECUTABLE_EXTENSIONS.includes(ext)) {
        return { ok: false, message_he: 'קובץ פרויקט לא יכול להיות קובץ הפעלה, סקריפט או קיצור דרך.' };
      }
      if (ext === '.edb') {
        return { ok: false, message_he: 'זו תיקיית הנתונים של הפרויקט (‎.edb). בחר את קובץ ה-‎.elk שנמצא לידה.' };
      }
      return {
        ok: true,
        warning_he: `${ext ? `הסיומת ${ext}` : 'קובץ בלי סיומת'} אינה סיומת מוכרת של פרויקט EPLAN (${EPLAN_PROJECT_EXTENSIONS.join(', ')}). הקובץ ייפתח בתוכנה ש-Windows משייך לו.`,
      };
    case 'file':
      if (EXECUTABLE_EXTENSIONS.includes(ext)) {
        return { ok: false, message_he: 'קובץ פרויקט לא יכול להיות קובץ הפעלה, סקריפט או קיצור דרך.' };
      }
      return { ok: true };
  }
}

export function isAllowedUriScheme(scheme: string): scheme is AllowedUriScheme {
  return (ALLOWED_URI_SCHEMES as readonly string[]).includes(scheme);
}

export type UriCheck =
  | { ok: true; uri: `${AllowedUriScheme}:`; scheme: AllowedUriScheme }
  | { ok: false; message_he: string };

/**
 * URI מותר הוא בדיוק "<scheme>:" — בלי נתיב, בלי שאילתה ובלי פרמטרים,
 * כך שלעולם אי אפשר להזריק דרכו פקודה לאפליקציה. מחזיר צורה קנונית (אותיות קטנות).
 */
export function parseAllowedUri(value: string): UriCheck {
  const allowedList = ALLOWED_URI_SCHEMES.map((s) => `${s}:`).join(', ');
  if (typeof value !== 'string' || value.includes('\0')) {
    return { ok: false, message_he: 'הכתובת אינה תקינה.' };
  }
  const match = value.trim().match(/^([A-Za-z][A-Za-z0-9+.-]*):$/);
  const rawScheme = match?.[1];
  if (!rawScheme) {
    return {
      ok: false,
      message_he: `מותר רק שם של סכמה ונקודתיים, בלי נתיב ובלי פרמטרים — למשל spotify:. סכמות מותרות: ${allowedList}`,
    };
  }
  const scheme = rawScheme.toLowerCase();
  if (!isAllowedUriScheme(scheme)) {
    return { ok: false, message_he: `הסכמה "${scheme}:" אינה ברשימת הסכמות המותרות (${allowedList}).` };
  }
  return { ok: true, uri: `${scheme}:`, scheme };
}

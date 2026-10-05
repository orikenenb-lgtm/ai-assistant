/**
 * עזרי לוגיקה טהורים למסך ההגדרות: מזהים, כינויים, קולות ורשימות בחירה.
 * main מאמת כל שינוי מול הסכמה — כאן רק מונעים שליחה של ערך שברור שייפסל.
 */
import type { AppEntry, ProjectEntry, SecretStatusEntry } from '../../shared/settings-schema';
import { he } from '../i18n/he';

/** אותה תבנית כמו ב-SettingsSchema (ID_RE). */
export const ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
export const MODEL_ID_RE = /^claude-[a-z0-9-]{1,60}$/;
export const AZURE_REGION_RE = /^[a-z0-9]{2,40}$/;
export const MIN_SECRET_LENGTH = 8;

export const CLAUDE_MODELS: ReadonlyArray<{ id: string; isDefault: boolean }> = [
  { id: 'claude-opus-5-5', isDefault: true },
  { id: 'claude-sonnet-5-5', isDefault: false },
  { id: 'claude-haiku-4-5', isDefault: false },
];

export const STT_OPENAI_MODELS: ReadonlyArray<{ id: string; note: string }> = [
  { id: 'gpt-transcribe', note: he.settings.voice.sttModelDefault },
  { id: 'gpt-4o-transcribe', note: he.settings.voice.sttModelLegacy },
];

export const AZURE_HE_VOICES = ['he-IL-AvriNeural', 'he-IL-HilaNeural'] as const;

export const OPENAI_TTS_VOICES = [
  'alloy',
  'ash',
  'ballad',
  'cedar',
  'coral',
  'echo',
  'fable',
  'marin',
  'nova',
  'onyx',
  'sage',
  'shimmer',
  'verse',
] as const;

export function isKnownModel(id: string): boolean {
  return CLAUDE_MODELS.some((m) => m.id === id);
}

/** מזהה ייחודי לתוכנה/פרויקט חדשים: אותיות לטיניות מהשם, או prefix-מספר לשם עברי. */
export function makeUniqueId(name: string, existing: readonly string[], prefix: string): string {
  const taken = new Set(existing);
  let base = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 32);
  if (!base || !ID_RE.test(base)) base = prefix;
  if (base !== prefix && !taken.has(base)) return base;
  for (let i = base === prefix ? 1 : 2; i < 1000; i++) {
    const candidate = `${base}-${i}`.slice(0, 40);
    if (!taken.has(candidate) && ID_RE.test(candidate)) return candidate;
  }
  // לא אמור לקרות (מגבלה של 50 פריטים), אבל לא מחזירים מזהה כפול לעולם
  return `${prefix}-${Date.now().toString(36)}`.slice(0, 40);
}

/** הוספת כינוי: מנקה רווחים, חוסם כפילויות (ללא תלות באותיות גדולות/קטנות) ושומר על המגבלות. */
export function addAlias(aliases: readonly string[], raw: string, maxLen: number): string[] {
  const value = raw.replace(/\s+/g, ' ').trim().slice(0, maxLen);
  if (!value) return [...aliases];
  if (aliases.some((a) => a.toLocaleLowerCase('he') === value.toLocaleLowerCase('he'))) return [...aliases];
  if (aliases.length >= 20) return [...aliases];
  return [...aliases, value];
}

export function removeAlias(aliases: readonly string[], alias: string): string[] {
  return aliases.filter((a) => a !== alias);
}

export function newCustomApp(existing: readonly AppEntry[]): AppEntry {
  return {
    id: makeUniqueId('', existing.map((a) => a.id), 'app'),
    name: he.settings.launcher.newAppName,
    aliases: [],
    kind: 'exe',
    target: '',
    args: [],
    enabled: true,
    builtin: false,
  };
}

export function newProject(existing: readonly ProjectEntry[]): ProjectEntry {
  return {
    id: makeUniqueId('', existing.map((p) => p.id), 'project'),
    name: he.settings.launcher.newProjectName,
    aliases: [],
    path: '',
    kind: 'eplan',
    enabled: true,
  };
}

export function pickPurposeForProject(kind: ProjectEntry['kind']): 'project-file' | 'project-folder' {
  return kind === 'folder' ? 'project-folder' : 'project-file';
}

/** קולות עבריים: he / iw (קוד ישן), או שם שמכיל Hebrew. */
export function isHebrewVoice(voice: { lang: string; name: string }): boolean {
  const lang = voice.lang.toLowerCase();
  return lang.startsWith('he') || lang.startsWith('iw') || /hebrew|עברית/i.test(voice.name);
}

export function partitionVoices<T extends { lang: string; name: string }>(voices: readonly T[]): { hebrew: T[]; other: T[] } {
  const hebrew: T[] = [];
  const other: T[] = [];
  for (const v of voices) (isHebrewVoice(v) ? hebrew : other).push(v);
  const byName = (a: T, b: T) => a.name.localeCompare(b.name);
  return { hebrew: hebrew.sort(byName), other: other.sort(byName) };
}

/** טקסט מצב מפתח — אמת בלבד: "מוצפן" רק כשהוא באמת נשמר באחסון המאובטח. */
export function secretStatusText(entry: SecretStatusEntry | undefined): string {
  if (!entry || !entry.configured) return he.settings.secrets.notConfigured;
  switch (entry.source) {
    case 'secure-store':
      return he.settings.secrets.configuredSecure;
    case 'env':
      return he.settings.secrets.configuredEnv;
    case 'session':
      return he.settings.secrets.configuredSession;
    case 'none':
      return he.settings.secrets.notConfigured;
  }
}

/** מספר מתוך שדה טקסט, רק אם הוא שלם ובטווח. אחרת null. */
export function parseIntInRange(raw: string, min: number, max: number): number | null {
  if (!/^\s*-?\d+\s*$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < min || n > max) return null;
  return n;
}

export function rangeError(min: number, max: number): string {
  return `ערך לא תקין — מספר שלם בין ${min} ל-${max}.`;
}

/** סוג התוכנה לפי סיומת הקובץ שנבחר (Windows: ‎.exe / ‎.lnk / ‎.url). null אם לא ברור. */
export function appKindFromPath(path: string): AppEntry['kind'] | null {
  const lower = path.trim().toLowerCase();
  if (lower.endsWith('.exe')) return 'exe';
  if (lower.endsWith('.lnk') || lower.endsWith('.url')) return 'shortcut';
  return null;
}

/** האם מועמד מזיהוי אוטומטי מתאים לתוכנה קיימת (לפי מזהה או שם). */
export function findMatchingApp(apps: readonly AppEntry[], candidate: { name: string; suggestedId: string }): AppEntry | undefined {
  const name = candidate.name.trim().toLocaleLowerCase('he');
  return apps.find((a) => a.id === candidate.suggestedId || a.name.trim().toLocaleLowerCase('he') === name);
}

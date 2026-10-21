/**
 * פתרון שם/מזהה שהמודל (או המשתמש) נתן — אך ורק מול הרשימות המאושרות בהגדרות.
 * פונקציות טהורות: אין כאן גישה לדיסק או למערכת ההפעלה. מה שהמודל כתב משמש רק להשוואה,
 * ולעולם לא כערך שנשלח הלאה — מה שחוזר הוא תמיד רשומה מתוך ההגדרות.
 */
import type { AppEntry, ProjectEntry, Settings } from '../../shared/settings-schema';
import { matchScore } from '../../shared/text-normalize';

/** ציון מינימלי שנחשב "התאמה סבירה". */
export const MATCH_THRESHOLD = 0.75;
/** ציונים שההפרש ביניהם קטן מזה נחשבים תיקו. */
const TIE_EPSILON = 1e-6;

export type Resolution<T> =
  | { kind: 'found'; entry: T; via: 'id' | 'exact' | 'match' | 'default'; score: number }
  | { kind: 'ambiguous'; candidates: T[] }
  | { kind: 'disabled'; entry: T }
  /** לא נשאלה שאילתה ואין פרויקט ברירת מחדל תקף. candidates = הפרויקטים הפעילים. */
  | { kind: 'no-default'; candidates: T[] }
  | { kind: 'none' };

interface Named {
  id: string;
  name: string;
  aliases: string[];
  enabled: boolean;
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** הציון הטוב ביותר של השאילתה מול השם, המזהה וכל הכינויים. */
export function entryScore(query: string, entry: Named): number {
  let best = 0;
  for (const candidate of [entry.name, entry.id, ...entry.aliases]) {
    const s = matchScore(query, candidate);
    if (s > best) best = s;
    if (best === 1) break;
  }
  return best;
}

function scoreAll<T extends Named>(query: string, entries: T[]): Array<{ entry: T; score: number }> {
  return entries
    .map((entry) => ({ entry, score: entryScore(query, entry) }))
    .filter((s) => s.score >= MATCH_THRESHOLD)
    .sort((a, b) => b.score - a.score);
}

function byExactId<T extends Named>(id: string, entries: T[]): Resolution<T> | null {
  if (!id) return null;
  const lower = id.toLowerCase();
  const hit = entries.find((e) => e.id === lower);
  if (!hit) return null;
  return hit.enabled ? { kind: 'found', entry: hit, via: 'id', score: 1 } : { kind: 'disabled', entry: hit };
}

/** אם אין התאמה בין הפעילים — האם השאילתה מתאימה לרשומה מושבתת (להודעה ברורה יותר). */
function disabledMatch<T extends Named>(query: string, entries: T[]): Resolution<T> | null {
  const hit = entries.filter((e) => !e.enabled).find((e) => entryScore(query, e) >= MATCH_THRESHOLD);
  return hit ? { kind: 'disabled', entry: hit } : null;
}

/**
 * תוכנה: מזהה מדויק, אחרת ההתאמה הטובה ביותר (>= 0.75) לפי שם וכינויים.
 * תיקו בין המובילים → ambiguous (המודל ישאל את המשתמש).
 */
export function resolveApp(query: { app_id?: string; app_name?: string }, apps: AppEntry[]): Resolution<AppEntry> {
  const id = clean(query.app_id);
  const name = clean(query.app_name);
  const exact = byExactId(id, apps);
  if (exact) return exact;

  const enabled = apps.filter((a) => a.enabled);
  // קודם השם; אם לא נמצא — ננסה גם את app_id כשם (המודל לפעמים שם שם במקום מזהה)
  for (const text of [name, id]) {
    if (!text) continue;
    const scored = scoreAll(text, enabled);
    const top = scored[0];
    if (!top) continue;
    const tied = scored.filter((s) => top.score - s.score < TIE_EPSILON);
    if (tied.length > 1) return { kind: 'ambiguous', candidates: tied.map((s) => s.entry) };
    return { kind: 'found', entry: top.entry, via: top.score === 1 ? 'exact' : 'match', score: top.score };
  }
  for (const text of [name, id]) {
    if (!text) continue;
    const disabled = disabledMatch(text, apps);
    if (disabled) return disabled;
  }
  return { kind: 'none' };
}

/**
 * פרויקט: בלי שאילתה → פרויקט ברירת המחדל. מזהה מדויק → הוא.
 * אחרת: התאמה מדויקת (אחרי נרמול) יחידה → היא; התאמה סבירה יחידה → היא;
 * כמה התאמות סבירות בלי התאמה מדויקת יחידה → ambiguous. לעולם לא מנחשים.
 */
export function resolveProject(
  query: { project_id?: string; project_name?: string },
  launcher: Pick<Settings['launcher'], 'projects' | 'defaultProjectId'>,
): Resolution<ProjectEntry> {
  const projects = launcher.projects;
  const id = clean(query.project_id);
  const name = clean(query.project_name);
  const enabled = projects.filter((p) => p.enabled);

  if (!id && !name) {
    const def = launcher.defaultProjectId ? projects.find((p) => p.id === launcher.defaultProjectId) : undefined;
    if (def) return def.enabled ? { kind: 'found', entry: def, via: 'default', score: 1 } : { kind: 'disabled', entry: def };
    return { kind: 'no-default', candidates: enabled };
  }

  const exact = byExactId(id, projects);
  if (exact) return exact;

  for (const text of [name, id]) {
    if (!text) continue;
    const scored = scoreAll(text, enabled);
    if (scored.length === 0) continue;
    const exacts = scored.filter((s) => s.score === 1);
    if (exacts.length === 1 && exacts[0]) return { kind: 'found', entry: exacts[0].entry, via: 'exact', score: 1 };
    if (exacts.length > 1) return { kind: 'ambiguous', candidates: exacts.map((s) => s.entry) };
    if (scored.length === 1 && scored[0]) {
      return { kind: 'found', entry: scored[0].entry, via: 'match', score: scored[0].score };
    }
    return { kind: 'ambiguous', candidates: scored.map((s) => s.entry) };
  }
  for (const text of [name, id]) {
    if (!text) continue;
    const disabled = disabledMatch(text, projects);
    if (disabled) return disabled;
  }
  return { kind: 'none' };
}

/**
 * טקסט שהגיע מהמודל ומוצג חזרה (בכותרת HUD או בהודעה): בלי תווי בקרה ותווי כיווניות, ומקוצר.
 * משמש לתצוגה בלבד — לעולם לא נשלח למערכת ההפעלה.
 */
export function displaySafe(value: unknown, max = 40): string {
  const text = clean(value)
    // eslint-disable-next-line no-control-regex -- בכוונה: מסירים תווי בקרה ותווי כיווניות
    .replace(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

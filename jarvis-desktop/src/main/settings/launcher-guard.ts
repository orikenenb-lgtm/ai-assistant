import type { AppEntry, Settings, SettingsPatch } from '../../shared/settings-schema';

/**
 * שומר על רשימת התוכנות המאושרות מפני renderer פגוע.
 * הנחת המוצא: ה-renderer הוא קוד שלנו, אבל אם יופיע בו XSS — הוא לא אמור להצליח להגדיר
 * "תוכנה מאושרת" שמריצה פקודה ואז להפעיל אותה. לכן כל שינוי של נתיב או ארגומנטים של
 * תוכנה (exe / קיצור דרך) דורש אישור בדיאלוג נייטיבי של Windows — דיאלוג שה-renderer לא יכול ללחוץ עליו.
 * חריג: נתיב שהמשתמש בחר בעצמו בבורר הקבצים של המערכת (או שזוהה ע"י main) בסשן הנוכחי, בלי ארגומנטים.
 */

export interface LauncherChange {
  id: string;
  name: string;
  kind: AppEntry['kind'];
  target: string;
  args: string[];
  reason: 'new-target' | 'args';
}

export function pathKey(p: string): string {
  return p.trim().replace(/^"|"$/g, '').replace(/\//g, '\\').toLowerCase();
}

function sameArgs(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** השינויים בתוכנות שדורשים אישור נייטיבי לפני שמירה. */
export function launcherChangesRequiringConfirmation(
  current: Settings,
  patch: SettingsPatch,
  trustedPaths: ReadonlySet<string>,
): LauncherChange[] {
  const nextApps = patch.launcher?.apps;
  if (!Array.isArray(nextApps)) return [];
  const byId = new Map(current.launcher.apps.map((a) => [a.id, a]));
  const changes: LauncherChange[] = [];
  for (const raw of nextApps as unknown[]) {
    if (!raw || typeof raw !== 'object') continue;
    const app = raw as Partial<AppEntry>;
    const kind = app.kind;
    if (kind !== 'exe' && kind !== 'shortcut') continue; // URI מוגבל לרשימת סכמות קבועה בלי פרמטרים
    const target = typeof app.target === 'string' ? app.target : '';
    const args = Array.isArray(app.args) ? app.args.filter((x): x is string => typeof x === 'string') : [];
    if (!target.trim()) continue;
    const prev = byId.get(String(app.id ?? ''));
    const targetChanged = !prev || prev.kind !== kind || pathKey(prev.target) !== pathKey(target);
    const argsChanged = !prev || !sameArgs(prev.args, args);
    const base = { id: String(app.id ?? ''), name: String(app.name ?? app.id ?? ''), kind, target, args };
    if (args.length > 0 && argsChanged) changes.push({ ...base, reason: 'args' });
    else if (targetChanged && !trustedPaths.has(pathKey(target))) changes.push({ ...base, reason: 'new-target' });
  }
  return changes;
}

/** טקסט לדיאלוג האישור הנייטיבי. */
export function describeChangesForDialog(changes: LauncherChange[]): string {
  return changes
    .map((c) => {
      const argText = c.args.length ? `\nארגומנטים: ${c.args.join(' ')}` : '';
      return `• ${c.name}\n${c.target}${argText}`;
    })
    .join('\n\n');
}

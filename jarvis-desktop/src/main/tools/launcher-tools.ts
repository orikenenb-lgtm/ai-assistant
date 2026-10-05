/**
 * כלי המודל לפתיחת תוכנות ופרויקטים: open_application ו-open_project.
 * הכלים רק מעבירים מזהה/שם לשירות הפתיחה. השירות פותר אותם מול הרשימה המאושרת בהגדרות,
 * ולמערכת ההפעלה מגיעים רק ערכים מההגדרות — לעולם לא מחרוזת שהמודל כתב.
 */
import { z } from 'zod';
import type { Settings } from '../../shared/settings-schema';
import type { ToolResult } from '../../shared/types';
import type { LauncherService, ToolContext, ToolDefinition } from '../core/contracts';
import { displaySafe, resolveApp, resolveProject } from '../launcher/resolve';

export const OpenApplicationInputSchema = z
  .object({
    app_id: z
      .string()
      .max(40)
      .optional()
      .describe('Id of an approved app from the user\'s allowlist, e.g. "eplan", "spotify", "notepad", "calculator".'),
    app_name: z
      .string()
      .max(80)
      .optional()
      .describe('The app name exactly as the user said it (Hebrew or English), e.g. "אי פלאן", "ספוטיפיי", "מחשבון".'),
  })
  .strict();
export type OpenApplicationInput = z.infer<typeof OpenApplicationInputSchema>;

export const OpenProjectInputSchema = z
  .object({
    project_id: z.string().max(40).optional().describe('Id of a configured project, e.g. "final-project".'),
    project_name: z
      .string()
      .max(80)
      .optional()
      .describe('The project name as the user said it, e.g. "פרויקט הגמר". Omit both fields to open the default project.'),
  })
  .strict();
export type OpenProjectInput = z.infer<typeof OpenProjectInputSchema>;

const OPEN_APPLICATION_DESCRIPTION = [
  "Open one of the user's PRE-APPROVED desktop applications on this Windows PC.",
  "Only apps from the user's allowlist (configured in JARVIS settings) can be opened. You cannot pass file paths, URLs, command-line arguments or shell commands — any such text is ignored and nothing outside the allowlist is ever launched.",
  'Identify the app with app_id (preferred when you know it, e.g. "eplan", "spotify", "notepad", "calculator") and/or app_name as the user said it.',
  'Examples: "תפתח את EPLAN" / "פתח אי פלאן" → {"app_id":"eplan"}; "תדליק ספוטיפיי" → {"app_id":"spotify"}; "תפתח לי את המחשבון" → {"app_name":"מחשבון"}.',
  'If the result status is needs_clarification, ask the user to choose one of the returned options. If ok is false, tell the user what the result says (in Hebrew) — never claim the app opened unless ok is true.',
].join(' ');

const OPEN_PROJECT_DESCRIPTION = [
  "Open one of the user's configured projects — usually an EPLAN Electric P8 project file (.elk) — with the program Windows associates with it.",
  'JARVIS never edits or writes to the project; it only asks Windows to open the file. Only projects configured in JARVIS settings can be opened; you cannot pass paths.',
  'Use project_id when known, or project_name as the user said it. When the user just says "open my project" without naming one, call with no arguments to open the default project.',
  'Examples: "תפתח את פרויקט הגמר" → {"project_id":"final-project"}; "תפתח את הפרויקט שלי" → {}; "פתח את הפרויקט של המכונה" → {"project_name":"הפרויקט של המכונה"}.',
  'If the result status is needs_clarification, ask the user which of the options they meant — never guess. Never claim the project opened unless ok is true.',
].join(' ');

function cancelledResult(): ToolResult {
  return { ok: false, status: 'cancelled', error_code: 'CANCELLED', summary_he: 'הפעולה בוטלה לפני שהתחילה, ולכן שום דבר לא נפתח.' };
}

function invalidParams(summary_he: string): ToolResult {
  return { ok: false, status: 'error', error_code: 'INVALID_PARAMS', summary_he };
}

function trimmed(value: string | undefined): string | undefined {
  const t = value?.trim();
  return t ? t : undefined;
}

// _getSettings נשאר בחתימה לתאימות; הביצוע משתמש ב-ctx.settings (תמונת ההגדרות שהוצגה באישור)
export function createLauncherTools(launcher: LauncherService, _getSettings: () => Settings): ToolDefinition[] {
  const openApplication: ToolDefinition<OpenApplicationInput> = {
    name: 'open_application',
    description: OPEN_APPLICATION_DESCRIPTION,
    inputSchema: OpenApplicationInputSchema,
    risk: 'low',
    sideEffect: true,
    dedupeWindowMs: 15_000,
    title(input, settings) {
      const res = resolveApp(input, settings.launcher.apps);
      const name =
        res.kind === 'found' || res.kind === 'disabled'
          ? res.entry.name
          : displaySafe(input.app_name || input.app_id) || 'תוכנה לא מזוהה';
      return `פתיחת תוכנה: ${name}`;
    },
    describeForApproval(input, settings) {
      const res = resolveApp(input, settings.launcher.apps);
      if (res.kind === 'found') {
        const entry = res.entry;
        return {
          action_he: `פתיחת התוכנה ${entry.name}`,
          target_he: entry.target.trim() || 'הנתיב עדיין לא הוגדר',
          impact_he:
            entry.kind === 'uri'
              ? 'Windows יפתח את האפליקציה הרשומה לכתובת הזו, בלי פרמטרים נוספים. שום קובץ לא משתנה.'
              : 'התוכנה תיפתח במחשב, רק עם הארגומנטים שהגדרת בעצמך (אם יש). שום קובץ לא נמחק או משתנה.',
        };
      }
      if (res.kind === 'ambiguous') {
        return {
          action_he: 'פתיחת תוכנה',
          target_he: `אחת מ: ${res.candidates.map((c) => c.name).join(' / ')} (תתבקש לבחור)`,
          impact_he: 'שום דבר לא ייפתח עד שתבחר.',
        };
      }
      const asked = displaySafe(input.app_name || input.app_id);
      return {
        action_he: 'פתיחת תוכנה',
        target_he: asked ? `"${asked}" — לא נמצאה ברשימת התוכנות המאושרות` : 'לא צוינה תוכנה',
        impact_he: 'לא תיפתח שום תוכנה שאינה ברשימה המאושרת.',
      };
    },
    async execute(input, ctx: ToolContext): Promise<ToolResult> {
      if (ctx.signal.aborted) return cancelledResult();
      const parsed = OpenApplicationInputSchema.safeParse(input);
      if (!parsed.success) return invalidParams('הפרמטרים לפתיחת התוכנה לא תקינים, ולכן לא נפתח דבר.');
      const app_id = trimmed(parsed.data.app_id);
      const app_name = trimmed(parsed.data.app_name);
      if (!app_id && !app_name) {
        return invalidParams('לא צוין איזו תוכנה לפתוח (app_id או app_name), ולכן לא נפתח דבר.');
      }
      // אותה תמונת הגדרות שהוצגה באישור (ctx.settings) — כך מה שאושר הוא מה שרץ
      return launcher.openApplication(
        { ...(app_id ? { app_id } : {}), ...(app_name ? { app_name } : {}) },
        ctx.settings,
      );
    },
  };

  const openProject: ToolDefinition<OpenProjectInput> = {
    name: 'open_project',
    description: OPEN_PROJECT_DESCRIPTION,
    inputSchema: OpenProjectInputSchema,
    risk: 'low',
    sideEffect: true,
    dedupeWindowMs: 15_000,
    title(input, settings) {
      const res = resolveProject(input, settings.launcher);
      const name =
        res.kind === 'found' || res.kind === 'disabled'
          ? res.entry.name
          : displaySafe(input.project_name || input.project_id) || 'פרויקט ברירת המחדל';
      return `פתיחת פרויקט: ${name}`;
    },
    describeForApproval(input, settings) {
      const res = resolveProject(input, settings.launcher);
      if (res.kind === 'found') {
        const entry = res.entry;
        return {
          action_he: `פתיחת הפרויקט ${entry.name}`,
          target_he: entry.path.trim() || 'הנתיב עדיין לא הוגדר',
          impact_he:
            entry.kind === 'folder'
              ? 'התיקייה תיפתח בסייר הקבצים. JARVIS לא משנה בה דבר.'
              : 'הקובץ ייפתח בתוכנה ש-Windows משייך לו (למשל EPLAN). JARVIS לא כותב לקובץ ולא משנה אותו.',
        };
      }
      if (res.kind === 'ambiguous' || res.kind === 'no-default') {
        return {
          action_he: 'פתיחת פרויקט',
          target_he: res.candidates.length
            ? `אחד מ: ${res.candidates.map((c) => c.name).join(' / ')} (תתבקש לבחור)`
            : 'לא הוגדרו פרויקטים',
          impact_he: 'שום דבר לא ייפתח עד שתבחר.',
        };
      }
      const asked = displaySafe(input.project_name || input.project_id);
      return {
        action_he: 'פתיחת פרויקט',
        target_he: asked ? `"${asked}" — לא נמצא ברשימת הפרויקטים` : 'פרויקט לא מזוהה',
        impact_he: 'לא ייפתח שום קובץ שאינו ברשימת הפרויקטים.',
      };
    },
    async execute(input, ctx: ToolContext): Promise<ToolResult> {
      if (ctx.signal.aborted) return cancelledResult();
      const parsed = OpenProjectInputSchema.safeParse(input);
      if (!parsed.success) return invalidParams('הפרמטרים לפתיחת הפרויקט לא תקינים, ולכן לא נפתח דבר.');
      const project_id = trimmed(parsed.data.project_id);
      const project_name = trimmed(parsed.data.project_name);
      // בלי מזהה ובלי שם → פרויקט ברירת המחדל (השירות מטפל בזה)
      return launcher.openProject(
        { ...(project_id ? { project_id } : {}), ...(project_name ? { project_name } : {}) },
        ctx.settings,
      );
    },
  };

  return [openApplication, openProject];
}

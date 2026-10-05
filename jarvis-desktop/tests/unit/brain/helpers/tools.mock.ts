import { vi, type Mock } from 'vitest';
import { z } from 'zod';
import type { ToolContext, ToolDefinition, ToolRisk } from '../../../../src/main/core/contracts';
import type { ToolName, ToolResult } from '../../../../src/shared/types';

/**
 * MOCK: הגדרות כלים עם סכמות zod קשיחות (כמו האמיתיות) ו-execute שהוא spy.
 * הכלים לא נוגעים במערכת ההפעלה — רק מחזירים ToolResult מתוסרט.
 */

export type MockExecute = Mock<(input: unknown, ctx: ToolContext) => Promise<ToolResult>>;

interface Spec {
  name: ToolName;
  schema: z.ZodType;
  risk: ToolRisk;
  sideEffect: boolean;
  dedupeWindowMs: number;
  title: (input: Record<string, unknown>) => string;
  result: (input: Record<string, unknown>) => ToolResult;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

const APP_NAMES: Record<string, string> = { eplan: 'EPLAN', spotify: 'Spotify', notepad: 'פנקס רשימות', calculator: 'מחשבון' };

const SPECS: Spec[] = [
  {
    name: 'open_application',
    schema: z.object({ app_id: z.string().max(40).optional(), app_name: z.string().max(80).optional() }).strict(),
    risk: 'low',
    sideEffect: true,
    dedupeWindowMs: 15_000,
    title: (i) => `פתיחת תוכנה: ${APP_NAMES[String(i.app_id)] ?? String(i.app_id ?? i.app_name)}`,
    result: (i) => ({ ok: true, status: 'success', summary_he: `פתחתי את ${APP_NAMES[String(i.app_id)] ?? String(i.app_id)}.`, data: { app_id: i.app_id } }),
  },
  {
    name: 'open_project',
    schema: z.object({ project_id: z.string().max(40).optional(), project_name: z.string().max(80).optional() }).strict(),
    risk: 'low',
    sideEffect: true,
    dedupeWindowMs: 15_000,
    title: () => 'פתיחת פרויקט: פרויקט הגמר',
    result: () => ({ ok: true, status: 'success', summary_he: 'פתחתי את פרויקט הגמר (final.elk) בתוכנה המשויכת.', data: { project_id: 'final-project' } }),
  },
  {
    name: 'get_system_status',
    schema: z.object({}).strict(),
    risk: 'read',
    sideEffect: false,
    dedupeWindowMs: 0,
    title: () => 'מצב מערכת',
    result: () => ({ ok: true, status: 'success', summary_he: 'מעבד 23%, זיכרון 41% בשימוש.', data: { cpu: 23 } }),
  },
  {
    name: 'create_task',
    schema: z
      .object({ title: z.string().min(1).max(200), due_date: z.string().regex(DATE).nullable().optional(), notes: z.string().max(1000).nullable().optional() })
      .strict(),
    risk: 'low',
    sideEffect: true,
    dedupeWindowMs: 120_000,
    title: (i) => `משימה חדשה: ${String(i.title)}`,
    result: (i) => ({ ok: true, status: 'success', summary_he: `הוספתי משימה: ${String(i.title)}.` }),
  },
  {
    name: 'list_tasks',
    schema: z.object({ filter: z.enum(['today', 'open', 'all']) }).strict(),
    risk: 'read',
    sideEffect: false,
    dedupeWindowMs: 0,
    title: () => 'רשימת משימות',
    result: () => ({ ok: true, status: 'success', summary_he: 'אין לך משימות פתוחות להיום.', data: [] }),
  },
  {
    name: 'complete_task',
    schema: z.object({ task_id: z.string().max(64).optional(), title_query: z.string().max(200).optional() }).strict(),
    risk: 'low',
    sideEffect: true,
    dedupeWindowMs: 0,
    title: () => 'סימון משימה כבוצעה',
    result: () => ({ ok: true, status: 'success', summary_he: 'סימנתי את המשימה כבוצעה.' }),
  },
  {
    name: 'create_reminder',
    schema: z.object({ text: z.string().min(1).max(300), date: z.string().regex(DATE), time: z.string().regex(TIME) }).strict(),
    risk: 'low',
    sideEffect: true,
    dedupeWindowMs: 120_000,
    title: (i) => `תזכורת: ${String(i.text)}`,
    result: (i) => ({ ok: true, status: 'success', summary_he: `קבעתי תזכורת: ${String(i.text)} — ${String(i.date)} בשעה ${String(i.time)}.` }),
  },
  {
    name: 'list_reminders',
    schema: z.object({ filter: z.enum(['upcoming', 'missed', 'all']) }).strict(),
    risk: 'read',
    sideEffect: false,
    dedupeWindowMs: 0,
    title: () => 'רשימת תזכורות',
    result: () => ({ ok: true, status: 'success', summary_he: 'אין לך תזכורות קרובות.', data: [] }),
  },
  {
    name: 'cancel_reminder',
    schema: z.object({ reminder_id: z.string().max(64).optional(), text_query: z.string().max(200).optional() }).strict(),
    risk: 'low',
    sideEffect: true,
    dedupeWindowMs: 0,
    title: () => 'ביטול תזכורת',
    result: () => ({ ok: true, status: 'success', summary_he: 'ביטלתי את התזכורת.' }),
  },
  {
    name: 'capture_screen_for_analysis',
    schema: z.object({ question: z.string().min(1).max(500) }).strict(),
    risk: 'privacy',
    sideEffect: false,
    dedupeWindowMs: 0,
    title: () => 'צילום מסך וניתוח',
    result: () => ({
      ok: true,
      status: 'success',
      untrusted: true,
      summary_he: 'מה רואים בוודאות: חלון EPLAN פתוח עם שרטוט.',
      data: { display: 'מסך 1 (ראשי)' },
    }),
  },
];

export interface MockTools {
  defs: ToolDefinition<unknown>[];
  execs: Record<ToolName, MockExecute>;
}

/** יוצר את כל עשרת הכלים. אפשר להחליף מימוש execute לכלי מסוים. */
export function createMockTools(
  overrides: Partial<Record<ToolName, (input: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>>> = {},
): MockTools {
  const execs = {} as Record<ToolName, MockExecute>;
  const defs = SPECS.map((spec): ToolDefinition<unknown> => {
    const exec: MockExecute = vi.fn(async (input: unknown, ctx: ToolContext) => {
      const custom = overrides[spec.name];
      if (custom) return custom(input as Record<string, unknown>, ctx);
      return spec.result(input as Record<string, unknown>);
    });
    execs[spec.name] = exec;
    return {
      name: spec.name,
      description: `MOCK ${spec.name} tool. Example: "תפתח את EPLAN".`,
      inputSchema: spec.schema as z.ZodType<unknown>,
      risk: spec.risk,
      sideEffect: spec.sideEffect,
      dedupeWindowMs: spec.dedupeWindowMs,
      title: (input) => spec.title(input as Record<string, unknown>),
      describeForApproval: (input) => ({
        action_he: spec.title(input as Record<string, unknown>),
        target_he: 'MOCK',
        impact_he: 'MOCK impact',
      }),
      execute: exec,
    };
  });
  return { defs, execs };
}

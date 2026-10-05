import { z } from 'zod';
import type { Clock, Database, ToolContext, ToolDefinition } from '../core/contracts';
import type { ErrorCode, TaskDTO, ToolResult } from '../../shared/types';
import { normalizeForMatch } from '../../shared/text-normalize';
import { TaskValidationError } from '../db/tasks-repository';
import { pickSingle, rankByText } from '../db/text-search';
import { addDaysLocal, formatHebrewDate, formatHebrewDayMonth, parseLocalDate, todayLocal } from '../time/time';
import { clip, countFeminine, joinHebrew, joinHebrewCapped, stripTrailingPunctuation } from '../time/hebrew-text';

/**
 * כלי משימות: create_task, list_tasks, complete_task.
 * הסיכומים (summary_he) הם עובדות מאומתות מהמסד, מנוסחות להקראה בעברית.
 * כל כתיבה משדרת data-changed כדי שהממשק יתרענן.
 */

/** כמה פריטים מקריאים בקול לפני "ועוד N". */
export const MAX_SPOKEN_ITEMS = 5;
/** כמה פריטים מחזירים למודל ב-data (חיסכון בטוקנים). */
const MAX_DATA_ITEMS = 50;
const MAX_OPTIONS = 5;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/* ------------------------------------------------------------------ */
/* בוני תוצאות — משותפים לכלי המשימות והתזכורות                         */
/* ------------------------------------------------------------------ */

export function okResult(summary_he: string, data?: unknown): ToolResult {
  return { ok: true, status: 'success', summary_he, ...(data === undefined ? {} : { data }) };
}

export function errorResult(code: ErrorCode, summary_he: string): ToolResult {
  return { ok: false, status: 'error', summary_he, error_code: code };
}

export function clarifyResult(
  code: ErrorCode,
  summary_he: string,
  options?: Array<{ id: string; label: string }>,
): ToolResult {
  return {
    ok: false,
    status: 'needs_clarification',
    summary_he,
    error_code: code,
    ...(options && options.length > 0 ? { options } : {}),
  };
}

export function cancelledResult(): ToolResult {
  return { ok: false, status: 'cancelled', summary_he: 'הפעולה בוטלה.', error_code: 'CANCELLED' };
}

/** הודעת כשל כללית כשהמסד זרק שגיאה (נעילה, דיסק מלא, קובץ פגום). */
export function storageErrorResult(what_he: string): ToolResult {
  return errorResult('INTERNAL', `${what_he} נכשלה בגלל תקלה בקובץ הנתונים של JARVIS. נסה שוב בעוד רגע.`);
}

/** ToolDefinition<I> -> ToolDefinition (המערך ברשומה הוא הטרוגני; האימות נעשה מול inputSchema לפני execute). */
export function asTool<I>(def: ToolDefinition<I>): ToolDefinition {
  return def as unknown as ToolDefinition;
}

function quoted(text: string): string {
  return `"${clip(stripTrailingPunctuation(text), 80)}"`;
}

/* ------------------------------------------------------------------ */
/* סכמות קלט                                                           */
/* ------------------------------------------------------------------ */

export const CreateTaskInputSchema = z
  .object({
    title: z.string().min(1).max(200),
    due_date: z.string().regex(DATE_PATTERN).nullable().optional(),
    notes: z.string().max(1000).nullable().optional(),
  })
  .strict();
export type CreateTaskInput = z.infer<typeof CreateTaskInputSchema>;

export const ListTasksInputSchema = z.object({ filter: z.enum(['today', 'open', 'all']) }).strict();
export type ListTasksInput = z.infer<typeof ListTasksInputSchema>;

export const CompleteTaskInputSchema = z
  .object({
    task_id: z.string().min(1).max(64).optional(),
    title_query: z.string().min(1).max(200).optional(),
  })
  .strict();
export type CompleteTaskInput = z.infer<typeof CompleteTaskInputSchema>;

/* ------------------------------------------------------------------ */
/* ניסוח                                                                */
/* ------------------------------------------------------------------ */

/** " — להיום" / " — למחר" / " — ליום שלישי, 6 באוקטובר 2026". */
function dueSuffix(due: string | null, today: string): string {
  if (!due) return '';
  if (due === today) return ' — להיום';
  if (due === addDaysLocal(today, 1)) return ' — למחר';
  const full = formatHebrewDate(due);
  return due < today ? ` — לתאריך ${full} (שכבר עבר)` : ` — ל${full}`;
}

function taskLabel(t: TaskDTO): string {
  const title = clip(stripTrailingPunctuation(t.title), 80);
  return t.dueDate ? `${title} (${formatHebrewDayMonth(t.dueDate)})` : title;
}

function spokenTitles(tasks: readonly TaskDTO[]): string {
  return joinHebrewCapped(
    tasks.map((t) => clip(stripTrailingPunctuation(t.title), 80)),
    MAX_SPOKEN_ITEMS,
  );
}

function taskData(t: TaskDTO): Record<string, unknown> {
  return { id: t.id, title: t.title, due_date: t.dueDate, status: t.status, notes: t.notes };
}

export function summarizeTasks(filter: 'today' | 'open' | 'all', tasks: readonly TaskDTO[], today: string): string {
  const n = tasks.length;
  if (filter === 'today') {
    if (n === 0) return 'אין לך משימות פתוחות להיום.';
    const head = n === 1 ? `יש לך משימה אחת להיום: ${spokenTitles(tasks)}.` : `יש לך ${n} משימות להיום: ${spokenTitles(tasks)}.`;
    const overdue = tasks.filter((t) => t.dueDate !== null && t.dueDate < today).length;
    if (overdue === 0) return head;
    if (n === 1) return `${head} היא באיחור.`;
    return `${head} ${overdue === 1 ? 'אחת מהן באיחור' : `${overdue} מהן באיחור`}.`;
  }
  if (filter === 'open') {
    if (n === 0) return 'אין לך משימות פתוחות.';
    return n === 1
      ? `יש לך משימה פתוחה אחת: ${spokenTitles(tasks)}.`
      : `יש לך ${n} משימות פתוחות: ${spokenTitles(tasks)}.`;
  }
  if (n === 0) return 'אין לך משימות שמורות.';
  const open = tasks.filter((t) => t.status === 'open');
  const done = tasks.filter((t) => t.status === 'done').length;
  const cancelled = tasks.filter((t) => t.status === 'cancelled').length;
  const parts: string[] = [];
  if (open.length > 0) parts.push(open.length === 1 ? 'אחת פתוחה' : `${open.length} פתוחות`);
  if (done > 0) parts.push(done === 1 ? 'אחת שבוצעה' : `${done} שבוצעו`);
  if (cancelled > 0) parts.push(cancelled === 1 ? 'אחת שבוטלה' : `${cancelled} שבוטלו`);
  const head = `ברשימה ${countFeminine(n, 'משימה', 'משימות')}: ${joinHebrew(parts)}.`;
  return open.length > 0 ? `${head} הפתוחות: ${spokenTitles(open)}.` : head;
}

/* ------------------------------------------------------------------ */
/* הכלים                                                                */
/* ------------------------------------------------------------------ */

export interface TaskToolsDeps {
  db: Database;
  clock: Clock;
}

export function createTaskTools(deps: TaskToolsDeps): ToolDefinition[] {
  const { db, clock } = deps;

  const createTask: ToolDefinition<CreateTaskInput> = {
    name: 'create_task',
    description:
      "Add a to-do task to Ori's local task list. Use for requests like 'תוסיף משימה לסיים את השרטוט' or 'תרשום לי לקנות חלב'. " +
      "title: the task in Ori's words, without the word 'משימה' (e.g. 'לסיים את השרטוט'). " +
      "due_date: optional local date YYYY-MM-DD (Asia/Jerusalem) only when Ori names a day ('מחר' = tomorrow's date from <app_context>); otherwise omit. " +
      "notes: optional extra details. For a timed alert ('תזכיר לי ב...') use create_reminder instead.",
    inputSchema: CreateTaskInputSchema,
    risk: 'low',
    sideEffect: true,
    dedupeWindowMs: 120_000,
    title: (input) => `הוספת משימה: ${clip(input.title, 40)}`,
    describeForApproval: (input) => ({
      action_he: 'הוספת משימה חדשה',
      target_he: clip(input.title, 120),
      impact_he: 'המשימה תישמר ברשימת המשימות במחשב.',
    }),
    async execute(input, ctx: ToolContext) {
      if (ctx.signal.aborted) return cancelledResult();
      const title = input.title.trim().replace(/\s+/g, ' ');
      // כותרת בלי אף אות או ספרה ("...", "?") היא לא משימה
      if (!normalizeForMatch(title)) return clarifyResult('INVALID_PARAMS', 'כותרת המשימה ריקה. מה לרשום?');
      const due = input.due_date ?? null;
      if (due !== null && !parseLocalDate(due)) {
        return errorResult('INVALID_PARAMS', `התאריך "${due}" לא תקין. לאיזה תאריך לקבוע את המשימה?`);
      }
      const notes = input.notes?.trim() ? input.notes.trim() : null;
      let task: TaskDTO;
      try {
        task = db.tasks.create({ title, notes, dueDate: due, source: 'tool' });
      } catch (err) {
        if (err instanceof TaskValidationError) return errorResult('INVALID_PARAMS', err.message_he);
        return storageErrorResult('שמירת המשימה');
      }
      ctx.emit({ type: 'data-changed', scope: 'tasks' });
      const today = todayLocal(clock.now());
      return okResult(`הוספתי משימה: ${clip(stripTrailingPunctuation(task.title), 120)}${dueSuffix(task.dueDate, today)}.`, {
        id: task.id,
        title: task.title,
        due_date: task.dueDate,
      });
    },
  };

  const listTasks: ToolDefinition<ListTasksInput> = {
    name: 'list_tasks',
    description:
      "List Ori's tasks. filter 'today' = open tasks due today or overdue, plus open tasks without a date ('מה יש לי לעשות היום?'); " +
      "'open' = all open tasks ('אילו משימות פתוחות יש לי?'); 'all' = everything including completed. " +
      'The result includes task ids for complete_task.',
    inputSchema: ListTasksInputSchema,
    risk: 'read',
    sideEffect: false,
    dedupeWindowMs: 0,
    title: (input) => (input.filter === 'today' ? 'משימות להיום' : input.filter === 'open' ? 'משימות פתוחות' : 'כל המשימות'),
    describeForApproval: () => ({
      action_he: 'הצגת רשימת המשימות',
      target_he: 'רשימת המשימות במחשב',
      impact_he: 'קריאה בלבד — שום דבר לא משתנה.',
    }),
    async execute(input, ctx) {
      if (ctx.signal.aborted) return cancelledResult();
      const today = todayLocal(clock.now());
      let tasks: TaskDTO[];
      try {
        tasks = db.tasks.list(input.filter, today);
      } catch {
        return storageErrorResult('קריאת המשימות');
      }
      return okResult(summarizeTasks(input.filter, tasks, today), {
        filter: input.filter,
        today,
        count: tasks.length,
        tasks: tasks.slice(0, MAX_DATA_ITEMS).map(taskData),
        truncated: tasks.length > MAX_DATA_ITEMS,
      });
    },
  };

  const completeTask: ToolDefinition<CompleteTaskInput> = {
    name: 'complete_task',
    description:
      "Mark exactly one open task as done ('סיימתי את המשימה לסיים את השרטוט', 'סמן את קניית החלב כבוצעה'). " +
      'Pass task_id when known (from list_tasks), otherwise title_query with the words Ori used. ' +
      'If several tasks match, the tool returns needs_clarification with options — ask Ori which one and call again with that task_id. Never guess.',
    inputSchema: CompleteTaskInputSchema,
    risk: 'low',
    sideEffect: true,
    dedupeWindowMs: 0,
    title: (input) => (input.title_query ? `סימון משימה כבוצעה: ${clip(input.title_query, 40)}` : 'סימון משימה כבוצעה'),
    describeForApproval: (input) => ({
      action_he: 'סימון משימה כבוצעה',
      target_he: input.title_query ? clip(input.title_query, 120) : 'המשימה שנבחרה',
      impact_he: 'המשימה תסומן כבוצעה ותצא מרשימת המשימות הפתוחות.',
    }),
    async execute(input, ctx) {
      if (ctx.signal.aborted) return cancelledResult();
      const query = input.title_query?.trim() ?? '';
      const id = input.task_id?.trim() ?? '';
      if (!id && !query) return clarifyResult('INVALID_PARAMS', 'איזו משימה לסמן כבוצעה?');

      let target: TaskDTO | null = null;
      try {
        if (id) target = db.tasks.get(id);
        if (!target && !query) return errorResult('NOT_FOUND', 'לא מצאתי את המשימה הזו. אולי היא כבר נמחקה?');
        if (!target) {
          const ranked = rankByText(query, db.tasks.search(query), (t) => t.title);
          const pick = pickSingle(ranked, MAX_OPTIONS);
          if (pick.kind === 'none') {
            return errorResult('NOT_FOUND', `לא מצאתי משימה פתוחה שמתאימה ל${quoted(query)}.`);
          }
          if (pick.kind === 'many' || pick.kind === 'weak') {
            const options = pick.items.map((t) => ({ id: t.id, label: taskLabel(t) }));
            const names = joinHebrew(pick.items.map((t) => quoted(t.title)));
            const summary =
              pick.kind === 'many'
                ? `מצאתי כמה משימות שמתאימות ל${quoted(query)}: ${names}. איזו מהן לסמן כבוצעה?`
                : `לא מצאתי משימה שמתאימה בדיוק ל${quoted(query)}. התכוונת ל${names}?`;
            return clarifyResult('AMBIGUOUS', summary, options);
          }
          target = pick.item;
        }

        if (target.status === 'done') {
          return okResult(`המשימה ${quoted(target.title)} כבר מסומנת כבוצעה.`, { id: target.id, title: target.title, status: 'done' });
        }
        if (target.status === 'cancelled') {
          return errorResult('INVALID_PARAMS', `המשימה ${quoted(target.title)} בוטלה, ולכן לא סימנתי אותה כבוצעה.`);
        }
        const updated = db.tasks.complete(target.id);
        if (!updated) return errorResult('NOT_FOUND', 'לא מצאתי את המשימה הזו. אולי היא כבר נמחקה?');
        ctx.emit({ type: 'data-changed', scope: 'tasks' });
        return okResult(`סימנתי את המשימה ${quoted(updated.title)} כבוצעה.`, {
          id: updated.id,
          title: updated.title,
          status: updated.status,
        });
      } catch {
        return storageErrorResult('עדכון המשימה');
      }
    },
  };

  return [asTool(createTask), asTool(listTasks), asTool(completeTask)];
}

import { z } from 'zod';
import type { Clock, Database, ToolDefinition } from '../core/contracts';
import type { ReminderDTO } from '../../shared/types';
import { normalizeForMatch } from '../../shared/text-normalize';
import { ReminderValidationError, type ReminderRepositoryExtras } from '../db/reminders-repository';
import { pickSingle, rankByText } from '../db/text-search';
import { ZONE, describeWhenHe, isFuture, resolveLocalDateTime } from '../time/time';
import { clip, countFeminine, joinHebrew, joinHebrewCapped, stripTrailingPunctuation } from '../time/hebrew-text';
import {
  MAX_SPOKEN_ITEMS,
  asTool,
  cancelledResult,
  clarifyResult,
  dedupedResult,
  errorResult,
  okResult,
  storageErrorResult,
} from './task-tools';

/**
 * כלי תזכורות: create_reminder, list_reminders, cancel_reminder.
 * המועד מפוענח לפי שעון ישראל (כולל מעברי שעון), נשמר ב-UTC, ומוקרא בחזרה במלואו.
 * ביטול = שינוי סטטוס ל-cancelled (לא מחיקה), כדי שיישאר תיעוד.
 */

const MAX_DATA_ITEMS = 50;
const MAX_OPTIONS = 5;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}$/;

export const CreateReminderInputSchema = z
  .object({
    text: z.string().min(1).max(300),
    date: z.string().regex(DATE_PATTERN),
    time: z.string().regex(TIME_PATTERN),
    /** רק אחרי שהכלי ביקש הבהרה על שעה שמופיעה פעמיים (לילה של מעבר לשעון חורף). */
    dst_choice: z.enum(['earlier', 'later']).optional(),
  })
  .strict();
export type CreateReminderInput = z.infer<typeof CreateReminderInputSchema>;

export const ListRemindersInputSchema = z.object({ filter: z.enum(['upcoming', 'missed', 'all']) }).strict();
export type ListRemindersInput = z.infer<typeof ListRemindersInputSchema>;

export const CancelReminderInputSchema = z
  .object({
    reminder_id: z.string().min(1).max(64).optional(),
    text_query: z.string().min(1).max(300).optional(),
  })
  .strict();
export type CancelReminderInput = z.infer<typeof CancelReminderInputSchema>;

function quoted(text: string): string {
  return `"${clip(stripTrailingPunctuation(text), 80)}"`;
}

function plainText(text: string): string {
  return clip(stripTrailingPunctuation(text), 120);
}

function safeWhen(r: ReminderDTO, now: Date): string {
  try {
    return describeWhenHe(r.dueAtUtc, now);
  } catch {
    return r.dueLocal_he;
  }
}

function reminderData(r: ReminderDTO): Record<string, unknown> {
  return { id: r.id, text: r.text, due_local: r.dueLocal_he, due_utc: r.dueAtUtc, status: r.status, fired_at: r.firedAt };
}

/**
 * 'acknowledged' לבדו לא מספר מה קרה: גם תזכורת שהוחמצה וגם תזכורת שהופעלה עוברות אליו כשמסמנים "נקרא".
 * ההבדל נשמר ב-fired_at: NULL = הוחמצה (מעולם לא הוצגה בזמן), אחרת = הופעלה.
 */
function wasMissed(r: ReminderDTO): boolean {
  return r.status === 'missed' || (r.status === 'acknowledged' && r.firedAt === null);
}

function wasFired(r: ReminderDTO): boolean {
  return r.status === 'fired' || (r.status === 'acknowledged' && r.firedAt !== null);
}

/** הסבר למה אי אפשר לבטל תזכורת שכבר עברה את מועדה (הופעלה, או הוחמצה וסומנה כנקראה). */
function alreadyPastSummary(r: ReminderDTO): string {
  return r.firedAt === null
    ? `התזכורת ${quoted(r.text)} הוחמצה (${r.dueLocal_he}) וכבר סומנה כנקראה, אין מה לבטל.`
    : `התזכורת ${quoted(r.text)} כבר הוצגה (${r.dueLocal_he}), אין מה לבטל.`;
}

type RemindersWithExtras = Database['reminders'] & Partial<ReminderRepositoryExtras>;

/** תזכורת מתוזמנת עם אותו טקסט מנורמל ואותו מועד — דרך העזר של המאגר כשקיים, אחרת דרך החוזה. */
function findScheduledReminderExact(db: Database, text: string, dueAtUtc: string): ReminderDTO | null {
  const repo = db.reminders as RemindersWithExtras;
  if (typeof repo.findScheduledExact === 'function') return repo.findScheduledExact(text, dueAtUtc);
  const norm = normalizeForMatch(text);
  const dueMs = Date.parse(dueAtUtc);
  return repo.list('upcoming').find((r) => Date.parse(r.dueAtUtc) === dueMs && normalizeForMatch(r.text) === norm) ?? null;
}

/** תזכורת שכבר הופעלה/בוטלה/נקראה עם בדיוק אותו טקסט מנורמל (האחרונה). */
function findClosedReminderExact(db: Database, text: string): ReminderDTO | null {
  const repo = db.reminders as RemindersWithExtras;
  if (typeof repo.findClosedExact === 'function') return repo.findClosedExact(text);
  const norm = normalizeForMatch(text);
  return (
    repo
      .list('all')
      .find((r) => (r.status === 'fired' || r.status === 'acknowledged' || r.status === 'cancelled') && normalizeForMatch(r.text) === norm) ??
    null
  );
}

export function summarizeReminders(
  filter: 'upcoming' | 'missed' | 'all',
  reminders: readonly ReminderDTO[],
  now: Date,
): string {
  const n = reminders.length;
  const items = (list: readonly ReminderDTO[], past: boolean): string =>
    joinHebrewCapped(
      list.map((r) => `${plainText(r.text)} — ${past ? r.dueLocal_he : safeWhen(r, now)}`),
      MAX_SPOKEN_ITEMS,
      '; ',
    );
  if (filter === 'upcoming') {
    if (n === 0) return 'אין לך תזכורות קרובות.';
    return n === 1 ? `יש לך תזכורת אחת: ${items(reminders, false)}.` : `יש לך ${n} תזכורות קרובות: ${items(reminders, false)}.`;
  }
  if (filter === 'missed') {
    if (n === 0) return 'אין תזכורות שהוחמצו.';
    return n === 1 ? `הוחמצה תזכורת אחת: ${items(reminders, true)}.` : `הוחמצו ${n} תזכורות: ${items(reminders, true)}.`;
  }
  if (n === 0) return 'אין לך תזכורות שמורות.';
  const upcoming = reminders
    .filter((r) => r.status === 'scheduled')
    .sort((a, b) => a.dueAtUtc.localeCompare(b.dueAtUtc));
  const count = (s: ReminderDTO['status'][]): number => reminders.filter((r) => s.includes(r.status)).length;
  const missed = reminders.filter(wasMissed).length;
  const done = reminders.filter(wasFired).length;
  const cancelled = count(['cancelled']);
  const parts: string[] = [];
  if (upcoming.length > 0) parts.push(upcoming.length === 1 ? 'אחת קרובה' : `${upcoming.length} קרובות`);
  if (missed > 0) parts.push(missed === 1 ? 'אחת שהוחמצה' : `${missed} שהוחמצו`);
  if (done > 0) parts.push(done === 1 ? 'אחת שכבר הופעלה' : `${done} שכבר הופעלו`);
  if (cancelled > 0) parts.push(cancelled === 1 ? 'אחת שבוטלה' : `${cancelled} שבוטלו`);
  const head = `ברשימה ${countFeminine(n, 'תזכורת', 'תזכורות')}: ${joinHebrew(parts)}.`;
  return upcoming.length > 0 ? `${head} הקרובות: ${items(upcoming, false)}.` : head;
}

export interface ReminderToolsDeps {
  db: Database;
  clock: Clock;
  /** נקרא אחרי יצירת תזכורת — main מחבר אותו ל-scheduler.checkNow('created') כדי לכוון את הטיימר המדויק. */
  onCreated?: () => void;
}

export function createReminderTools(deps: ReminderToolsDeps): ToolDefinition[] {
  const { db, clock } = deps;

  const createReminder: ToolDefinition<CreateReminderInput> = {
    name: 'create_reminder',
    description:
      "Schedule a reminder that pops up as a Windows notification at an exact local time (Asia/Jerusalem). " +
      "Use for 'תזכיר לי מחר בשמונה בבוקר לפתוח את הפרויקט'. text: what to remind, in Ori's words without 'תזכיר לי' (e.g. 'לפתוח את הפרויקט'). " +
      "date: YYYY-MM-DD and time: HH:MM in 24h local time, resolved from 'now' in <app_context> ('מחר' = tomorrow, 'בעוד 10 דקות' = now + 10 minutes). " +
      "If the hour is ambiguous (e.g. 'בשמונה' without בוקר/ערב), ask Ori first. " +
      "dst_choice: omit it; only set 'earlier' or 'later' after this tool returned DST_AMBIGUOUS and Ori chose. " +
      'After success, read back the exact date and time from summary_he. Reminders work only while the computer is on and JARVIS is running.',
    inputSchema: CreateReminderInputSchema,
    risk: 'low',
    sideEffect: true,
    // בלי חלון כפילות של המנוע (שמבוסס על יומן הפעולות ועיוור למצב — "בטל" ואז "תזכיר שוב" נבלע):
    // הכלי עצמו אידמפוטנטי לפי מצב — תזכורת מתוזמנת זהה (טקסט + מועד) לא נוצרת פעמיים.
    dedupeWindowMs: 0,
    title: (input) => `תזכורת: ${clip(input.text, 40)}`,
    describeForApproval: (input) => ({
      action_he: 'קביעת תזכורת',
      target_he: `${clip(input.text, 120)} — ${input.date} ${input.time}`,
      impact_he: 'תוצג התראה במחשב במועד שנקבע.',
    }),
    async execute(input, ctx) {
      if (ctx.signal.aborted) return cancelledResult();
      const text = input.text.trim().replace(/\s+/g, ' ');
      if (!normalizeForMatch(text)) return clarifyResult('INVALID_PARAMS', 'על מה להזכיר לך?');

      const resolved = resolveLocalDateTime(
        input.date,
        input.time,
        input.dst_choice ? { dstChoice: input.dst_choice } : undefined,
      );
      if (!resolved.ok) {
        if (resolved.code === 'INVALID_PARAMS') return errorResult('INVALID_PARAMS', resolved.message_he);
        return clarifyResult(
          resolved.code,
          resolved.message_he,
          resolved.options?.map((o) => ({ id: o.id, label: o.label_he })),
        );
      }
      if (!isFuture(resolved.utcIso, clock.now())) {
        return clarifyResult('PAST_TIME', `המועד הזה כבר עבר (${resolved.display_he}). לאיזה מועד לקבוע?`);
      }

      let reminder: ReminderDTO;
      try {
        const existing = findScheduledReminderExact(db, text, resolved.utcIso);
        if (existing) {
          return dedupedResult(
            `התזכורת הזו כבר קיימת: ${plainText(existing.text)} — ${existing.dueLocal_he} — לא יצרתי כפילות.`,
            { id: existing.id, due_local_full: existing.dueLocal_he, due_utc: existing.dueAtUtc },
          );
        }
        reminder = db.reminders.create({
          text,
          dueAtUtc: resolved.utcIso,
          timezone: ZONE,
          dueLocal_he: resolved.display_he,
        });
      } catch (err) {
        if (err instanceof ReminderValidationError) return errorResult('INVALID_PARAMS', err.message_he);
        return storageErrorResult('שמירת התזכורת');
      }
      ctx.emit({ type: 'data-changed', scope: 'reminders' });
      try {
        deps.onCreated?.();
      } catch {
        // כיוון הטיימר הוא שיפור דיוק בלבד — הבדיקה המחזורית תתפוס את התזכורת בכל מקרה
      }
      return okResult(`קבעתי תזכורת: ${plainText(reminder.text)} — ${resolved.display_he}.`, {
        id: reminder.id,
        due_local_full: resolved.display_he,
        due_utc: resolved.utcIso,
      });
    },
  };

  const listReminders: ToolDefinition<ListRemindersInput> = {
    name: 'list_reminders',
    description:
      "List Ori's reminders. filter 'upcoming' = scheduled and not yet shown ('מה התזכורות שלי?'); " +
      "'missed' = reminders that were due while the computer was off or asleep and were not acknowledged; 'all' = everything. " +
      'The result includes reminder ids for cancel_reminder.',
    inputSchema: ListRemindersInputSchema,
    risk: 'read',
    sideEffect: false,
    dedupeWindowMs: 0,
    title: (input) =>
      input.filter === 'upcoming' ? 'תזכורות קרובות' : input.filter === 'missed' ? 'תזכורות שהוחמצו' : 'כל התזכורות',
    describeForApproval: () => ({
      action_he: 'הצגת רשימת התזכורות',
      target_he: 'התזכורות במחשב',
      impact_he: 'קריאה בלבד — שום דבר לא משתנה.',
    }),
    async execute(input, ctx) {
      if (ctx.signal.aborted) return cancelledResult();
      let reminders: ReminderDTO[];
      try {
        reminders = db.reminders.list(input.filter);
      } catch {
        return storageErrorResult('קריאת התזכורות');
      }
      return okResult(summarizeReminders(input.filter, reminders, clock.now()), {
        filter: input.filter,
        count: reminders.length,
        reminders: reminders.slice(0, MAX_DATA_ITEMS).map(reminderData),
        truncated: reminders.length > MAX_DATA_ITEMS,
      });
    },
  };

  const cancelReminder: ToolDefinition<CancelReminderInput> = {
    name: 'cancel_reminder',
    description:
      "Cancel exactly one scheduled (or missed) reminder ('בטל את התזכורת לשתות מים'). " +
      'Pass reminder_id when known (from list_reminders), otherwise text_query with the words Ori used. ' +
      'If several reminders match, the tool returns needs_clarification with options — ask Ori which one and call again with that reminder_id. Never guess.',
    inputSchema: CancelReminderInputSchema,
    risk: 'low',
    sideEffect: true,
    dedupeWindowMs: 0,
    title: (input) => (input.text_query ? `ביטול תזכורת: ${clip(input.text_query, 40)}` : 'ביטול תזכורת'),
    describeForApproval: (input) => ({
      action_he: 'ביטול תזכורת',
      target_he: input.text_query ? clip(input.text_query, 120) : 'התזכורת שנבחרה',
      impact_he: 'התזכורת לא תוצג במועדה. היא נשארת ברשימה כ"בוטלה".',
    }),
    async execute(input, ctx) {
      if (ctx.signal.aborted) return cancelledResult();
      const query = input.text_query?.trim() ?? '';
      const id = input.reminder_id?.trim() ?? '';
      if (!id && !query) return clarifyResult('INVALID_PARAMS', 'איזו תזכורת לבטל?');

      try {
        let target: ReminderDTO | null = id ? db.reminders.get(id) : null;
        if (!target && !query) return errorResult('NOT_FOUND', 'לא מצאתי את התזכורת הזו.');
        if (!target) {
          const ranked = rankByText(query, db.reminders.search(query), (r) => r.text);
          // אין תזכורת פעילה בדיוק בטקסט הזה, אבל יש כזו שכבר בוטלה/הופעלה — עונים עליה ("כבר בוטלה"),
          // ולא מבטלים תזכורת דומה אחרת ("לדניאל" -> "לדניאלה").
          const closed = ranked.some((r) => r.score >= 1) ? null : findClosedReminderExact(db, query);
          if (closed) {
            target = closed;
          } else {
            const pick = pickSingle(ranked, MAX_OPTIONS);
            if (pick.kind === 'none') {
              return errorResult('NOT_FOUND', `לא מצאתי תזכורת פעילה שמתאימה ל${quoted(query)}.`);
            }
            // רק התאמה מדויקת או של מילים שלמות נבחרת לבד; כל השאר — שאלת הבהרה עם אפשרויות
            if (pick.kind === 'many' || pick.kind === 'weak') {
              const options = pick.items.map((r) => ({ id: r.id, label: `${plainText(r.text)} — ${r.dueLocal_he}` }));
              const names = joinHebrew(
                pick.items.map((r) => `${quoted(r.text)} (${safeWhen(r, clock.now())})`),
              );
              const summary =
                pick.kind === 'many'
                  ? `מצאתי כמה תזכורות שמתאימות ל${quoted(query)}: ${names}. איזו מהן לבטל?`
                  : `לא מצאתי תזכורת שמתאימה בדיוק ל${quoted(query)}. התכוונת ל${names}?`;
              return clarifyResult('AMBIGUOUS', summary, options);
            }
            target = pick.item;
          }
        }

        if (target.status === 'cancelled') {
          return okResult(`התזכורת ${quoted(target.text)} כבר בוטלה.`, { id: target.id, status: 'cancelled' });
        }
        if (target.status === 'fired' || target.status === 'acknowledged') {
          return errorResult('INVALID_PARAMS', alreadyPastSummary(target));
        }
        const updated = db.reminders.cancel(target.id);
        if (!updated) return errorResult('NOT_FOUND', 'לא מצאתי את התזכורת הזו.');
        if (updated.status !== 'cancelled') {
          // בין הקריאה לביטול התזכורת הספיקה להופיע — מדווחים את המצב האמיתי
          return errorResult('INVALID_PARAMS', alreadyPastSummary(updated));
        }
        ctx.emit({ type: 'data-changed', scope: 'reminders' });
        return okResult(`ביטלתי את התזכורת: ${plainText(updated.text)} (${updated.dueLocal_he}).`, {
          id: updated.id,
          status: updated.status,
        });
      } catch {
        return storageErrorResult('ביטול התזכורת');
      }
    },
  };

  return [asTool(createReminder), asTool(listReminders), asTool(cancelReminder)];
}

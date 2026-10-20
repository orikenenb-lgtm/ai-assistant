import { eq, sql } from "drizzle-orm";
import { db, schema, withSystemTx } from "@/server/db";
import { env } from "@/server/env";
import { sendEmail } from "@/server/email";
import { enqueueJob } from "@/server/jobs/queue";
import { PermanentJobError, registerJobHandler } from "@/server/jobs/runner";
import { registerSchedule } from "@/server/jobs/scheduler";
import { formatDateTime } from "@/lib/format";
import { tenantTimezone } from "./service";
// Calendar sync registers alongside (single registry entry for this module pair).
import "@/modules/calendar/jobs";

type ClaimedReminder = {
  id: string;
  tenant_id: string;
  title: string;
  due_at: Date | null;
  recipient: string | null;
  locale: string | null;
  in_app: boolean | null;
  email: boolean | null;
};

/**
 * Claims every due reminder exactly once (UPDATE … WHERE reminder_sent_at IS
 * NULL with SKIP LOCKED, so concurrent workers never double-send) and, in the
 * same transaction, creates the in-app notification and queues the email.
 */
export async function processDueReminders(now = new Date(), limit = 200): Promise<number> {
  return withSystemTx(async (tx) => {
    const claimed = await tx.execute<ClaimedReminder>(sql`
      with due as (
        select id from public.tasks
        where remind_at <= ${now.toISOString()}::timestamptz
          and reminder_sent_at is null
          and status in ('open', 'in_progress')
        order by remind_at
        limit ${limit}
        for update skip locked
      ), updated as (
        update public.tasks t set reminder_sent_at = now()
        from due where t.id = due.id
        returning t.id, t.tenant_id, t.title, t.due_at, coalesce(t.assignee_id, t.created_by) as recipient
      )
      select u.id, u.tenant_id, u.title, u.due_at, u.recipient, p.locale, np.in_app, np.email
      from updated u
      left join public.memberships m on m.tenant_id = u.tenant_id and m.user_id = u.recipient and m.status = 'active'
      left join public.profiles p on p.id = m.user_id
      left join public.notification_preferences np
        on np.tenant_id = u.tenant_id and np.user_id = m.user_id and np.event_type = 'task_reminder'`);

    for (const r of claimed) {
      // Recipient left the organization: nothing to deliver (still marked sent).
      if (!r.recipient || !r.locale) continue;
      const locale = r.locale === "en" ? "en" : "he";
      if (r.in_app ?? true) {
        await tx.insert(schema.notifications).values({
          tenantId: r.tenant_id,
          userId: r.recipient,
          type: "task_reminder",
          title: (locale === "he" ? `תזכורת: ${r.title}` : `Reminder: ${r.title}`).slice(0, 200),
          link: `/tasks?task=${r.id}`,
        });
      }
      if (r.email ?? false) {
        await enqueueJob(tx, {
          tenantId: r.tenant_id,
          type: "tasks.reminder_email",
          payload: { taskId: r.id, userId: r.recipient },
          idempotencyKey: `task-reminder-email:${r.id}:${now.toISOString().slice(0, 16)}`,
        });
      }
    }
    return claimed.length;
  });
}

registerJobHandler("tasks.reminders", async () => {
  await processDueReminders();
});
registerSchedule({ name: "tasks.reminders", everyMinutes: 1, job: { tenantId: null, type: "tasks.reminders", priority: 3 } });

registerJobHandler("tasks.reminder_email", async (job) => {
  const { taskId, userId } = job.payload as { taskId?: string; userId?: string };
  if (!taskId || !userId || !job.tenantId) throw new PermanentJobError("invalid payload");
  const [task] = await db().select().from(schema.tasks).where(eq(schema.tasks.id, taskId));
  const [profile] = await db().select().from(schema.profiles).where(eq(schema.profiles.id, userId));
  if (!task || !profile || task.tenantId !== job.tenantId) return;
  const locale = profile.locale === "en" ? "en" : "he";
  const tz = await tenantTimezone(db(), job.tenantId);
  await sendEmail({
    to: profile.email,
    template: "task_reminder",
    locale,
    tenantId: job.tenantId,
    data: {
      name: profile.fullName,
      taskTitle: task.title,
      dueAt: task.dueAt ? formatDateTime(task.dueAt, locale, tz) : locale === "he" ? "ללא תאריך יעד" : "no due date",
      url: `${env().APP_URL}/tasks?task=${task.id}`,
    },
  });
});

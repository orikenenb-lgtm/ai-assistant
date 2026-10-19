import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema, type Executor } from "@/server/db";
import type { ServiceCtx } from "@/server/context";
import { enqueueJob } from "@/server/jobs/queue";

export type NotificationType =
  | "conversation_assigned"
  | "message_received"
  | "task_assigned"
  | "task_reminder"
  | "deal_won"
  | "deal_lost"
  | "lead_assigned"
  | "mention"
  | "ai_proposal"
  | "automation_failed"
  | "invitation_accepted";

type Localized = string | { he: string; en: string };

export type NotifyInput = {
  tenantId: string;
  userId: string;
  type: NotificationType;
  title: Localized;
  body?: Localized;
  link?: string;
};

const pick = (v: Localized | undefined, locale: "he" | "en") => (v === undefined ? undefined : typeof v === "string" ? v : v[locale]);

/**
 * Creates an in-app notification (and queues an email when the user opted in),
 * honoring per-user preferences. Runs in the caller's transaction.
 */
export async function notify(tx: Executor, input: NotifyInput) {
  // Preferences are private to their owner under RLS, so read them with system privileges.
  const [row] = await db().execute<{ locale: string; in_app: boolean | null; email: boolean | null }>(sql`
    select p.locale, np.in_app, np.email
    from public.profiles p
    left join public.notification_preferences np
      on np.user_id = p.id and np.tenant_id = ${input.tenantId} and np.event_type = ${input.type}
    where p.id = ${input.userId}`);
  if (!row) return;
  const locale = row.locale === "en" ? "en" : "he";
  const inApp = row.in_app ?? true;
  const email = row.email ?? false;
  const title = pick(input.title, locale)!.slice(0, 200);
  const body = pick(input.body, locale)?.slice(0, 1000);
  if (inApp) {
    await tx.insert(schema.notifications).values({
      tenantId: input.tenantId,
      userId: input.userId,
      type: input.type,
      title,
      body: body ?? null,
      link: input.link ?? null,
    });
  }
  if (email) {
    await enqueueJob(tx, {
      tenantId: input.tenantId,
      type: "email.notification",
      payload: { userId: input.userId, title, body: body ?? "", link: input.link ?? "/" },
    });
  }
}

export async function listNotifications(ctx: ServiceCtx, limit = 20) {
  return ctx.run(async (tx) => {
    const items = await tx
      .select()
      .from(schema.notifications)
      .where(and(eq(schema.notifications.tenantId, ctx.tenantId), eq(schema.notifications.userId, ctx.userId!)))
      .orderBy(desc(schema.notifications.createdAt))
      .limit(limit);
    const [{ unread }] = await tx
      .select({ unread: sql<number>`count(*)::int` })
      .from(schema.notifications)
      .where(and(eq(schema.notifications.tenantId, ctx.tenantId), eq(schema.notifications.userId, ctx.userId!), isNull(schema.notifications.readAt)));
    return { items, unread };
  });
}

export async function markNotificationsRead(ctx: ServiceCtx, ids: string[] | "all") {
  await ctx.run(async (tx) => {
    const base = and(eq(schema.notifications.tenantId, ctx.tenantId), eq(schema.notifications.userId, ctx.userId!), isNull(schema.notifications.readAt));
    await tx
      .update(schema.notifications)
      .set({ readAt: new Date() })
      .where(ids === "all" ? base : and(base, inArray(schema.notifications.id, ids)));
  });
}

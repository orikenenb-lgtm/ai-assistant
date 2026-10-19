import { and, eq } from "drizzle-orm";
import { schema } from "@/server/db";
import { assertWritable, type ServiceCtx } from "@/server/context";
import { AppError } from "@/server/errors";

export const NOTIFICATION_EVENTS = [
  "conversation_assigned",
  "message_received",
  "task_assigned",
  "task_reminder",
  "deal_won",
  "deal_lost",
  "lead_assigned",
  "mention",
  "ai_proposal",
  "automation_failed",
  "invitation_accepted",
] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

export type PreferenceView = { eventType: NotificationEvent; inApp: boolean; email: boolean };

/** Defaults when no row exists: in-app on, email off (same as notify()). */
export async function listPreferences(ctx: ServiceCtx): Promise<PreferenceView[]> {
  if (!ctx.userId) return NOTIFICATION_EVENTS.map((eventType) => ({ eventType, inApp: true, email: false }));
  const rows = await ctx.run((tx) =>
    tx
      .select()
      .from(schema.notificationPreferences)
      .where(and(eq(schema.notificationPreferences.tenantId, ctx.tenantId), eq(schema.notificationPreferences.userId, ctx.userId!))),
  );
  const byType = new Map(rows.map((r) => [r.eventType, r]));
  return NOTIFICATION_EVENTS.map((eventType) => ({
    eventType,
    inApp: byType.get(eventType)?.inApp ?? true,
    email: byType.get(eventType)?.email ?? false,
  }));
}

/** Upserts the current user's own preference (RLS: own rows only). */
export async function savePreference(ctx: ServiceCtx, input: { eventType: NotificationEvent; inApp: boolean; email: boolean }) {
  assertWritable(ctx);
  if (!ctx.userId || ctx.actorType !== "user") throw new AppError("FORBIDDEN", "errors.forbidden");
  await ctx.run((tx) =>
    tx
      .insert(schema.notificationPreferences)
      .values({ tenantId: ctx.tenantId, userId: ctx.userId!, eventType: input.eventType, inApp: input.inApp, email: input.email })
      .onConflictDoUpdate({
        target: [schema.notificationPreferences.tenantId, schema.notificationPreferences.userId, schema.notificationPreferences.eventType],
        set: { inApp: input.inApp, email: input.email },
      }),
  );
}

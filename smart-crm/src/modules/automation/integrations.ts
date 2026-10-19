import { and, eq } from "drizzle-orm";
import { schema } from "@/server/db";
import { PermanentJobError } from "@/server/jobs/runner";
import { createTask, tenantTimezone } from "@/modules/tasks/service";
import { taskInputSchema } from "@/modules/tasks/schemas";
import { openConversationForContact, sendMessage } from "@/modules/inbox/service";
import { ACTION_PARAMS } from "./action-params";
import { needContact, recordOwner, registerAutomationAction } from "./actions-registry";
import { interpolate } from "./rules";
import type { RunContext } from "./run-context";

/**
 * Actions backed by other modules. Each delegates to that module's service so
 * the same validation, compliance checks, audit and events apply as for a
 * human user — automations get no shortcuts.
 */

/** Wall-clock "YYYY-MM-DDTHH:mm" in the tenant zone, `days` from now. */
function localInputInDays(days: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(Date.now() + days * 86_400_000))
    .reduce<Record<string, string>>((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

registerAutomationAction("create_task", {
  params: ACTION_PARAMS.create_task,
  run: async (ctx, p, run) => {
    const assigneeId = p.assignTo === "user" ? (p.userId ?? null) : recordOwner(run);
    const timeZone = await ctx.run((tx) => tenantTimezone(tx, ctx.tenantId));
    const task = await createTask(
      ctx,
      taskInputSchema.parse({
        title: interpolate(p.title, run.data).slice(0, 300),
        description: interpolate(p.description, run.data).slice(0, 5000),
        priority: p.priority,
        dueAt: localInputInDays(p.dueInDays, timeZone),
        reminder: "at_due",
        assigneeId,
        contactId: run.contact?.id ?? null,
        dealId: run.deal?.id ?? null,
        leadId: run.lead?.id ?? null,
      }),
      { source: "automation" },
    );
    return { taskId: task.id, assigneeId: task.assigneeId };
  },
});

async function conversationFor(ctx: Parameters<typeof openConversationForContact>[0], run: RunContext) {
  if (run.conversationId) return run.conversationId;
  return openConversationForContact(ctx, needContact(run).id);
}

registerAutomationAction("send_whatsapp_text", {
  params: ACTION_PARAMS.send_whatsapp_text,
  requires: ["contact"],
  run: async (ctx, p, run, step) => {
    const conversationId = await conversationFor(ctx, run);
    const r = await sendMessage(ctx, conversationId, { kind: "text", text: interpolate(p.text, run.data).slice(0, 4096) }, { clientKey: step.idempotencyKey });
    return { conversationId, messageId: r.id };
  },
});

registerAutomationAction("send_whatsapp_template", {
  params: ACTION_PARAMS.send_whatsapp_template,
  requires: ["contact"],
  run: async (ctx, p, run, step) => {
    const conversationId = await conversationFor(ctx, run);
    const [tpl] = await ctx.run((tx) =>
      tx
        .select({ id: schema.messageTemplates.id })
        .from(schema.messageTemplates)
        .innerJoin(schema.conversations, eq(schema.conversations.whatsappAccountId, schema.messageTemplates.whatsappAccountId))
        .where(
          and(
            eq(schema.conversations.id, conversationId),
            eq(schema.messageTemplates.tenantId, ctx.tenantId),
            eq(schema.messageTemplates.name, p.templateName),
            eq(schema.messageTemplates.language, p.language),
          ),
        ),
    );
    if (!tpl) throw new PermanentJobError(`template "${p.templateName}" (${p.language}) not found on this WhatsApp number`);
    const bodyParams = p.params.map((x) => interpolate(x, run.data).trim() || "-");
    const r = await sendMessage(ctx, conversationId, { kind: "template", templateId: tpl.id, headerParams: [], bodyParams }, { clientKey: step.idempotencyKey });
    return { conversationId, messageId: r.id };
  },
});

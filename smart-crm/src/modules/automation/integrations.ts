import { and, eq } from "drizzle-orm";
import { schema } from "@/server/db";
import { PermanentJobError } from "@/server/jobs/runner";
import { createTask, tenantTimezone } from "@/modules/tasks/service";
import { taskInputSchema } from "@/modules/tasks/schemas";
import { toLocalInput } from "@/modules/calendar/tz";
import { openConversationForContact, sendMessage } from "@/modules/inbox/service";
import { moveDeal } from "@/modules/sales/deals";
import { setLeadStatus } from "@/modules/sales/leads";
import { postPinned } from "@/modules/webhooks/jobs";
import { validateWebhookUrl } from "@/modules/webhooks/ssrf";
import { ACTION_PARAMS } from "./action-params";
import { needContact, recordOwner, registerAutomationAction } from "./actions-registry";
import { interpolate } from "./rules";
import type { RunContext } from "./run-context";

/**
 * Actions backed by other modules. Each delegates to that module's service so
 * the same validation, compliance checks, audit and events apply as for a
 * human user — automations get no shortcuts.
 */


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
        dueAt: toLocalInput(new Date(Date.now() + p.dueInDays * 86_400_000), timeZone),
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

registerAutomationAction("move_deal_stage", {
  params: ACTION_PARAMS.move_deal_stage,
  requires: ["deal"],
  run: async (ctx, p, run) => {
    if (!run.deal) throw new PermanentJobError("this action needs a deal in the trigger");
    if (run.deal.stageId === p.stageId) return { unchanged: true };
    // Stage must belong to the deal's pipeline; "lost" needs a reason and is refused (VALIDATION → permanent).
    const after = await moveDeal(ctx, { id: run.deal.id, stageId: p.stageId });
    return { dealId: after.id, stageId: after.stageId };
  },
});

registerAutomationAction("update_lead_status", {
  params: ACTION_PARAMS.update_lead_status,
  requires: ["lead"],
  run: async (ctx, p, run) => {
    if (!run.lead) throw new PermanentJobError("this action needs a lead in the trigger");
    if (run.lead.status === p.status) return { unchanged: true };
    await setLeadStatus(ctx, run.lead.id, p.status, p.status === "unqualified" ? "automation" : null);
    return { leadId: run.lead.id, status: p.status };
  },
});

registerAutomationAction("call_webhook", {
  params: ACTION_PARAMS.call_webhook,
  run: async (_ctx, p, run, step) => {
    // Same SSRF protection as outbound webhooks: static checks, then DNS resolved once and pinned.
    const check = validateWebhookUrl(p.url);
    if (!check.ok) throw new PermanentJobError(`webhook url rejected: ${check.reason}`);
    const body = JSON.stringify({ type: "automation.step", runId: step.runId, nodeId: step.nodeId, data: run.data });
    const res = await postPinned(check.url, body, {
      "Content-Type": "application/json",
      "User-Agent": "SmartCRM-Automation/1.0",
      "Idempotency-Key": step.idempotencyKey,
    });
    if (res.status >= 200 && res.status < 300) return { status: res.status };
    const message = `webhook responded ${res.status}`;
    // 4xx (except 408/429) will not succeed on retry.
    if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) throw new PermanentJobError(message);
    throw new Error(message);
  },
});

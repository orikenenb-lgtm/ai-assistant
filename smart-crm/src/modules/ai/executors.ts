import { z } from "zod";
import { createTask, tenantTimezone } from "@/modules/tasks/service";
import { TASK_PRIORITIES, taskInputSchema } from "@/modules/tasks/schemas";
import { assignConversation, sendMessage } from "@/modules/inbox/service";
import { moveDeal } from "@/modules/sales/deals";
import { setLeadStatus } from "@/modules/sales/leads";
import { registerProposalExecutor } from "./proposals";

/**
 * Executors for proposals backed by other modules. They run as the approving
 * user through each module's normal service (RBAC, RLS, compliance checks).
 */

/** ISO instant → "YYYY-MM-DDTHH:mm" wall clock in the tenant zone (the task form format). */
function toLocalInput(iso: string, timeZone: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(d)
    .reduce<Record<string, string>>((acc, x) => ({ ...acc, [x.type]: x.value }), {});
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

registerProposalExecutor("create_task", {
  permission: "tasks.create",
  payload: z.object({
    title: z.string().trim().min(1).max(300),
    description: z.string().max(5000).optional(),
    dueAt: z.string().max(40).optional(),
    priority: z.enum(TASK_PRIORITIES).optional(),
    contactId: z.uuid().optional(),
    dealId: z.uuid().optional(),
    leadId: z.uuid().optional(),
  }),
  execute: async (ctx, p) => {
    const timeZone = await ctx.run((tx) => tenantTimezone(tx, ctx.tenantId));
    const task = await createTask(
      ctx,
      taskInputSchema.parse({
        title: p.title,
        description: p.description ?? null,
        priority: p.priority ?? "medium",
        dueAt: p.dueAt ? toLocalInput(p.dueAt, timeZone) : null,
        contactId: p.contactId ?? null,
        dealId: p.dealId ?? null,
        leadId: p.leadId ?? null,
      }),
      { source: "ai" },
    );
    return { taskId: task.id };
  },
});

registerProposalExecutor("assign_conversation", {
  permission: "inbox.assign",
  payload: z.object({ conversationId: z.uuid(), assigneeId: z.uuid().nullable() }),
  execute: async (ctx, p) => {
    await assignConversation(ctx, p.conversationId, p.assigneeId);
    return { conversationId: p.conversationId, assigneeId: p.assigneeId };
  },
});

registerProposalExecutor("send_whatsapp_message", {
  permission: "inbox.reply",
  payload: z.object({ conversationId: z.uuid(), text: z.string().trim().min(1).max(4096) }),
  execute: async (ctx, p) => {
    const r = await sendMessage(ctx, p.conversationId, { kind: "text", text: p.text });
    return { messageId: r.id };
  },
});

registerProposalExecutor("update_deal_stage", {
  permission: "deals.update",
  payload: z.object({ dealId: z.uuid(), stageId: z.uuid() }),
  execute: async (ctx, p) => {
    const after = await moveDeal(ctx, { id: p.dealId, stageId: p.stageId });
    return { dealId: after.id, stageId: after.stageId };
  },
});

registerProposalExecutor("update_lead_status", {
  permission: "leads.update",
  payload: z.object({ leadId: z.uuid(), status: z.enum(["new", "contacted", "qualified", "unqualified"]), reason: z.string().trim().max(500).optional() }),
  execute: async (ctx, p) => {
    await setLeadStatus(ctx, p.leadId, p.status, p.reason ?? null);
    return { leadId: p.leadId, status: p.status };
  },
});

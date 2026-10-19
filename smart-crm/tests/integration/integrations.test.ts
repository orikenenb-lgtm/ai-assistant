import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, db, schema } from "@/server/db";
import { systemCtx } from "@/server/context";
import { emitEvent } from "@/server/events";
import { drainJobs } from "@/server/jobs/runner";
import "@/server/jobs/registry";
import { connectAccount, type AccountView } from "@/modules/whatsapp/accounts";
import { ingestWhatsAppWebhook } from "@/modules/whatsapp/webhook";
import { buildInboundPayload } from "@/modules/whatsapp/simulator";
import { metaSignature } from "@/modules/whatsapp/signature";
import { createWorkflow, getWorkflow, publishWorkflow, saveDraft } from "@/modules/automation/service";
import type { WorkflowDefinition } from "@/modules/automation/definition";
import { approveProposal, createProposal } from "@/modules/ai/proposals";
import "@/modules/ai/executors";
import { createTeam } from "../support/factories";

/** Cross-module wiring: automations and AI proposals acting through the tasks and inbox services. */

type Team = Awaited<ReturnType<typeof createTeam>>;
let T: Team;
let acc: AccountView;
const pos = { x: 0, y: 0 };

async function drain() {
  for (let i = 0; i < 12; i++) {
    const s = await drainJobs({ workerId: "integrations-test", types: ["events.dispatch", "automation.step", "whatsapp.process_webhook"] });
    if (s.processed === 0) break;
  }
}

async function publish(name: string, d: WorkflowDefinition) {
  const wf = await createWorkflow(T.ownerCtx, { name });
  await saveDraft(T.ownerCtx, wf.id, { definition: d });
  await publishWorkflow(T.ownerCtx, wf.id);
  return wf.id;
}

async function inbound(fromPhone: string, text: string) {
  const raw = JSON.stringify(buildInboundPayload(acc, { fromPhone, name: "יעל", text }));
  await ingestWhatsAppWebhook(raw, metaSignature(raw, process.env.META_APP_SECRET!));
  await drain();
}

beforeAll(async () => {
  T = await createTeam("Integrations Co");
  acc = await connectAccount(T.ownerCtx, {
    provider: "mock",
    displayName: "Main",
    phoneNumber: "+972500000077",
    phoneNumberId: `pnX${Date.now().toString(36)}`,
    wabaId: "waba_x",
    sendRatePerMinute: 60,
  });
});

afterAll(async () => {
  await closeDb();
});

describe("automation → tasks", () => {
  it("create_task assigns the record owner, links the contact and interpolates the title", async () => {
    const wfId = await publish("follow up", {
      nodes: [
        { id: "t", type: "trigger", config: { kind: "event", event: "contact.created", filters: [] }, position: pos },
        { id: "a", type: "action", config: { action: "create_task", params: { title: "להתקשר ל{{contact.firstName}}", dueInDays: 2, priority: "high", assignTo: "owner" } }, position: pos },
      ],
      edges: [{ id: "e", source: "t", target: "a" }],
    });
    expect((await getWorkflow(T.ownerCtx, wfId)).availableActions).toContain("create_task");
    const [c] = await db().insert(schema.contacts).values({ tenantId: T.tenant.id, firstName: "רונן", ownerId: T.agent.id }).returning();
    await T.systemCtx.run((tx) => emitEvent(tx, T.systemCtx, { type: "contact.created", entityType: "contact", entityId: c.id, data: {} }));
    await drain();

    const [task] = await db().select().from(schema.tasks).where(and(eq(schema.tasks.tenantId, T.tenant.id), eq(schema.tasks.contactId, c.id)));
    expect(task.title).toBe("להתקשר לרונן");
    expect(task.assigneeId).toBe(T.agent.id);
    expect(task.source).toBe("automation");
    expect(task.priority).toBe("high");
    const days = (task.dueAt!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(1.9);
    expect(days).toBeLessThan(2.1);
  });
});

describe("automation → WhatsApp", () => {
  it("auto-replies inside the 24h window exactly once, through the inbox compliance checks", async () => {
    await publish("auto reply", {
      nodes: [
        { id: "t", type: "trigger", config: { kind: "event", event: "message.received", filters: [{ field: "message.body", op: "contains", value: "מחיר" }] }, position: pos },
        { id: "a", type: "action", config: { action: "send_whatsapp_text", params: { text: "תודה {{contact.firstName}}, נציג יחזור אליך" } }, position: pos },
      ],
      edges: [{ id: "e", source: "t", target: "a" }],
    });
    const phone = `+97254${String(Date.now()).slice(-7)}`;
    await inbound(phone, "שלום");
    await inbound(phone, "מה המחיר?");
    const [conv] = await db()
      .select({ id: schema.conversations.id })
      .from(schema.conversations)
      .innerJoin(schema.contacts, eq(schema.contacts.id, schema.conversations.contactId))
      .where(and(eq(schema.conversations.tenantId, T.tenant.id), eq(schema.contacts.phone, phone)));
    const out = await db()
      .select()
      .from(schema.messages)
      .where(and(eq(schema.messages.conversationId, conv.id), eq(schema.messages.direction, "outbound")));
    // Only the message containing "מחיר" matched the trigger filter.
    expect(out).toHaveLength(1);
    expect(out[0].body).toBe("תודה יעל, נציג יחזור אליך");
    expect(out[0].senderType).toBe("automation");
    expect(out[0].clientKey).toMatch(/^auto:/);
  });

  it("an opted-out contact fails the run permanently instead of retrying", async () => {
    const wfId = await publish("welcome", {
      nodes: [
        { id: "t", type: "trigger", config: { kind: "manual" }, position: pos },
        { id: "a", type: "action", config: { action: "send_whatsapp_text", params: { text: "היי" } }, position: pos },
      ],
      edges: [{ id: "e", source: "t", target: "a" }],
    });
    const phone = `+97253${String(Date.now()).slice(-7)}`;
    await inbound(phone, "שלום");
    await inbound(phone, "הסר");
    const [contact] = await db().select().from(schema.contacts).where(and(eq(schema.contacts.tenantId, T.tenant.id), eq(schema.contacts.phone, phone)));
    expect(contact.whatsappConsent).toBe("opted_out");
    const { runManually } = await import("@/modules/automation/service");
    const runId = await runManually(T.ownerCtx, wfId, contact.id);
    await drain();
    const [run] = await db().select().from(schema.automationRuns).where(eq(schema.automationRuns.id, runId!));
    expect(run.status).toBe("failed");
    expect(run.error).toBe("inbox.optedOut");
    const steps = await db().select().from(schema.automationRunSteps).where(eq(schema.automationRunSteps.runId, runId!));
    expect(steps.filter((s) => s.nodeId === "a")).toHaveLength(1);
  });
});

describe("AI proposals → modules (executed as the approver)", () => {
  it("create_task proposal becomes a task only after approval", async () => {
    const p = await createProposal(T.agentCtx, { actionType: "create_task", payload: { title: "לשלוח קטלוג", dueAt: new Date(Date.now() + 86_400_000).toISOString(), priority: "medium" } });
    expect(await db().select().from(schema.tasks).where(and(eq(schema.tasks.tenantId, T.tenant.id), eq(schema.tasks.title, "לשלוח קטלוג")))).toHaveLength(0);
    const r = await approveProposal(T.managerCtx, p.id);
    expect(r.status).toBe("executed");
    const [task] = await db().select().from(schema.tasks).where(eq(schema.tasks.id, (r.result as { taskId: string }).taskId));
    expect(task.source).toBe("ai");
    expect(task.createdBy).toBe(T.manager.id);
    expect(task.assigneeId).toBe(T.manager.id);
  });

  it("send_whatsapp_message proposal queues a reply through the inbox service", async () => {
    const phone = `+97255${String(Date.now()).slice(-7)}`;
    await inbound(phone, "יש לכם משלוחים?");
    const [conv] = await db()
      .select({ id: schema.conversations.id })
      .from(schema.conversations)
      .innerJoin(schema.contacts, eq(schema.contacts.id, schema.conversations.contactId))
      .where(and(eq(schema.conversations.tenantId, T.tenant.id), eq(schema.contacts.phone, phone)));
    const p = await createProposal(T.agentCtx, { actionType: "send_whatsapp_message", payload: { conversationId: conv.id, text: "כן, לכל הארץ" } });
    await approveProposal(T.ownerCtx, p.id);
    const out = await db().select().from(schema.messages).where(and(eq(schema.messages.conversationId, conv.id), eq(schema.messages.direction, "outbound")));
    expect(out.map((m) => m.body)).toEqual(["כן, לכל הארץ"]);
    expect(out[0].senderUserId).toBe(T.owner.id);
  });

  it("assign_conversation respects the approver's permissions", async () => {
    const [conv] = await db().select({ id: schema.conversations.id }).from(schema.conversations).where(eq(schema.conversations.tenantId, T.tenant.id)).limit(1);
    const p = await createProposal(T.agentCtx, { actionType: "assign_conversation", payload: { conversationId: conv.id, assigneeId: T.agent.id } });
    await approveProposal(T.managerCtx, p.id);
    const [after] = await db().select({ assigneeId: schema.conversations.assigneeId }).from(schema.conversations).where(eq(schema.conversations.id, conv.id));
    expect(after.assigneeId).toBe(T.agent.id);
  });
});

void systemCtx;

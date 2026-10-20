import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { closeDb, db, schema } from "@/server/db";
import { systemCtx } from "@/server/context";
import { emitEvent } from "@/server/events";
import { drainJobs } from "@/server/jobs/runner";
import { AppError } from "@/server/errors";
import "@/modules/automation/engine";
import { definitionSchema, type WorkflowDefinition } from "@/modules/automation/definition";
import { nextSlot, runDueSchedules, startWebhookRun } from "@/modules/automation/engine";
import { registerAutomationAction } from "@/modules/automation/actions-registry";
import { evaluateRule, interpolate } from "@/modules/automation/rules";
import { createWorkflow, listRuns, listWorkflows, publishWorkflow, retryFailedRun, saveDraft, setWorkflowStatus, getRunSteps } from "@/modules/automation/service";
import { createTeam } from "../support/factories";
import { z } from "zod";

type Team = Awaited<ReturnType<typeof createTeam>>;
let T: Team;
let B: Team;
const TYPES = ["events.dispatch", "automation.step"];

async function expectAppError(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code);
}

const pos = { x: 0, y: 0 };
function def(nodes: WorkflowDefinition["nodes"], edges: WorkflowDefinition["edges"]): WorkflowDefinition {
  return { nodes, edges };
}

async function publish(team: Team, name: string, d: WorkflowDefinition) {
  const wf = await createWorkflow(team.ownerCtx, { name });
  await saveDraft(team.ownerCtx, wf.id, { definition: d });
  const res = await publishWorkflow(team.ownerCtx, wf.id);
  return { id: wf.id, ...res };
}

async function contact(team: Team, firstName: string, extra: Partial<typeof schema.contacts.$inferInsert> = {}) {
  const [c] = await db().insert(schema.contacts).values({ tenantId: team.tenant.id, firstName, ...extra }).returning();
  return c;
}

async function fire(team: Team, type: "contact.created" | "contact.updated" | "contact.tag_added", contactId: string, data: Record<string, unknown> = {}) {
  const ctx = systemCtx(team.tenant.id);
  await ctx.run((tx) => emitEvent(tx, ctx, { type, entityType: "contact", entityId: contactId, data }));
}

async function drain() {
  for (let i = 0; i < 10; i++) {
    const s = await drainJobs({ workerId: "auto-test", types: TYPES });
    if (s.processed === 0) break;
  }
}

async function runsOf(workflowId: string) {
  return db().select().from(schema.automationRuns).where(eq(schema.automationRuns.workflowId, workflowId));
}

const calls: string[] = [];
let flakyFailures = 0;
registerAutomationAction("call_webhook", {
  params: z.object({ mode: z.enum(["ok", "flaky", "fail"]) }),
  run: async (_ctx, p, run) => {
    if (p.mode === "fail") throw new Error("remote endpoint returned 500");
    if (p.mode === "flaky" && flakyFailures++ < 1) throw new Error("timeout");
    calls.push(`${p.mode}:${run.contact?.firstName}`);
    return { ok: true };
  },
});

beforeAll(async () => {
  T = await createTeam("Automation Co");
  B = await createTeam("Other Automation Co");
  await db().execute(sql`delete from public.jobs`);
});

afterAll(async () => {
  await closeDb();
});

describe("definition validation", () => {
  const trigger = { id: "t", type: "trigger" as const, config: { kind: "event" as const, event: "contact.created" as const, filters: [] }, position: pos };
  it("rejects cycles, multiple triggers and unlabeled condition branches", () => {
    const action = (id: string) => ({ id, type: "action" as const, config: { action: "add_note" as const, params: { body: "x" } }, position: pos });
    expect(definitionSchema.safeParse(def([trigger, action("a"), action("b")], [{ id: "1", source: "t", target: "a" }, { id: "2", source: "a", target: "b" }, { id: "3", source: "b", target: "a" }])).success).toBe(false);
    expect(definitionSchema.safeParse(def([trigger, { ...trigger, id: "t2" }], [])).success).toBe(false);
    const cond = { id: "c", type: "condition" as const, config: { match: "all" as const, rules: [{ field: "contact.firstName", op: "eq" as const, value: "x" }] }, position: pos };
    expect(definitionSchema.safeParse(def([trigger, cond, action("a")], [{ id: "1", source: "t", target: "c" }, { id: "2", source: "c", target: "a" }])).success).toBe(false);
    expect(definitionSchema.safeParse(def([trigger, cond, action("a")], [{ id: "1", source: "t", target: "c" }, { id: "2", source: "c", target: "a", branch: "true" }])).success).toBe(true);
  });

  it("evaluates rules and interpolates templates", () => {
    const ctx = { contact: { firstName: "דנה", tags: ["t1"], score: 70 } };
    expect(evaluateRule({ field: "contact.firstName", op: "eq", value: "דנה" }, ctx)).toBe(true);
    expect(evaluateRule({ field: "contact.tags", op: "has_tag", value: "t1" }, ctx)).toBe(true);
    expect(evaluateRule({ field: "contact.score", op: "gte", value: 50 }, ctx)).toBe(true);
    expect(evaluateRule({ field: "contact.missing", op: "is_empty" }, ctx)).toBe(true);
    expect(interpolate("שלום {{contact.firstName}}{{contact.nope}}!", ctx)).toBe("שלום דנה!");
  });
});

describe("engine", () => {
  it("runs an event-triggered workflow end to end, exactly once per event", async () => {
    const wf = await publish(T, "Notify on new contact", def(
      [
        { id: "t", type: "trigger", config: { kind: "event", event: "contact.created", filters: [] }, position: pos },
        { id: "a", type: "action", config: { action: "add_note", params: { body: "Welcome {{contact.firstName}}" } }, position: pos },
      ],
      [{ id: "e", source: "t", target: "a" }],
    ));
    const c = await contact(T, "רונית");
    await fire(T, "contact.created", c.id);
    await drain();
    const runs = await runsOf(wf.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: "completed", stepsExecuted: 1, entityId: c.id });
    const [note] = await db().select().from(schema.notes).where(eq(schema.notes.contactId, c.id));
    expect(note.body).toBe("Welcome רונית");
    // Redelivering the same dispatch job does not create a second run.
    const [evtJob] = await db().select().from(schema.jobs).where(and(eq(schema.jobs.type, "events.dispatch"), sql`payload->>'entityId' = ${c.id}`));
    await db().execute(sql`update public.jobs set status = 'queued', run_at = now() where id = ${evtJob.id}`);
    await drain();
    expect(await runsOf(wf.id)).toHaveLength(1);
    // Other tenants' events never trigger it.
    const other = await contact(B, "Other");
    await fire(B, "contact.created", other.id);
    await drain();
    expect(await runsOf(wf.id)).toHaveLength(1);
    await setWorkflowStatus(T.ownerCtx, wf.id, "archived");
  });

  it("follows condition branches and respects trigger filters", async () => {
    const wf = await publish(T, "Branching", def(
      [
        { id: "t", type: "trigger", config: { kind: "event", event: "contact.tag_added", filters: [{ field: "contact.lifecycleStage", op: "neq", value: "churned" }] }, position: pos },
        { id: "c", type: "condition", config: { match: "all", rules: [{ field: "contact.lifecycleStage", op: "eq", value: "customer" }] }, position: pos },
        { id: "yes", type: "action", config: { action: "call_webhook", params: { mode: "ok" } }, position: pos },
        { id: "no", type: "action", config: { action: "update_contact_stage", params: { stage: "opportunity" } }, position: pos },
      ],
      [
        { id: "1", source: "t", target: "c" },
        { id: "2", source: "c", target: "yes", branch: "true" },
        { id: "3", source: "c", target: "no", branch: "false" },
      ],
    ));
    const customer = await contact(T, "Customer", { lifecycleStage: "customer" });
    const lead = await contact(T, "Lead", { lifecycleStage: "lead" });
    const churned = await contact(T, "Churned", { lifecycleStage: "churned" });
    calls.length = 0;
    for (const c of [customer, lead, churned]) await fire(T, "contact.tag_added", c.id, { tagId: "x" });
    await drain();
    expect(calls).toEqual(["ok:Customer"]);
    const [updated] = await db().select().from(schema.contacts).where(eq(schema.contacts.id, lead.id));
    expect(updated.lifecycleStage).toBe("opportunity");
    expect((await runsOf(wf.id)).map((r) => r.entityId).sort()).toEqual([customer.id, lead.id].sort());
    await setWorkflowStatus(T.ownerCtx, wf.id, "archived");
  });

  it("waits on delays and resumes when due", async () => {
    const wf = await publish(T, "Delay", def(
      [
        { id: "t", type: "trigger", config: { kind: "event", event: "contact.created", filters: [] }, position: pos },
        { id: "d", type: "delay", config: { amount: 2, unit: "hours" }, position: pos },
        { id: "a", type: "action", config: { action: "call_webhook", params: { mode: "ok" } }, position: pos },
      ],
      [
        { id: "1", source: "t", target: "d" },
        { id: "2", source: "d", target: "a" },
      ],
    ));
    calls.length = 0;
    const c = await contact(T, "Delayed");
    await fire(T, "contact.created", c.id);
    await drain();
    const [run] = await runsOf(wf.id);
    expect(run.status).toBe("waiting");
    expect(calls).toEqual([]);
    const [delayed] = await db().select().from(schema.jobs).where(and(eq(schema.jobs.type, "automation.step"), sql`payload->>'runId' = ${run.id}`, eq(schema.jobs.status, "queued")));
    expect(new Date(delayed.runAt).getTime()).toBeGreaterThan(Date.now() + 3600_000);
    await db().execute(sql`update public.jobs set run_at = now() where id = ${delayed.id}`);
    await drain();
    expect(calls).toEqual(["ok:Delayed"]);
    expect((await runsOf(wf.id))[0].status).toBe("completed");
    await setWorkflowStatus(T.ownerCtx, wf.id, "archived");
  });

  it("retries failing actions, then fails the run, dead-letters the job and notifies managers", async () => {
    const wf = await publish(T, "Failing", def(
      [
        { id: "t", type: "trigger", config: { kind: "event", event: "contact.created", filters: [] }, position: pos },
        { id: "a", type: "action", config: { action: "call_webhook", params: { mode: "fail" } }, position: pos },
      ],
      [{ id: "1", source: "t", target: "a" }],
    ));
    const c = await contact(T, "Failing");
    await fire(T, "contact.created", c.id);
    for (let i = 0; i < 4; i++) {
      await drain();
      await db().execute(sql`update public.jobs set run_at = now() where status = 'queued' and type = 'automation.step'`);
    }
    const [run] = await runsOf(wf.id);
    expect(run.status).toBe("failed");
    expect(run.error).toContain("500");
    const steps = await getRunSteps(T.ownerCtx, run.id);
    expect(steps.filter((s) => s.status === "failed")).toHaveLength(3);
    const [dead] = await db().select().from(schema.jobs).where(and(eq(schema.jobs.type, "automation.step"), sql`payload->>'runId' = ${run.id}`, eq(schema.jobs.status, "dead")));
    expect(dead).toBeDefined();
    const notes = await db().select().from(schema.notifications).where(and(eq(schema.notifications.tenantId, T.tenant.id), eq(schema.notifications.type, "automation_failed")));
    expect(notes.map((n) => n.userId).sort()).toEqual([T.owner.id, T.manager.id].sort());
    await setWorkflowStatus(T.ownerCtx, wf.id, "archived");
  });

  it("recovers from transient failures and supports manual retry", async () => {
    const wf = await publish(T, "Flaky", def(
      [
        { id: "t", type: "trigger", config: { kind: "event", event: "contact.created", filters: [] }, position: pos },
        { id: "a", type: "action", config: { action: "call_webhook", params: { mode: "flaky" } }, position: pos },
      ],
      [{ id: "1", source: "t", target: "a" }],
    ));
    calls.length = 0;
    flakyFailures = 0;
    const c = await contact(T, "Flaky");
    await fire(T, "contact.created", c.id);
    await drain();
    await db().execute(sql`update public.jobs set run_at = now() where status = 'queued' and type = 'automation.step'`);
    await drain();
    expect(calls).toEqual(["flaky:Flaky"]);
    expect((await runsOf(wf.id))[0].status).toBe("completed");
    await expectAppError(retryFailedRun(T.ownerCtx, (await runsOf(wf.id))[0].id), "VALIDATION");
    await setWorkflowStatus(T.ownerCtx, wf.id, "archived");
  });

  it("holds runs while paused and continues on resume", async () => {
    const wf = await publish(T, "Pausable", def(
      [
        { id: "t", type: "trigger", config: { kind: "event", event: "contact.created", filters: [] }, position: pos },
        { id: "a", type: "action", config: { action: "call_webhook", params: { mode: "ok" } }, position: pos },
      ],
      [{ id: "1", source: "t", target: "a" }],
    ));
    calls.length = 0;
    const c = await contact(T, "Paused");
    await fire(T, "contact.created", c.id);
    await drainJobs({ workerId: "auto-test", types: ["events.dispatch"] });
    await setWorkflowStatus(T.ownerCtx, wf.id, "paused");
    await drain();
    expect(calls).toEqual([]);
    expect((await runsOf(wf.id))[0].status).toBe("waiting");
    await setWorkflowStatus(T.ownerCtx, wf.id, "active");
    await db().execute(sql`update public.jobs set run_at = now() where status = 'queued' and type = 'automation.step'`);
    await drain();
    expect(calls).toEqual(["ok:Paused"]);
    await setWorkflowStatus(T.ownerCtx, wf.id, "archived");
  });

  it("prevents runaway loops via event depth and the per-entity daily cap", async () => {
    // contact.updated → update stage → emits contact.updated again…
    const wf = await publish(T, "Loop", def(
      [
        { id: "t", type: "trigger", config: { kind: "event", event: "contact.updated", filters: [] }, position: pos },
        { id: "c", type: "condition", config: { match: "all", rules: [{ field: "contact.lifecycleStage", op: "eq", value: "lead" }] }, position: pos },
        { id: "toOpp", type: "action", config: { action: "update_contact_stage", params: { stage: "opportunity" } }, position: pos },
        { id: "toLead", type: "action", config: { action: "update_contact_stage", params: { stage: "lead" } }, position: pos },
      ],
      [
        { id: "1", source: "t", target: "c" },
        { id: "2", source: "c", target: "toOpp", branch: "true" },
        { id: "3", source: "c", target: "toLead", branch: "false" },
      ],
    ));
    const c = await contact(T, "Looper", { lifecycleStage: "lead" });
    await fire(T, "contact.updated", c.id);
    for (let i = 0; i < 20; i++) await drain();
    const runs = await runsOf(wf.id);
    expect(runs.length).toBeGreaterThan(1);
    expect(runs.length).toBeLessThanOrEqual(7);
    expect(Math.max(...runs.map((r) => r.depth))).toBeLessThanOrEqual(5);
    await setWorkflowStatus(T.ownerCtx, wf.id, "archived");
  });
});

describe("publishing, permissions and triggers", () => {
  it("refuses to publish unavailable actions or beyond the plan limit, and agents cannot manage", async () => {
    const wf = await createWorkflow(T.ownerCtx, { name: "Bad" });
    await saveDraft(T.ownerCtx, wf.id, {
      definition: def(
        [
          { id: "t", type: "trigger", config: { kind: "event", event: "contact.created", filters: [] }, position: pos },
          { id: "a", type: "action", config: { action: "send_whatsapp_template", params: {} }, position: pos },
        ],
        [{ id: "1", source: "t", target: "a" }],
      ),
    });
    await expectAppError(publishWorkflow(T.ownerCtx, wf.id), "VALIDATION");
    await expectAppError(createWorkflow(T.agentCtx, { name: "x" }), "FORBIDDEN");
    await expectAppError(listWorkflows(T.agentCtx), "FORBIDDEN");

    const free = await createTeam("Free automation");
    await db().update(schema.subscriptions).set({ planId: "free" }).where(eq(schema.subscriptions.tenantId, free.tenant.id));
    await expectAppError(createWorkflow(free.ownerCtx, { name: "x" }), "PLAN_REQUIRED");
  });

  it("computes schedule slots in the tenant time zone", () => {
    // 2026-10-19T06:30Z is 09:30 in Jerusalem (UTC+3) → next daily 09:00 slot is tomorrow 06:00Z.
    expect(nextSlot(new Date("2026-10-19T06:30:00Z"), { frequency: "daily", hour: 9, weekday: 0 }, "Asia/Jerusalem").toISOString()).toBe("2026-10-20T06:00:00.000Z");
    // After DST ends (Oct 25, 2026 → UTC+2): 09:00 local = 07:00Z.
    expect(nextSlot(new Date("2026-10-25T08:00:00Z"), { frequency: "daily", hour: 9, weekday: 0 }, "Asia/Jerusalem").toISOString()).toBe("2026-10-26T07:00:00.000Z");
    expect(nextSlot(new Date("2026-10-19T06:30:00Z"), { frequency: "hourly", hour: 0, weekday: 0 }, "Asia/Jerusalem").toISOString()).toBe("2026-10-19T07:00:00.000Z");
  });

  it("runs scheduled workflows once per slot for segment members", async () => {
    const team = await createTeam("Schedule Co");
    const wf = await publish(team, "Weekly", def(
      [
        { id: "t", type: "trigger", config: { kind: "schedule", frequency: "weekly", hour: 9, weekday: 0, segment: [{ field: "contact.lifecycleStage", op: "eq", value: "customer" }] }, position: pos },
        { id: "a", type: "action", config: { action: "call_webhook", params: { mode: "ok" } }, position: pos },
      ],
      [{ id: "1", source: "t", target: "a" }],
    ));
    await contact(team, "Buyer", { lifecycleStage: "customer" });
    await contact(team, "Prospect", { lifecycleStage: "lead" });
    await db().update(schema.automationWorkflows).set({ nextScheduledAt: new Date(Date.now() - 60_000) }).where(eq(schema.automationWorkflows.id, wf.id));
    calls.length = 0;
    expect(await runDueSchedules()).toBe(1);
    expect(await runDueSchedules()).toBe(0);
    await drain();
    expect(calls).toEqual(["ok:Buyer"]);
  });

  it("starts webhook runs idempotently and matches contacts by email", async () => {
    const wf = await publish(T, "Hook", def(
      [
        { id: "t", type: "trigger", config: { kind: "webhook" }, position: pos },
        { id: "a", type: "action", config: { action: "call_webhook", params: { mode: "ok" } }, position: pos },
      ],
      [{ id: "1", source: "t", target: "a" }],
    ));
    expect(wf.webhookToken).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    await contact(T, "Hooked", { email: "hooked@x.test" });
    const [row] = await db().select().from(schema.automationWorkflows).where(eq(schema.automationWorkflows.id, wf.id));
    const first = await startWebhookRun(row, { email: "HOOKED@x.test" }, "key-1");
    const second = await startWebhookRun(row, { email: "hooked@x.test" }, "key-1");
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    calls.length = 0;
    await drain();
    expect(calls).toEqual(["ok:Hooked"]);
    const { rows } = await listRuns(T.ownerCtx, wf.id);
    expect(rows).toHaveLength(1);
  });
});

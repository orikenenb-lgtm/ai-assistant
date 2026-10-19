import { and, eq, isNull, lte, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, schema } from "@/server/db";
import { systemCtx } from "@/server/context";
import { subscribeToEvents, type DomainEvent } from "@/server/events";
import { enqueueJob } from "@/server/jobs/queue";
import { PermanentJobError, RetryJobLater, registerJobHandler, type Job } from "@/server/jobs/runner";
import { registerSchedule } from "@/server/jobs/scheduler";
import { errorFields, logger } from "@/server/logger";
import { isAppError, type ErrorCode } from "@/server/errors";
import { isTenantLive } from "@/server/rbac/membership";
import { notify } from "@/modules/notifications/service";
import { recordUsage } from "@/modules/billing/entitlements";
import { definitionSchema, nextNodes, triggerOf, type WorkflowDefinition } from "./definition";
import { evaluateRules } from "./rules";
import { buildRunContext, type RunSeed } from "./run-context";
import { getAutomationAction } from "./actions-registry";
import "./integrations";

export const MAX_STEPS_PER_RUN = 50;
export const STEP_MAX_ATTEMPTS = 3;
const PAUSED_RECHECK_MS = 10 * 60_000;
const PERMANENT_CODES = new Set<ErrorCode>(["FORBIDDEN", "NOT_FOUND", "VALIDATION", "PRECONDITION", "PLAN_REQUIRED", "QUOTA_EXCEEDED", "READ_ONLY"]);

type WorkflowRow = typeof schema.automationWorkflows.$inferSelect;

async function publishedDefinition(workflowId: string, version: number): Promise<WorkflowDefinition> {
  const [v] = await db()
    .select()
    .from(schema.automationWorkflowVersions)
    .where(and(eq(schema.automationWorkflowVersions.workflowId, workflowId), eq(schema.automationWorkflowVersions.version, version)));
  if (!v) throw new PermanentJobError("workflow version missing");
  return definitionSchema.parse(v.definition);
}

/**
 * Creates a run (idempotent on (workflow, trigger_key)) and schedules the first
 * node after the trigger. Returns the run id, or null when deduplicated/skipped.
 */
export async function startRun(
  wf: WorkflowRow,
  input: { triggerKey: string; seed: RunSeed; depth: number; ignoreDailyCap?: boolean },
): Promise<string | null> {
  if (!wf.publishedVersion) return null;
  if (!(await isTenantLive(wf.tenantId))) return null;
  const def = await publishedDefinition(wf.id, wf.publishedVersion);
  if (input.seed.entityId && !input.ignoreDailyCap) {
    const [{ n }] = await db().execute<{ n: number }>(sql`
      select count(*)::int as n from public.automation_runs
      where workflow_id = ${wf.id} and entity_id = ${input.seed.entityId} and started_at > now() - interval '1 day'`);
    if (Number(n) >= wf.maxRunsPerEntityPerDay) {
      logger().warn({ workflowId: wf.id, entityId: input.seed.entityId }, "automation run skipped: per-entity daily cap reached");
      return null;
    }
  }
  const first = nextNodes(def, triggerOf(def).id);
  return db().transaction(async (tx) => {
    const [run] = await tx
      .insert(schema.automationRuns)
      .values({
        tenantId: wf.tenantId,
        workflowId: wf.id,
        workflowVersion: wf.publishedVersion!,
        triggerKey: input.triggerKey.slice(0, 300),
        triggerEvent: (input.seed.event ?? { payload: input.seed.payload ?? null }) as Record<string, unknown>,
        entityType: input.seed.entityType,
        entityId: input.seed.entityId,
        status: first.length ? "pending" : "completed",
        depth: Math.min(input.depth, 10),
        context: { seed: input.seed } as unknown as Record<string, unknown>,
        finishedAt: first.length ? null : new Date(),
      })
      .onConflictDoNothing({ target: [schema.automationRuns.workflowId, schema.automationRuns.triggerKey] })
      .returning({ id: schema.automationRuns.id });
    if (!run) return null;
    for (const nodeId of first) {
      await enqueueJob(tx, {
        tenantId: wf.tenantId,
        type: "automation.step",
        payload: { runId: run.id, nodeId },
        idempotencyKey: `auto:${run.id}:${nodeId}:0`,
        maxAttempts: STEP_MAX_ATTEMPTS,
      });
    }
    await recordUsage(tx, { tenantId: wf.tenantId, metric: "automation_runs", quantity: 1, refType: "automation_run", refId: run.id });
    return run.id;
  });
}

/* --------------------------------------------------------- event trigger */

function seedFromEvent(event: DomainEvent): RunSeed {
  return { entityType: event.entityType, entityId: event.entityId, event: event as unknown as Record<string, unknown> };
}

export async function handleEventForAutomations(event: DomainEvent) {
  const workflows = await db()
    .select()
    .from(schema.automationWorkflows)
    .where(
      and(
        eq(schema.automationWorkflows.tenantId, event.tenantId),
        eq(schema.automationWorkflows.status, "active"),
        eq(schema.automationWorkflows.triggerType, `event:${event.type}`),
      ),
    );
  for (const wf of workflows) {
    try {
      const def = await publishedDefinition(wf.id, wf.publishedVersion!);
      const trigger = triggerOf(def).config;
      if (trigger.kind !== "event") continue;
      const seed = seedFromEvent(event);
      if (trigger.filters.length) {
        const ctx = await buildRunContext(event.tenantId, seed);
        if (!evaluateRules(trigger.filters, ctx.data)) continue;
      }
      await startRun(wf, { triggerKey: `evt:${event.id}`, seed, depth: event.depth });
    } catch (e) {
      // One broken workflow must not block the others.
      logger().error({ workflowId: wf.id, eventType: event.type, ...errorFields(e) }, "automation trigger failed");
    }
  }
}

subscribeToEvents({ name: "automation", handle: handleEventForAutomations });

/* ------------------------------------------------------------- step job */

async function failRun(runId: string, tenantId: string, workflow: WorkflowRow | undefined, error: string) {
  await db()
    .update(schema.automationRuns)
    .set({ status: "failed", error: error.slice(0, 1000), finishedAt: new Date() })
    .where(eq(schema.automationRuns.id, runId));
  // Tell owners/managers so failures are never silent.
  const recipients = await db()
    .select({ userId: schema.memberships.userId })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.tenantId, tenantId), eq(schema.memberships.status, "active"), sql`${schema.memberships.role} in ('owner', 'manager')`));
  for (const r of recipients) {
    await notify(db(), {
      tenantId,
      userId: r.userId,
      type: "automation_failed",
      title: { he: `אוטומציה נכשלה: ${workflow?.name ?? ""}`, en: `Automation failed: ${workflow?.name ?? ""}` },
      body: error.slice(0, 300),
      link: workflow ? `/automations/${workflow.id}/runs` : "/automations",
    });
  }
}

async function runStep(job: Job) {
  const { runId, nodeId, delayed } = job.payload as { runId?: string; nodeId?: string; delayed?: boolean };
  if (!runId || !nodeId) throw new PermanentJobError("invalid step payload");
  const [run] = await db().select().from(schema.automationRuns).where(eq(schema.automationRuns.id, runId));
  if (!run || (job.tenantId && run.tenantId !== job.tenantId) || ["completed", "failed", "canceled", "skipped"].includes(run.status)) return;
  const [wf] = await db().select().from(schema.automationWorkflows).where(eq(schema.automationWorkflows.id, run.workflowId));
  if (!wf || wf.status === "archived") {
    await db().update(schema.automationRuns).set({ status: "canceled", finishedAt: new Date() }).where(eq(schema.automationRuns.id, runId));
    return;
  }
  if (wf.status === "paused") {
    await db().update(schema.automationRuns).set({ status: "waiting", currentNodeId: nodeId }).where(eq(schema.automationRuns.id, runId));
    throw new RetryJobLater(new Date(Date.now() + PAUSED_RECHECK_MS), "workflow paused");
  }
  if (run.stepsExecuted >= MAX_STEPS_PER_RUN) {
    await failRun(runId, run.tenantId, wf, `execution limit of ${MAX_STEPS_PER_RUN} steps reached`);
    return;
  }

  const def = await publishedDefinition(run.workflowId, run.workflowVersion);
  const node = def.nodes.find((n) => n.id === nodeId);
  if (!node) {
    await failRun(runId, run.tenantId, wf, `node ${nodeId} not found`);
    return;
  }
  const seed = (run.context as { seed?: RunSeed }).seed ?? { entityType: run.entityType, entityId: run.entityId };
  await db().update(schema.automationRuns).set({ status: "running", currentNodeId: nodeId }).where(eq(schema.automationRuns.id, runId));
  const [step] = await db()
    .insert(schema.automationRunSteps)
    .values({ tenantId: run.tenantId, runId, nodeId, nodeType: node.type, status: "running", attempt: job.attempts })
    .returning({ id: schema.automationRunSteps.id });

  try {
    let next: string[] = [];
    let output: Record<string, unknown> = {};
    if (node.type === "condition") {
      const ctx = await buildRunContext(run.tenantId, seed);
      const result = evaluateRules(node.config.rules, ctx.data, node.config.match);
      output = { result };
      next = nextNodes(def, node.id, result);
    } else if (node.type === "delay") {
      if (!delayed) {
        const ms = node.config.amount * { minutes: 60_000, hours: 3_600_000, days: 86_400_000 }[node.config.unit];
        const resumeAt = new Date(Date.now() + ms);
        await db().update(schema.automationRunSteps).set({ status: "waiting", output: { resumeAt: resumeAt.toISOString() }, finishedAt: new Date() }).where(eq(schema.automationRunSteps.id, step.id));
        await db().update(schema.automationRuns).set({ status: "waiting" }).where(eq(schema.automationRuns.id, runId));
        await enqueueJob(db(), {
          tenantId: run.tenantId,
          type: "automation.step",
          payload: { runId, nodeId, delayed: true },
          runAt: resumeAt,
          idempotencyKey: `auto:${runId}:${nodeId}:delay:${run.stepsExecuted}`,
          maxAttempts: STEP_MAX_ATTEMPTS,
        });
        return;
      }
      next = nextNodes(def, node.id);
    } else if (node.type === "action") {
      const action = getAutomationAction(node.config.action);
      if (!action) throw new PermanentJobError(`action "${node.config.action}" is not available`);
      const params = action.params.safeParse(node.config.params);
      if (!params.success) throw new PermanentJobError(`invalid parameters for ${node.config.action}`);
      const ctx = await buildRunContext(run.tenantId, seed);
      const actorCtx = systemCtx(run.tenantId, { actorType: "automation", eventDepth: run.depth + 1 });
      output = await action.run(actorCtx, params.data, ctx, { runId: run.id, nodeId: node.id, idempotencyKey: `auto:${run.id}:${node.id}` });
      next = nextNodes(def, node.id);
    } else {
      next = nextNodes(def, node.id);
    }

    await db().update(schema.automationRunSteps).set({ status: "succeeded", output, finishedAt: new Date() }).where(eq(schema.automationRunSteps.id, step.id));
    const steps = run.stepsExecuted + 1;
    await db().transaction(async (tx) => {
      if (!next.length) {
        await tx.update(schema.automationRuns).set({ status: "completed", stepsExecuted: steps, finishedAt: new Date() }).where(eq(schema.automationRuns.id, runId));
        return;
      }
      await tx.update(schema.automationRuns).set({ status: "pending", stepsExecuted: steps }).where(eq(schema.automationRuns.id, runId));
      for (const n of next) {
        await enqueueJob(tx, {
          tenantId: run.tenantId,
          type: "automation.step",
          payload: { runId, nodeId: n },
          idempotencyKey: `auto:${runId}:${n}:${steps}`,
          maxAttempts: STEP_MAX_ATTEMPTS,
        });
      }
    });
  } catch (e) {
    if (e instanceof RetryJobLater) throw e;
    const message = e instanceof Error ? e.message : String(e);
    await db().update(schema.automationRunSteps).set({ status: "failed", error: message.slice(0, 1000), finishedAt: new Date() }).where(eq(schema.automationRunSteps.id, step.id));
    // Business-rule refusals (opted out, closed window, missing record…) will not change on retry.
    const final = e instanceof PermanentJobError || (isAppError(e) && PERMANENT_CODES.has(e.code)) || job.attempts >= job.maxAttempts;
    if (final) {
      await failRun(runId, run.tenantId, wf, message);
      throw e instanceof PermanentJobError ? e : new PermanentJobError(message);
    }
    await db().update(schema.automationRuns).set({ status: "pending", error: message.slice(0, 1000) }).where(eq(schema.automationRuns.id, runId));
    throw e;
  }
}

registerJobHandler("automation.step", runStep);

/* ------------------------------------------------------------ schedules */

/** Next schedule slot strictly after `after`, evaluated in the tenant time zone. */
export function nextSlot(after: Date, cfg: { frequency: "hourly" | "daily" | "weekly"; hour: number; weekday: number }, timeZone: string): Date {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "numeric", weekday: "short", hourCycle: "h23" });
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  let t = Math.floor(after.getTime() / 900_000) * 900_000 + 900_000; // next quarter hour
  for (let i = 0; i < 8 * 96; i++, t += 900_000) {
    const parts = Object.fromEntries(fmt.formatToParts(new Date(t)).map((p) => [p.type, p.value]));
    if (Number(parts.minute) !== 0) continue;
    if (cfg.frequency === "hourly") return new Date(t);
    if (Number(parts.hour) !== cfg.hour) continue;
    if (cfg.frequency === "daily" || days.indexOf(parts.weekday) === cfg.weekday) return new Date(t);
  }
  return new Date(after.getTime() + 86_400_000);
}

const SEGMENT_BATCH = 1000;

export async function runDueSchedules(now = new Date()) {
  const due = await db()
    .select({ wf: schema.automationWorkflows, timezone: schema.tenants.timezone })
    .from(schema.automationWorkflows)
    .innerJoin(schema.tenants, eq(schema.tenants.id, schema.automationWorkflows.tenantId))
    .where(
      and(
        eq(schema.automationWorkflows.status, "active"),
        eq(schema.automationWorkflows.triggerType, "schedule"),
        lte(schema.automationWorkflows.nextScheduledAt, now),
        eq(schema.tenants.status, "active"),
        isNull(schema.tenants.deletedAt),
      ),
    );
  let started = 0;
  for (const { wf, timezone } of due) {
    // One broken workflow or tenant setting must not stop the others' schedules.
    try {
      started += await runScheduledWorkflow(wf, timezone, now);
    } catch (e) {
      logger().error({ workflowId: wf.id, ...errorFields(e) }, "automation schedule failed");
    }
  }
  return started;
}

async function runScheduledWorkflow(wf: WorkflowRow, timezone: string, now: Date): Promise<number> {
  let started = 0;
  const def = await publishedDefinition(wf.id, wf.publishedVersion!);
  const trigger = triggerOf(def).config;
  if (trigger.kind !== "schedule") return 0;
  const slot = wf.nextScheduledAt!.toISOString();
  const contacts = await db()
    .select({ id: schema.contacts.id })
    .from(schema.contacts)
    .where(and(eq(schema.contacts.tenantId, wf.tenantId), isNull(schema.contacts.deletedAt)))
    .limit(SEGMENT_BATCH);
  for (const c of contacts) {
    const seed: RunSeed = { entityType: "contact", entityId: c.id, payload: { scheduledAt: slot } };
    if (trigger.segment.length) {
      const ctx = await buildRunContext(wf.tenantId, seed);
      if (!evaluateRules(trigger.segment, ctx.data)) continue;
    }
    if (await startRun(wf, { triggerKey: `sched:${slot}:${c.id}`, seed, depth: 0 })) started++;
  }
  await db()
    .update(schema.automationWorkflows)
    .set({ nextScheduledAt: nextSlot(now, trigger, timezone) })
    .where(eq(schema.automationWorkflows.id, wf.id));
  return started;
}

registerJobHandler("automation.schedules", async () => {
  await runDueSchedules();
});
registerSchedule({ name: "automation.schedules", everyMinutes: 15, job: { tenantId: null, type: "automation.schedules" } });

/* ------------------------------------------------------ webhook / manual */

/** Starts a run from an inbound webhook payload (idempotent on the key). */
export async function startWebhookRun(wf: WorkflowRow, payload: unknown, idempotencyKey: string) {
  let entityId: string | null = null;
  const p = (payload ?? {}) as Record<string, unknown>;
  if (typeof p.email === "string" || typeof p.phone === "string") {
    const [c] = await db()
      .select({ id: schema.contacts.id })
      .from(schema.contacts)
      .where(
        and(
          eq(schema.contacts.tenantId, wf.tenantId),
          isNull(schema.contacts.deletedAt),
          typeof p.email === "string" ? sql`lower(${schema.contacts.email}) = lower(${p.email})` : eq(schema.contacts.phone, String(p.phone)),
        ),
      )
      .limit(1);
    entityId = c?.id ?? null;
  }
  return startRun(wf, { triggerKey: `hook:${idempotencyKey}`, seed: { entityType: entityId ? "contact" : null, entityId, payload }, depth: 0 });
}

export async function startManualRun(wf: WorkflowRow, contactId: string) {
  return startRun(wf, { triggerKey: `manual:${randomUUID()}`, seed: { entityType: "contact", entityId: contactId, payload: { manual: true } }, depth: 0, ignoreDailyCap: true });
}

/** Re-queues a failed run from the node that failed. */
export async function retryRun(tenantId: string, runId: string) {
  const [run] = await db()
    .select()
    .from(schema.automationRuns)
    .where(and(eq(schema.automationRuns.id, runId), eq(schema.automationRuns.tenantId, tenantId), eq(schema.automationRuns.status, "failed")));
  if (!run?.currentNodeId) return false;
  await db().transaction(async (tx) => {
    await tx.update(schema.automationRuns).set({ status: "pending", error: null, finishedAt: null }).where(eq(schema.automationRuns.id, runId));
    await enqueueJob(tx, {
      tenantId,
      type: "automation.step",
      payload: { runId, nodeId: run.currentNodeId! },
      idempotencyKey: `auto:${runId}:${run.currentNodeId}:retry:${randomUUID()}`,
      maxAttempts: STEP_MAX_ATTEMPTS,
    });
  });
  return true;
}


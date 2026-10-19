import { and, count, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { db, schema, type Tx } from "@/server/db";
import { assertCan, assertCanWrite, type ServiceCtx } from "@/server/context";
import { audit } from "@/server/audit";
import { AppError } from "@/server/errors";
import { randomToken, sha256Hex } from "@/server/crypto";
import { assertFeature, getEntitlements } from "@/modules/billing/entitlements";
import { definitionSchema, segmentRulesSchema, triggerOf, triggerType, type WorkflowDefinition } from "./definition";
import { availableActionTypes, getAutomationAction } from "./actions-registry";
import "./integrations";
import { nextSlot, retryRun, startManualRun } from "./engine";
import { WORKFLOW_TEMPLATES } from "./templates";
import { evaluateRules } from "./rules";
import { buildRunContext } from "./run-context";

export type WorkflowSummary = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  triggerType: string;
  publishedVersion: number | null;
  updatedAt: Date;
  runs7d: number;
  failed7d: number;
  lastRunAt: Date | null;
};

export async function listWorkflows(ctx: ServiceCtx): Promise<WorkflowSummary[]> {
  assertCan(ctx, "automation.view");
  return ctx.run(async (tx) => {
    const rows = await tx
      .select()
      .from(schema.automationWorkflows)
      .where(and(eq(schema.automationWorkflows.tenantId, ctx.tenantId), ne(schema.automationWorkflows.status, "archived")))
      .orderBy(desc(schema.automationWorkflows.updatedAt));
    const ids = rows.map((r) => r.id);
    const stats = ids.length
      ? await tx.execute<{ workflow_id: string; runs: number; failed: number; last: Date | null }>(sql`
          select workflow_id, count(*)::int as runs, count(*) filter (where status = 'failed')::int as failed, max(started_at) as last
          from public.automation_runs where tenant_id = ${ctx.tenantId} and started_at > now() - interval '7 days'
          group by workflow_id`)
      : [];
    const byId = new Map(stats.map((s) => [s.workflow_id, s]));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      status: r.status,
      triggerType: r.triggerType,
      publishedVersion: r.publishedVersion,
      updatedAt: r.updatedAt,
      runs7d: byId.get(r.id)?.runs ?? 0,
      failed7d: byId.get(r.id)?.failed ?? 0,
      lastRunAt: byId.get(r.id)?.last ? new Date(byId.get(r.id)!.last!) : null,
    }));
  });
}

async function loadWorkflow(ctx: ServiceCtx, id: string) {
  const [wf] = await ctx.run((tx) =>
    tx
      .select()
      .from(schema.automationWorkflows)
      .where(and(eq(schema.automationWorkflows.id, id), eq(schema.automationWorkflows.tenantId, ctx.tenantId))),
  );
  if (!wf) throw new AppError("NOT_FOUND", "errors.notFound");
  return wf;
}

export async function getWorkflow(ctx: ServiceCtx, id: string) {
  assertCan(ctx, "automation.view");
  const wf = await loadWorkflow(ctx, id);
  return { ...wf, definition: wf.definition as WorkflowDefinition, availableActions: availableActionTypes() };
}

export async function createWorkflow(ctx: ServiceCtx, input: { name: string; templateKey?: string }) {
  assertCanWrite(ctx, "automation.manage");
  const template = WORKFLOW_TEMPLATES.find((t) => t.key === (input.templateKey ?? "blank")) ?? WORKFLOW_TEMPLATES[0];
  return ctx.run(async (tx) => {
    assertFeature(await getEntitlements(tx, ctx.tenantId), "automation");
    const [wf] = await tx
      .insert(schema.automationWorkflows)
      .values({
        tenantId: ctx.tenantId,
        name: input.name,
        description: template.key === "blank" ? null : template.description.he,
        status: "draft",
        triggerType: triggerType(template.definition),
        definition: template.definition,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning();
    await audit(tx, ctx, { action: "automation.created", entityType: "automation_workflow", entityId: wf.id, metadata: { template: template.key } });
    return wf;
  });
}

/** Saves the working draft. Structural validation runs here; action availability on publish. */
export async function saveDraft(ctx: ServiceCtx, id: string, input: { name?: string; description?: string | null; definition: unknown; maxRunsPerEntityPerDay?: number }) {
  assertCanWrite(ctx, "automation.manage");
  const def = definitionSchema.parse(input.definition);
  await loadWorkflow(ctx, id);
  await ctx.run(async (tx) => {
    await tx
      .update(schema.automationWorkflows)
      .set({
        definition: def,
        ...(input.name ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.maxRunsPerEntityPerDay ? { maxRunsPerEntityPerDay: input.maxRunsPerEntityPerDay } : {}),
        updatedBy: ctx.userId,
      })
      .where(and(eq(schema.automationWorkflows.id, id), eq(schema.automationWorkflows.tenantId, ctx.tenantId)));
    await audit(tx, ctx, { action: "automation.draft_saved", entityType: "automation_workflow", entityId: id });
  });
}

/**
 * Users, tags and stages referenced by action parameters must belong to this
 * tenant (automations run with system privileges, so this is checked up front).
 */
async function assertReferencesBelong(tx: Tx, tenantId: string, def: WorkflowDefinition) {
  const users = new Set<string>();
  const tags = new Set<string>();
  const stages = new Set<string>();
  for (const n of def.nodes) {
    if (n.type !== "action") continue;
    const p = n.config.params as Record<string, unknown>;
    if (typeof p.userId === "string") users.add(p.userId);
    if (typeof p.tagId === "string") tags.add(p.tagId);
    if (typeof p.stageId === "string") stages.add(p.stageId);
  }
  const missing = async (ids: Set<string>, query: (list: string[]) => Promise<{ id: string }[]>) => {
    if (!ids.size) return false;
    const found = new Set((await query([...ids])).map((r) => r.id));
    return [...ids].some((id) => !found.has(id));
  };
  const bad =
    (await missing(users, (l) =>
      tx
        .select({ id: schema.memberships.userId })
        .from(schema.memberships)
        .where(and(eq(schema.memberships.tenantId, tenantId), eq(schema.memberships.status, "active"), inArray(schema.memberships.userId, l))),
    )) ||
    (await missing(tags, (l) => tx.select({ id: schema.tags.id }).from(schema.tags).where(and(eq(schema.tags.tenantId, tenantId), inArray(schema.tags.id, l))))) ||
    (await missing(stages, (l) =>
      tx.select({ id: schema.pipelineStages.id }).from(schema.pipelineStages).where(and(eq(schema.pipelineStages.tenantId, tenantId), inArray(schema.pipelineStages.id, l))),
    ));
  if (bad) throw new AppError("VALIDATION", "automation.publishInvalid", { definition: ["automation.unknownReference"] });
}

/** Validates, snapshots a new version and activates it. Returns a webhook token once, when relevant. */
export async function publishWorkflow(ctx: ServiceCtx, id: string): Promise<{ version: number; webhookToken: string | null }> {
  assertCanWrite(ctx, "automation.manage");
  const wf = await loadWorkflow(ctx, id);
  const def = definitionSchema.parse(wf.definition);
  const problems: string[] = [];
  for (const n of def.nodes) {
    if (n.type !== "action") continue;
    const action = getAutomationAction(n.config.action);
    if (!action) problems.push(`automation.actionUnavailable:${n.config.action}`);
    else if (!action.params.safeParse(n.config.params).success) problems.push(`automation.invalidParams:${n.id}`);
  }
  if (problems.length) throw new AppError("VALIDATION", "automation.publishInvalid", { definition: problems });
  const trigger = triggerOf(def).config;

  return ctx.run(async (tx) => {
    const ent = await getEntitlements(tx, ctx.tenantId);
    assertFeature(ent, "automation");
    await assertReferencesBelong(tx, ctx.tenantId, def);
    if (wf.status !== "active" && ent.limits.max_workflows !== undefined) {
      const [{ n }] = await tx
        .select({ n: count() })
        .from(schema.automationWorkflows)
        .where(and(eq(schema.automationWorkflows.tenantId, ctx.tenantId), inArray(schema.automationWorkflows.status, ["active", "paused"]), ne(schema.automationWorkflows.id, id)));
      if (n + 1 > ent.limits.max_workflows) throw new AppError("QUOTA_EXCEEDED", "errors.quotaExceeded", undefined, { limit: ent.limits.max_workflows });
    }
    const version = (wf.publishedVersion ?? 0) + 1;
    await tx.insert(schema.automationWorkflowVersions).values({ tenantId: ctx.tenantId, workflowId: id, version, definition: def, publishedBy: ctx.userId });
    let webhookToken: string | null = null;
    let webhookTokenHash = wf.webhookTokenHash;
    if (trigger.kind === "webhook" && !webhookTokenHash) {
      webhookToken = randomToken(24);
      webhookTokenHash = sha256Hex(webhookToken);
    }
    const [tenant] = await tx.select({ timezone: schema.tenants.timezone }).from(schema.tenants).where(eq(schema.tenants.id, ctx.tenantId));
    await tx
      .update(schema.automationWorkflows)
      .set({
        status: "active",
        publishedVersion: version,
        triggerType: triggerType(def),
        webhookTokenHash: trigger.kind === "webhook" ? webhookTokenHash : null,
        nextScheduledAt: trigger.kind === "schedule" ? nextSlot(new Date(), trigger, tenant?.timezone ?? "Asia/Jerusalem") : null,
        updatedBy: ctx.userId,
      })
      .where(eq(schema.automationWorkflows.id, id));
    await audit(tx, ctx, { action: "automation.published", entityType: "automation_workflow", entityId: id, metadata: { version } });
    return { version, webhookToken };
  });
}

export async function setWorkflowStatus(ctx: ServiceCtx, id: string, status: "paused" | "active" | "archived") {
  assertCanWrite(ctx, "automation.manage");
  const wf = await loadWorkflow(ctx, id);
  if (status === "active" && !wf.publishedVersion) throw new AppError("VALIDATION", "automation.notPublished");
  await ctx.run(async (tx) => {
    await tx.update(schema.automationWorkflows).set({ status, updatedBy: ctx.userId }).where(eq(schema.automationWorkflows.id, id));
    await audit(tx, ctx, { action: `automation.${status === "active" ? "resumed" : status}`, entityType: "automation_workflow", entityId: id });
  });
  if (status === "archived") {
    // Run history is engine-owned (read-only for app users): cancel in-flight runs as the system.
    await db()
      .update(schema.automationRuns)
      .set({ status: "canceled", finishedAt: new Date() })
      .where(and(eq(schema.automationRuns.tenantId, ctx.tenantId), eq(schema.automationRuns.workflowId, id), inArray(schema.automationRuns.status, ["pending", "running", "waiting"])));
  }
}

/** Rotates the inbound webhook token (shown once). */
export async function rotateWebhookToken(ctx: ServiceCtx, id: string) {
  assertCanWrite(ctx, "automation.manage");
  await loadWorkflow(ctx, id);
  const token = randomToken(24);
  await ctx.run(async (tx) => {
    await tx.update(schema.automationWorkflows).set({ webhookTokenHash: sha256Hex(token) }).where(eq(schema.automationWorkflows.id, id));
    await audit(tx, ctx, { action: "automation.webhook_rotated", entityType: "automation_workflow", entityId: id });
  });
  return token;
}

export async function runManually(ctx: ServiceCtx, id: string, contactId: string) {
  assertCanWrite(ctx, "automation.manage");
  const wf = await loadWorkflow(ctx, id);
  if (wf.status !== "active") throw new AppError("VALIDATION", "automation.notActive");
  const [contact] = await ctx.run((tx) =>
    tx
      .select({ id: schema.contacts.id })
      .from(schema.contacts)
      .where(and(eq(schema.contacts.id, contactId), eq(schema.contacts.tenantId, ctx.tenantId), isNull(schema.contacts.deletedAt))),
  );
  if (!contact) throw new AppError("NOT_FOUND", "errors.notFound");
  const runId = await startManualRun(wf, contactId);
  await ctx.run((tx) => audit(tx, ctx, { action: "automation.manual_run", entityType: "automation_workflow", entityId: id, metadata: { contactId, runId } }));
  return runId;
}

/** Live preview for segment rules: how many contacts match (first 1000 scanned). */
export async function previewSegment(ctx: ServiceCtx, rules: unknown) {
  assertCan(ctx, "automation.view");
  const parsed = segmentRulesSchema.parse(rules);
  const contacts = await ctx.run((tx) =>
    tx
      .select({ id: schema.contacts.id })
      .from(schema.contacts)
      .where(and(eq(schema.contacts.tenantId, ctx.tenantId), isNull(schema.contacts.deletedAt)))
      .limit(1000),
  );
  let matches = 0;
  for (const c of contacts) {
    const run = await buildRunContext(ctx.tenantId, { entityType: "contact", entityId: c.id });
    if (evaluateRules(parsed, run.data)) matches++;
  }
  return { matches, scanned: contacts.length };
}

export async function listRuns(ctx: ServiceCtx, workflowId: string, opts: { status?: string; page?: number } = {}) {
  assertCan(ctx, "automation.view");
  const page = Math.max(1, opts.page ?? 1);
  return ctx.run(async (tx) => {
    const where = and(
      eq(schema.automationRuns.tenantId, ctx.tenantId),
      eq(schema.automationRuns.workflowId, workflowId),
      opts.status ? eq(schema.automationRuns.status, opts.status) : undefined,
    );
    const [{ total }] = await tx.select({ total: count() }).from(schema.automationRuns).where(where);
    const rows = await tx.select().from(schema.automationRuns).where(where).orderBy(desc(schema.automationRuns.startedAt)).limit(25).offset((page - 1) * 25);
    return { rows, total, page };
  });
}

export async function getRunSteps(ctx: ServiceCtx, runId: string) {
  assertCan(ctx, "automation.view");
  return ctx.run((tx) =>
    tx
      .select()
      .from(schema.automationRunSteps)
      .where(and(eq(schema.automationRunSteps.tenantId, ctx.tenantId), eq(schema.automationRunSteps.runId, runId)))
      .orderBy(schema.automationRunSteps.id),
  );
}

export async function retryFailedRun(ctx: ServiceCtx, runId: string) {
  assertCanWrite(ctx, "automation.manage");
  if (!(await retryRun(ctx.tenantId, runId))) throw new AppError("VALIDATION", "automation.cannotRetry");
  await ctx.run((tx) => audit(tx, ctx, { action: "automation.run_retried", entityType: "automation_run", entityId: runId }));
}

export async function cancelRun(ctx: ServiceCtx, runId: string) {
  assertCanWrite(ctx, "automation.manage");
  const rows = await db()
    .update(schema.automationRuns)
    .set({ status: "canceled", finishedAt: new Date() })
    .where(and(eq(schema.automationRuns.id, runId), eq(schema.automationRuns.tenantId, ctx.tenantId), inArray(schema.automationRuns.status, ["pending", "running", "waiting"])))
    .returning();
  if (!rows.length) throw new AppError("VALIDATION", "automation.cannotCancel");
  await ctx.run((tx) => audit(tx, ctx, { action: "automation.run_canceled", entityType: "automation_run", entityId: runId }));
}

/** Lookups the builder needs to render friendly pickers (members, tags, pipeline stages). */
export async function builderLookups(ctx: ServiceCtx) {
  assertCan(ctx, "automation.view");
  return ctx.run(async (tx) => {
    const [members, tags, stages] = await Promise.all([
      tx.execute<{ userId: string; fullName: string }>(sql`
        select m.user_id as "userId", coalesce(nullif(p.full_name, ''), p.email) as "fullName"
        from public.memberships m join public.profiles p on p.id = m.user_id
        where m.tenant_id = ${ctx.tenantId} and m.status = 'active' order by 2`),
      tx.select({ id: schema.tags.id, name: schema.tags.name }).from(schema.tags).where(eq(schema.tags.tenantId, ctx.tenantId)).orderBy(schema.tags.name),
      tx.execute<{ id: string; name: string; pipelineName: string }>(sql`
        select s.id, s.name, p.name as "pipelineName"
        from public.pipeline_stages s join public.pipelines p on p.id = s.pipeline_id and p.tenant_id = s.tenant_id
        where s.tenant_id = ${ctx.tenantId} and p.archived_at is null order by p.position, s.position`),
    ]);
    return { members: [...members], tags, stages: [...stages] };
  });
}

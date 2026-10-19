import { and, asc, count, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { schema, type Tx } from "@/server/db";
import { assertCan, assertCanWrite, type ServiceCtx } from "@/server/context";
import { audit } from "@/server/audit";
import { AppError, isUniqueViolation } from "@/server/errors";
import type { StageInput } from "./schemas";

export type StageView = { id: string; name: string; position: number; probability: number; kind: "open" | "won" | "lost"; color: string };
export type PipelineView = { id: string; name: string; isDefault: boolean; position: number; archived: boolean; stages: StageView[] };
export type LostReasonView = { id: string; label: string; active: boolean; position: number };

const toStage = (s: typeof schema.pipelineStages.$inferSelect): StageView => ({
  id: s.id,
  name: s.name,
  position: s.position,
  probability: s.probability,
  kind: s.kind as StageView["kind"],
  color: s.color,
});

/** All pipelines with their stages (ordered). Archived pipelines only when asked. */
export async function listPipelines(ctx: ServiceCtx, opts: { includeArchived?: boolean } = {}): Promise<PipelineView[]> {
  assertCan(ctx, "deals.view");
  return ctx.run((tx) => loadPipelines(tx, ctx.tenantId, opts.includeArchived));
}

export async function loadPipelines(tx: Tx, tenantId: string, includeArchived = false): Promise<PipelineView[]> {
  const pipes = await tx
    .select()
    .from(schema.pipelines)
    .where(and(eq(schema.pipelines.tenantId, tenantId), includeArchived ? undefined : isNull(schema.pipelines.archivedAt)))
    .orderBy(asc(schema.pipelines.position), asc(schema.pipelines.createdAt));
  if (!pipes.length) return [];
  const stages = await tx
    .select()
    .from(schema.pipelineStages)
    .where(and(eq(schema.pipelineStages.tenantId, tenantId), inArray(schema.pipelineStages.pipelineId, pipes.map((p) => p.id))))
    .orderBy(asc(schema.pipelineStages.position), asc(schema.pipelineStages.createdAt));
  return pipes.map((p) => ({
    id: p.id,
    name: p.name,
    isDefault: p.isDefault,
    position: p.position,
    archived: p.archivedAt !== null,
    stages: stages.filter((s) => s.pipelineId === p.id).map(toStage),
  }));
}

/** Loads a stage and checks it belongs to the pipeline within the tenant. */
export async function loadStage(tx: Tx, tenantId: string, pipelineId: string, stageId: string) {
  const [stage] = await tx
    .select()
    .from(schema.pipelineStages)
    .where(and(eq(schema.pipelineStages.id, stageId), eq(schema.pipelineStages.pipelineId, pipelineId), eq(schema.pipelineStages.tenantId, tenantId)));
  if (!stage) throw new AppError("VALIDATION", "errors.relatedMissing", { stageId: ["errors.relatedMissing"] });
  return stage;
}

export async function stageOfKind(tx: Tx, tenantId: string, pipelineId: string, kind: "won" | "lost") {
  const [stage] = await tx
    .select()
    .from(schema.pipelineStages)
    .where(and(eq(schema.pipelineStages.tenantId, tenantId), eq(schema.pipelineStages.pipelineId, pipelineId), eq(schema.pipelineStages.kind, kind)))
    .limit(1);
  if (!stage) throw new AppError("PRECONDITION", "pipelines.missingClosedStage");
  return stage;
}

async function loadPipeline(tx: Tx, tenantId: string, id: string) {
  const [p] = await tx.select().from(schema.pipelines).where(and(eq(schema.pipelines.id, id), eq(schema.pipelines.tenantId, tenantId)));
  if (!p) throw new AppError("NOT_FOUND", "errors.notFound");
  return p;
}

const DEFAULT_NEW_STAGES = {
  he: [
    { name: "חדש", probability: 10, kind: "open", color: "#64748b" },
    { name: "בתהליך", probability: 50, kind: "open", color: "#6366f1" },
    { name: "נסגר בהצלחה", probability: 100, kind: "won", color: "#10b981" },
    { name: "אבוד", probability: 0, kind: "lost", color: "#ef4444" },
  ],
  en: [
    { name: "New", probability: 10, kind: "open", color: "#64748b" },
    { name: "In progress", probability: 50, kind: "open", color: "#6366f1" },
    { name: "Won", probability: 100, kind: "won", color: "#10b981" },
    { name: "Lost", probability: 0, kind: "lost", color: "#ef4444" },
  ],
} as const;

export async function createPipeline(ctx: ServiceCtx, input: { name: string; locale?: "he" | "en" }) {
  assertCanWrite(ctx, "pipelines.manage");
  return ctx.run(async (tx) => {
    const [{ n }] = await tx.select({ n: count() }).from(schema.pipelines).where(and(eq(schema.pipelines.tenantId, ctx.tenantId), isNull(schema.pipelines.archivedAt)));
    if (n >= 20) throw new AppError("QUOTA_EXCEEDED", "pipelines.tooMany");
    const [p] = await tx
      .insert(schema.pipelines)
      .values({ tenantId: ctx.tenantId, name: input.name, isDefault: n === 0, position: n })
      .returning();
    await tx
      .insert(schema.pipelineStages)
      .values(DEFAULT_NEW_STAGES[input.locale ?? "he"].map((s, i) => ({ tenantId: ctx.tenantId, pipelineId: p.id, position: i, ...s })));
    await audit(tx, ctx, { action: "pipeline.created", entityType: "pipeline", entityId: p.id, metadata: { name: p.name } });
    return p;
  });
}

export async function renamePipeline(ctx: ServiceCtx, id: string, name: string) {
  assertCanWrite(ctx, "pipelines.manage");
  await ctx.run(async (tx) => {
    await loadPipeline(tx, ctx.tenantId, id);
    await tx.update(schema.pipelines).set({ name }).where(eq(schema.pipelines.id, id));
    await audit(tx, ctx, { action: "pipeline.renamed", entityType: "pipeline", entityId: id, metadata: { name } });
  });
}

export async function setDefaultPipeline(ctx: ServiceCtx, id: string) {
  assertCanWrite(ctx, "pipelines.manage");
  await ctx.run(async (tx) => {
    const p = await loadPipeline(tx, ctx.tenantId, id);
    if (p.archivedAt) throw new AppError("VALIDATION", "pipelines.archivedCannotBeDefault");
    await tx.update(schema.pipelines).set({ isDefault: false }).where(and(eq(schema.pipelines.tenantId, ctx.tenantId), ne(schema.pipelines.id, id)));
    await tx.update(schema.pipelines).set({ isDefault: true }).where(eq(schema.pipelines.id, id));
    await audit(tx, ctx, { action: "pipeline.default_set", entityType: "pipeline", entityId: id });
  });
}

/** Archiving hides a pipeline from boards; its deals keep their history. */
export async function archivePipeline(ctx: ServiceCtx, id: string) {
  assertCanWrite(ctx, "pipelines.manage");
  await ctx.run(async (tx) => {
    const p = await loadPipeline(tx, ctx.tenantId, id);
    if (p.isDefault) throw new AppError("VALIDATION", "pipelines.cannotArchiveDefault");
    const [{ open }] = await tx
      .select({ open: count() })
      .from(schema.deals)
      .where(and(eq(schema.deals.pipelineId, id), eq(schema.deals.status, "open"), isNull(schema.deals.deletedAt)));
    if (open > 0) throw new AppError("VALIDATION", "pipelines.hasOpenDeals", undefined, { count: open });
    await tx.update(schema.pipelines).set({ archivedAt: new Date() }).where(eq(schema.pipelines.id, id));
    await audit(tx, ctx, { action: "pipeline.archived", entityType: "pipeline", entityId: id });
  });
}

async function assertSingleClosedStages(tx: Tx, tenantId: string, pipelineId: string) {
  const rows = await tx
    .select({ kind: schema.pipelineStages.kind, n: count() })
    .from(schema.pipelineStages)
    .where(and(eq(schema.pipelineStages.tenantId, tenantId), eq(schema.pipelineStages.pipelineId, pipelineId)))
    .groupBy(schema.pipelineStages.kind);
  const by = Object.fromEntries(rows.map((r) => [r.kind, Number(r.n)]));
  if ((by.won ?? 0) !== 1 || (by.lost ?? 0) !== 1) throw new AppError("VALIDATION", "pipelines.oneWonOneLost");
  if ((by.open ?? 0) < 1) throw new AppError("VALIDATION", "pipelines.needOpenStage");
}

export async function addStage(ctx: ServiceCtx, pipelineId: string, input: StageInput) {
  assertCanWrite(ctx, "pipelines.manage");
  return ctx.run(async (tx) => {
    await loadPipeline(tx, ctx.tenantId, pipelineId);
    if (input.kind !== "open") throw new AppError("VALIDATION", "pipelines.oneWonOneLost");
    // New open stages go before the closed (won/lost) stages.
    const stages = await tx
      .select()
      .from(schema.pipelineStages)
      .where(and(eq(schema.pipelineStages.tenantId, ctx.tenantId), eq(schema.pipelineStages.pipelineId, pipelineId)))
      .orderBy(asc(schema.pipelineStages.position));
    if (stages.length >= 30) throw new AppError("QUOTA_EXCEEDED", "pipelines.tooManyStages");
    const open = stages.filter((s) => s.kind === "open");
    const closed = stages.filter((s) => s.kind !== "open");
    const newPos = open.length;
    for (const [i, s] of closed.entries()) {
      await tx.update(schema.pipelineStages).set({ position: newPos + 1 + i }).where(eq(schema.pipelineStages.id, s.id));
    }
    const [stage] = await tx
      .insert(schema.pipelineStages)
      .values({ tenantId: ctx.tenantId, pipelineId, position: newPos, name: input.name, probability: input.probability, kind: "open", color: input.color })
      .returning();
    await audit(tx, ctx, { action: "stage.created", entityType: "stage", entityId: stage.id, metadata: { pipelineId, name: stage.name } });
    return toStage(stage);
  });
}

export async function updateStage(ctx: ServiceCtx, stageId: string, input: StageInput) {
  assertCanWrite(ctx, "pipelines.manage");
  await ctx.run(async (tx) => {
    const [stage] = await tx
      .select()
      .from(schema.pipelineStages)
      .where(and(eq(schema.pipelineStages.id, stageId), eq(schema.pipelineStages.tenantId, ctx.tenantId)));
    if (!stage) throw new AppError("NOT_FOUND", "errors.notFound");
    await tx
      .update(schema.pipelineStages)
      .set({ name: input.name, probability: input.probability, color: input.color, kind: input.kind })
      .where(eq(schema.pipelineStages.id, stageId));
    if (input.kind !== stage.kind) {
      await assertSingleClosedStages(tx, ctx.tenantId, stage.pipelineId);
      const [{ deals }] = await tx.select({ deals: count() }).from(schema.deals).where(eq(schema.deals.stageId, stageId));
      if (deals > 0) throw new AppError("VALIDATION", "pipelines.kindChangeWithDeals");
    }
    await audit(tx, ctx, { action: "stage.updated", entityType: "stage", entityId: stageId, metadata: { name: input.name } });
  });
}

/** Persists a new order of open stages (closed stages always stay last). */
export async function reorderStages(ctx: ServiceCtx, pipelineId: string, orderedIds: string[]) {
  assertCanWrite(ctx, "pipelines.manage");
  await ctx.run(async (tx) => {
    await loadPipeline(tx, ctx.tenantId, pipelineId);
    const stages = await tx
      .select()
      .from(schema.pipelineStages)
      .where(and(eq(schema.pipelineStages.tenantId, ctx.tenantId), eq(schema.pipelineStages.pipelineId, pipelineId)));
    const open = stages.filter((s) => s.kind === "open");
    const openIds = new Set(open.map((s) => s.id));
    if (orderedIds.length !== open.length || orderedIds.some((id) => !openIds.has(id)) || new Set(orderedIds).size !== orderedIds.length) {
      throw new AppError("VALIDATION", "errors.validation");
    }
    const closed = stages.filter((s) => s.kind !== "open").sort((a, b) => (a.kind === "won" ? -1 : b.kind === "won" ? 1 : 0));
    const finalOrder = [...orderedIds, ...closed.map((s) => s.id)];
    for (const [i, id] of finalOrder.entries()) await tx.update(schema.pipelineStages).set({ position: i }).where(eq(schema.pipelineStages.id, id));
    await audit(tx, ctx, { action: "stage.reordered", entityType: "pipeline", entityId: pipelineId });
  });
}

/** Deletes an open stage; its deals (if any) move to `moveToStageId` in the same pipeline. */
export async function deleteStage(ctx: ServiceCtx, stageId: string, moveToStageId: string | null) {
  assertCanWrite(ctx, "pipelines.manage");
  await ctx.run(async (tx) => {
    const [stage] = await tx
      .select()
      .from(schema.pipelineStages)
      .where(and(eq(schema.pipelineStages.id, stageId), eq(schema.pipelineStages.tenantId, ctx.tenantId)));
    if (!stage) throw new AppError("NOT_FOUND", "errors.notFound");
    if (stage.kind !== "open") throw new AppError("VALIDATION", "pipelines.cannotDeleteClosedStage");
    const openStages = await tx
      .select({ id: schema.pipelineStages.id })
      .from(schema.pipelineStages)
      .where(and(eq(schema.pipelineStages.pipelineId, stage.pipelineId), eq(schema.pipelineStages.kind, "open")));
    if (openStages.length <= 1) throw new AppError("VALIDATION", "pipelines.needOpenStage");
    const [{ deals }] = await tx.select({ deals: count() }).from(schema.deals).where(eq(schema.deals.stageId, stageId));
    if (deals > 0) {
      if (!moveToStageId || moveToStageId === stageId) throw new AppError("VALIDATION", "pipelines.chooseTargetStage", { moveToStageId: ["validation.required"] });
      const target = await loadStage(tx, ctx.tenantId, stage.pipelineId, moveToStageId);
      await tx.execute(sql`
        update public.deals set stage_id = ${target.id},
          status = ${target.kind},
          won_at = case when ${target.kind} = 'won' then coalesce(won_at, now()) else null end,
          lost_at = case when ${target.kind} = 'lost' then coalesce(lost_at, now()) else null end
        where tenant_id = ${ctx.tenantId} and stage_id = ${stageId}`);
    }
    await tx.delete(schema.pipelineStages).where(eq(schema.pipelineStages.id, stageId));
    const rest = await tx
      .select()
      .from(schema.pipelineStages)
      .where(eq(schema.pipelineStages.pipelineId, stage.pipelineId))
      .orderBy(asc(schema.pipelineStages.position));
    for (const [i, s] of rest.entries()) await tx.update(schema.pipelineStages).set({ position: i }).where(eq(schema.pipelineStages.id, s.id));
    await audit(tx, ctx, { action: "stage.deleted", entityType: "stage", entityId: stageId, metadata: { name: stage.name, movedDeals: deals, moveToStageId } });
  });
}

/* ------------------------------------------------------------ Lost reasons */

export async function listLostReasons(ctx: ServiceCtx, opts: { activeOnly?: boolean } = {}): Promise<LostReasonView[]> {
  assertCan(ctx, "deals.view");
  return ctx.run(async (tx) => {
    const rows = await tx
      .select()
      .from(schema.lostReasons)
      .where(and(eq(schema.lostReasons.tenantId, ctx.tenantId), opts.activeOnly ? eq(schema.lostReasons.active, true) : undefined))
      .orderBy(asc(schema.lostReasons.position), asc(schema.lostReasons.label));
    return rows.map((r) => ({ id: r.id, label: r.label, active: r.active, position: r.position }));
  });
}

export async function createLostReason(ctx: ServiceCtx, label: string) {
  assertCanWrite(ctx, "pipelines.manage");
  try {
    return await ctx.run(async (tx) => {
      const [{ n }] = await tx.select({ n: count() }).from(schema.lostReasons).where(eq(schema.lostReasons.tenantId, ctx.tenantId));
      const [r] = await tx.insert(schema.lostReasons).values({ tenantId: ctx.tenantId, label, position: n }).returning();
      await audit(tx, ctx, { action: "lost_reason.created", entityType: "lost_reason", entityId: r.id, metadata: { label } });
      return r;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new AppError("CONFLICT", "pipelines.reasonExists");
    throw e;
  }
}

export async function updateLostReason(ctx: ServiceCtx, id: string, input: { label: string; active: boolean }) {
  assertCanWrite(ctx, "pipelines.manage");
  try {
    await ctx.run(async (tx) => {
      const [r] = await tx
        .update(schema.lostReasons)
        .set(input)
        .where(and(eq(schema.lostReasons.id, id), eq(schema.lostReasons.tenantId, ctx.tenantId)))
        .returning();
      if (!r) throw new AppError("NOT_FOUND", "errors.notFound");
      await audit(tx, ctx, { action: "lost_reason.updated", entityType: "lost_reason", entityId: id });
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new AppError("CONFLICT", "pipelines.reasonExists");
    throw e;
  }
}

/** Deleting a reason keeps deal history intact (deals.lost_reason_id becomes null). */
export async function deleteLostReason(ctx: ServiceCtx, id: string) {
  assertCanWrite(ctx, "pipelines.manage");
  await ctx.run(async (tx) => {
    const [r] = await tx
      .delete(schema.lostReasons)
      .where(and(eq(schema.lostReasons.id, id), eq(schema.lostReasons.tenantId, ctx.tenantId)))
      .returning();
    if (!r) throw new AppError("NOT_FOUND", "errors.notFound");
    await audit(tx, ctx, { action: "lost_reason.deleted", entityType: "lost_reason", entityId: id, metadata: { label: r.label } });
  });
}

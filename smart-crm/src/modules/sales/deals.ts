import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { schema, type Tx } from "@/server/db";
import { assertCan, assertCanWrite, type ServiceCtx } from "@/server/context";
import { audit } from "@/server/audit";
import { emitEvent } from "@/server/events";
import { AppError } from "@/server/errors";
import { likePattern } from "@/modules/search/service";
import { notify } from "@/modules/notifications/service";
import { listCustomFields, validateCustomFields } from "@/modules/crm/custom-fields";
import { replaceEntityTags, tagsFor, type TagView } from "@/modules/crm/tags";
import { recordActivity } from "@/modules/crm/activities";
import type { DealInput, DealListQuery } from "./schemas";
import { loadPipelines, loadStage, stageOfKind, type PipelineView } from "./pipelines";

export type DealRow = typeof schema.deals.$inferSelect;

export type DealCard = {
  id: string;
  title: string;
  valueCents: number;
  currency: string;
  status: "open" | "won" | "lost";
  stageId: string;
  pipelineId: string;
  position: number;
  probability: number | null;
  expectedCloseDate: string | null;
  contactName: string | null;
  companyName: string | null;
  ownerId: string | null;
  ownerName: string | null;
  tags: TagView[];
};

const POSITION_STEP = 1024;
/** Closed columns on the board only show recent deals. */
const CLOSED_COLUMN_DAYS = 30;

function contactNameSql() {
  return sql<string | null>`nullif(trim(coalesce(${schema.contacts.firstName}, '') || ' ' || coalesce(${schema.contacts.lastName}, '')), '')`;
}

async function hydrate(tx: Tx, rows: { d: DealRow; contactName: string | null; companyName: string | null; ownerName: string | null }[]): Promise<DealCard[]> {
  const tags = await tagsFor(
    tx,
    "deal",
    rows.map((r) => r.d.id),
  );
  return rows.map(({ d, contactName, companyName, ownerName }) => ({
    id: d.id,
    title: d.title,
    valueCents: d.valueCents,
    currency: d.currency,
    status: d.status as DealCard["status"],
    stageId: d.stageId,
    pipelineId: d.pipelineId,
    position: d.position,
    probability: d.probability,
    expectedCloseDate: d.expectedCloseDate,
    contactName,
    companyName,
    ownerId: d.ownerId,
    ownerName,
    tags: tags.get(d.id) ?? [],
  }));
}

function baseSelect(tx: Tx) {
  return tx
    .select({ d: schema.deals, contactName: contactNameSql(), companyName: schema.companies.name, ownerName: schema.profiles.fullName })
    .from(schema.deals)
    .leftJoin(schema.contacts, eq(schema.contacts.id, schema.deals.contactId))
    .leftJoin(schema.companies, eq(schema.companies.id, schema.deals.companyId))
    .leftJoin(schema.profiles, eq(schema.profiles.id, schema.deals.ownerId));
}

function filters(ctx: ServiceCtx, q: Partial<DealListQuery>): SQL[] {
  const conds: (SQL | undefined)[] = [eq(schema.deals.tenantId, ctx.tenantId), isNull(schema.deals.deletedAt)];
  if (q.q) conds.push(ilike(schema.deals.title, likePattern(q.q)));
  if (q.owner === "me" && ctx.userId) conds.push(eq(schema.deals.ownerId, ctx.userId));
  else if (q.owner === "unassigned") conds.push(isNull(schema.deals.ownerId));
  else if (q.owner && /^[0-9a-f-]{36}$/.test(q.owner)) conds.push(eq(schema.deals.ownerId, q.owner));
  if (q.pipeline) conds.push(eq(schema.deals.pipelineId, q.pipeline));
  if (q.status) conds.push(eq(schema.deals.status, q.status));
  if (q.from) conds.push(gte(schema.deals.expectedCloseDate, q.from));
  if (q.to) conds.push(lte(schema.deals.expectedCloseDate, q.to));
  return conds.filter(Boolean) as SQL[];
}

/** Board data: the chosen (or default) pipeline, its stages and deals per stage. */
export async function getBoard(ctx: ServiceCtx, q: Partial<DealListQuery>) {
  assertCan(ctx, "deals.view");
  return ctx.run(async (tx) => {
    const pipelines = await loadPipelines(tx, ctx.tenantId);
    const pipeline = pipelines.find((p) => p.id === q.pipeline) ?? pipelines.find((p) => p.isDefault) ?? pipelines[0];
    if (!pipeline) return { pipelines, pipeline: null as PipelineView | null, deals: [] as DealCard[] };
    const since = new Date(Date.now() - CLOSED_COLUMN_DAYS * 86400_000);
    const rows = await baseSelect(tx)
      .where(
        and(
          ...filters(ctx, { ...q, pipeline: pipeline.id, status: undefined }),
          or(eq(schema.deals.status, "open"), sql`coalesce(${schema.deals.wonAt}, ${schema.deals.lostAt}) >= ${since.toISOString()}::timestamptz`),
        ),
      )
      .orderBy(asc(schema.deals.position), asc(schema.deals.createdAt))
      .limit(1000);
    return { pipelines, pipeline, deals: await hydrate(tx, rows) };
  });
}

const SORTS = {
  created_desc: [desc(schema.deals.createdAt)],
  value_desc: [desc(schema.deals.valueCents)],
  close_asc: [sql`${schema.deals.expectedCloseDate} asc nulls last`],
  title_asc: [asc(schema.deals.title)],
};

export async function listDeals(ctx: ServiceCtx, q: DealListQuery) {
  assertCan(ctx, "deals.view");
  return ctx.run(async (tx) => {
    const where = and(...filters(ctx, q));
    const [{ total }] = await tx.select({ total: count() }).from(schema.deals).where(where);
    const rows = await baseSelect(tx)
      .where(where)
      .orderBy(...SORTS[q.sort], asc(schema.deals.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    const stageIds = [...new Set(rows.map((r) => r.d.stageId))];
    const stages = stageIds.length
      ? await tx.select({ id: schema.pipelineStages.id, name: schema.pipelineStages.name, color: schema.pipelineStages.color }).from(schema.pipelineStages).where(inArray(schema.pipelineStages.id, stageIds))
      : [];
    const stageMap = new Map(stages.map((s) => [s.id, s]));
    const cards = await hydrate(tx, rows);
    return { total, rows: cards.map((c) => ({ ...c, stageName: stageMap.get(c.stageId)?.name ?? "", stageColor: stageMap.get(c.stageId)?.color ?? "#64748b" })) };
  });
}

export async function loadDeal(tx: Tx, tenantId: string, id: string): Promise<DealRow> {
  const [d] = await tx
    .select()
    .from(schema.deals)
    .where(and(eq(schema.deals.id, id), eq(schema.deals.tenantId, tenantId), isNull(schema.deals.deletedAt)));
  if (!d) throw new AppError("NOT_FOUND", "errors.notFound");
  return d;
}

export async function getDeal(ctx: ServiceCtx, id: string) {
  assertCan(ctx, "deals.view");
  return ctx.run(async (tx) => {
    const deal = await loadDeal(tx, ctx.tenantId, id);
    const [pipeline] = (await loadPipelines(tx, ctx.tenantId, true)).filter((p) => p.id === deal.pipelineId);
    const [contact] = deal.contactId
      ? await tx.select({ id: schema.contacts.id, name: contactNameSql(), email: schema.contacts.email, phone: schema.contacts.phone }).from(schema.contacts).where(eq(schema.contacts.id, deal.contactId))
      : [];
    const [company] = deal.companyId
      ? await tx.select({ id: schema.companies.id, name: schema.companies.name }).from(schema.companies).where(eq(schema.companies.id, deal.companyId))
      : [];
    const [owner] = deal.ownerId
      ? await tx.select({ id: schema.profiles.id, fullName: schema.profiles.fullName }).from(schema.profiles).where(eq(schema.profiles.id, deal.ownerId))
      : [];
    const [lostReason] = deal.lostReasonId
      ? await tx.select({ id: schema.lostReasons.id, label: schema.lostReasons.label }).from(schema.lostReasons).where(eq(schema.lostReasons.id, deal.lostReasonId))
      : [];
    const tags = (await tagsFor(tx, "deal", [deal.id])).get(deal.id) ?? [];
    const customFieldDefs = await listCustomFields(tx, ctx.tenantId, "deal");
    return { deal, pipeline: pipeline ?? null, contact: contact ?? null, company: company ?? null, owner: owner ?? null, lostReason: lostReason ?? null, tags, customFieldDefs };
  });
}

async function assertLinks(tx: Tx, tenantId: string, input: { contactId: string | null; companyId: string | null }) {
  if (input.contactId) {
    const [c] = await tx
      .select({ id: schema.contacts.id })
      .from(schema.contacts)
      .where(and(eq(schema.contacts.id, input.contactId), eq(schema.contacts.tenantId, tenantId), isNull(schema.contacts.deletedAt)));
    if (!c) throw new AppError("VALIDATION", "errors.relatedMissing", { contactId: ["errors.relatedMissing"] });
  }
  if (input.companyId) {
    const [c] = await tx
      .select({ id: schema.companies.id })
      .from(schema.companies)
      .where(and(eq(schema.companies.id, input.companyId), eq(schema.companies.tenantId, tenantId), isNull(schema.companies.deletedAt)));
    if (!c) throw new AppError("VALIDATION", "errors.relatedMissing", { companyId: ["errors.relatedMissing"] });
  }
}

/** Position at the end of a stage column. */
async function endPosition(tx: Tx, stageId: string) {
  const [r] = await tx.select({ max: sql<number | null>`max(${schema.deals.position})` }).from(schema.deals).where(eq(schema.deals.stageId, stageId));
  return (r?.max ?? 0) + POSITION_STEP;
}

function closedFields(kind: string, prev?: DealRow) {
  if (kind === "won") return { status: "won" as const, wonAt: prev?.wonAt ?? new Date(), lostAt: null, lostReasonId: null, lostNote: null };
  if (kind === "lost") return { status: "lost" as const, lostAt: prev?.lostAt ?? new Date(), wonAt: null };
  return { status: "open" as const, wonAt: null, lostAt: null, lostReasonId: null, lostNote: null };
}

/** Shared creator (also used by lead conversion) — runs inside the caller's transaction. */
export async function insertDeal(tx: Tx, ctx: ServiceCtx, input: Omit<DealInput, "value"> & { valueCents: number; leadId?: string | null }) {
  const stage = await loadStage(tx, ctx.tenantId, input.pipelineId, input.stageId);
  await assertLinks(tx, ctx.tenantId, input);
  const defs = await listCustomFields(tx, ctx.tenantId, "deal");
  const customFields = validateCustomFields(defs, input.customFields);
  const [deal] = await tx
    .insert(schema.deals)
    .values({
      tenantId: ctx.tenantId,
      pipelineId: input.pipelineId,
      stageId: stage.id,
      title: input.title,
      valueCents: input.valueCents,
      currency: input.currency,
      probability: input.probability,
      expectedCloseDate: input.expectedCloseDate,
      contactId: input.contactId,
      companyId: input.companyId,
      leadId: input.leadId ?? null,
      ownerId: input.ownerId ?? (ctx.actorType === "user" ? ctx.userId : null),
      customFields,
      position: await endPosition(tx, stage.id),
      createdBy: ctx.userId,
      ...closedFields(stage.kind),
    })
    .returning();
  if (input.tagIds?.length) await replaceEntityTags(tx, ctx.tenantId, "deal", deal.id, input.tagIds);
  await recordActivity(tx, ctx, { type: "deal_created", dealId: deal.id, contactId: deal.contactId, companyId: deal.companyId, subject: deal.title });
  await audit(tx, ctx, { action: "deal.created", entityType: "deal", entityId: deal.id, metadata: { valueCents: deal.valueCents, stageId: deal.stageId } });
  await emitEvent(tx, ctx, {
    type: "deal.created",
    entityType: "deal",
    entityId: deal.id,
    data: { pipelineId: deal.pipelineId, stageId: deal.stageId, valueCents: deal.valueCents, contactId: deal.contactId },
  });
  return deal;
}

export async function createDeal(ctx: ServiceCtx, input: DealInput) {
  assertCanWrite(ctx, "deals.create");
  return ctx.run((tx) => insertDeal(tx, ctx, { ...input, valueCents: input.value ?? 0 }));
}

export async function updateDeal(ctx: ServiceCtx, id: string, input: DealInput) {
  assertCanWrite(ctx, "deals.update");
  return ctx.run(async (tx) => {
    const before = await loadDeal(tx, ctx.tenantId, id);
    const stage = await loadStage(tx, ctx.tenantId, input.pipelineId, input.stageId);
    await assertLinks(tx, ctx.tenantId, input);
    const defs = await listCustomFields(tx, ctx.tenantId, "deal");
    const customFields = { ...before.customFields, ...validateCustomFields(defs, input.customFields) };
    const stageChanged = stage.id !== before.stageId;
    const [deal] = await tx
      .update(schema.deals)
      .set({
        title: input.title,
        valueCents: input.value ?? 0,
        currency: input.currency,
        probability: input.probability,
        expectedCloseDate: input.expectedCloseDate,
        contactId: input.contactId,
        companyId: input.companyId,
        ownerId: input.ownerId,
        customFields,
        pipelineId: input.pipelineId,
        stageId: stage.id,
        ...(stageChanged ? { position: await endPosition(tx, stage.id), ...closedFields(stage.kind, before) } : {}),
      })
      .where(eq(schema.deals.id, id))
      .returning();
    let addedTags: string[] = [];
    if (input.tagIds) addedTags = await replaceEntityTags(tx, ctx.tenantId, "deal", id, input.tagIds);
    await audit(tx, ctx, { action: "deal.updated", entityType: "deal", entityId: id, metadata: { tagsAdded: addedTags.length } });
    await emitEvent(tx, ctx, { type: "deal.updated", entityType: "deal", entityId: id, data: { valueCents: deal.valueCents } });
    if (stageChanged) await afterStageChange(tx, ctx, before, deal, stage.name);
    if (input.ownerId && input.ownerId !== before.ownerId && input.ownerId !== ctx.userId) {
      await notify(tx, {
        tenantId: ctx.tenantId,
        userId: input.ownerId,
        type: "lead_assigned",
        title: { he: `הוקצתה לך העסקה ${deal.title}`, en: `Deal ${deal.title} was assigned to you` },
        link: `/deals/${deal.id}`,
      });
    }
    return deal;
  });
}

/** Activity, events and owner notification for a stage/status change. */
async function afterStageChange(tx: Tx, ctx: ServiceCtx, before: DealRow, after: DealRow, stageName: string) {
  const refs = { dealId: after.id, contactId: after.contactId, companyId: after.companyId };
  const statusChanged = before.status !== after.status;
  if (statusChanged && after.status === "won") {
    await recordActivity(tx, ctx, { ...refs, type: "deal_won", subject: after.title, metadata: { valueCents: after.valueCents } });
    await emitEvent(tx, ctx, { type: "deal.won", entityType: "deal", entityId: after.id, data: { valueCents: after.valueCents, contactId: after.contactId } });
  } else if (statusChanged && after.status === "lost") {
    await recordActivity(tx, ctx, { ...refs, type: "deal_lost", subject: after.title, body: after.lostNote, metadata: { lostReasonId: after.lostReasonId } });
    await emitEvent(tx, ctx, { type: "deal.lost", entityType: "deal", entityId: after.id, data: { lostReasonId: after.lostReasonId } });
  } else {
    await recordActivity(tx, ctx, { ...refs, type: "deal_stage_changed", subject: after.title, body: stageName, metadata: { fromStageId: before.stageId, toStageId: after.stageId } });
  }
  await emitEvent(tx, ctx, {
    type: "deal.stage_changed",
    entityType: "deal",
    entityId: after.id,
    data: { fromStageId: before.stageId, toStageId: after.stageId, status: after.status, pipelineId: after.pipelineId },
  });
  await audit(tx, ctx, { action: "deal.stage_changed", entityType: "deal", entityId: after.id, metadata: { from: before.stageId, to: after.stageId, status: after.status } });
  if (statusChanged && after.status !== "open" && after.ownerId && after.ownerId !== ctx.userId) {
    const won = after.status === "won";
    await notify(tx, {
      tenantId: ctx.tenantId,
      userId: after.ownerId,
      type: won ? "deal_won" : "deal_lost",
      title: won ? { he: `העסקה ${after.title} נסגרה בהצלחה 🎉`, en: `Deal ${after.title} was won 🎉` } : { he: `העסקה ${after.title} סומנה כאבודה`, en: `Deal ${after.title} was marked lost` },
      link: `/deals/${after.id}`,
    });
  }
}

/**
 * Moves a deal to a stage (board drag & drop). The new position lies between
 * the given neighbours; when the gap becomes too small the column is renumbered.
 */
export async function moveDeal(ctx: ServiceCtx, input: { id: string; stageId: string; beforeId?: string | null; afterId?: string | null }) {
  assertCanWrite(ctx, "deals.update");
  return ctx.run(async (tx) => {
    const before = await loadDeal(tx, ctx.tenantId, input.id);
    const stage = await loadStage(tx, ctx.tenantId, before.pipelineId, input.stageId);
    if (stage.kind === "lost" && before.status !== "lost") throw new AppError("VALIDATION", "deals.useLostDialog");
    const neighbour = async (nid?: string | null) => {
      if (!nid || nid === input.id) return null;
      const [n] = await tx
        .select({ position: schema.deals.position })
        .from(schema.deals)
        .where(and(eq(schema.deals.id, nid), eq(schema.deals.stageId, stage.id), eq(schema.deals.tenantId, ctx.tenantId)));
      return n?.position ?? null;
    };
    const prev = await neighbour(input.beforeId);
    const next = await neighbour(input.afterId);
    let position: number;
    if (prev !== null && next !== null) position = (prev + next) / 2;
    else if (prev !== null) position = prev + POSITION_STEP;
    else if (next !== null) position = next - POSITION_STEP;
    else position = await endPosition(tx, stage.id);

    const stageChanged = stage.id !== before.stageId;
    const [after] = await tx
      .update(schema.deals)
      .set({ stageId: stage.id, position, ...(stageChanged ? closedFields(stage.kind, before) : {}) })
      .where(eq(schema.deals.id, input.id))
      .returning();
    if (prev !== null && next !== null && Math.abs(next - prev) < 1e-6) {
      // Renumber the column to restore spacing.
      await tx.execute(sql`
        update public.deals d set position = r.rn * ${POSITION_STEP}
        from (select id, row_number() over (order by position, created_at) as rn from public.deals where stage_id = ${stage.id}) r
        where d.id = r.id`);
    }
    if (stageChanged) await afterStageChange(tx, ctx, before, after, stage.name);
    return after;
  });
}

export async function winDeal(ctx: ServiceCtx, id: string) {
  assertCanWrite(ctx, "deals.update");
  return ctx.run(async (tx) => {
    const before = await loadDeal(tx, ctx.tenantId, id);
    if (before.status === "won") return before;
    const stage = await stageOfKind(tx, ctx.tenantId, before.pipelineId, "won");
    const [after] = await tx
      .update(schema.deals)
      .set({ stageId: stage.id, position: await endPosition(tx, stage.id), ...closedFields("won") })
      .where(eq(schema.deals.id, id))
      .returning();
    await afterStageChange(tx, ctx, before, after, stage.name);
    return after;
  });
}

export async function loseDeal(ctx: ServiceCtx, id: string, input: { lostReasonId: string | null; lostNote: string | null }) {
  assertCanWrite(ctx, "deals.update");
  return ctx.run(async (tx) => {
    const before = await loadDeal(tx, ctx.tenantId, id);
    if (input.lostReasonId) {
      const [r] = await tx
        .select({ id: schema.lostReasons.id })
        .from(schema.lostReasons)
        .where(and(eq(schema.lostReasons.id, input.lostReasonId), eq(schema.lostReasons.tenantId, ctx.tenantId)));
      if (!r) throw new AppError("VALIDATION", "errors.relatedMissing", { lostReasonId: ["errors.relatedMissing"] });
    }
    const stage = await stageOfKind(tx, ctx.tenantId, before.pipelineId, "lost");
    const [after] = await tx
      .update(schema.deals)
      .set({
        stageId: stage.id,
        position: await endPosition(tx, stage.id),
        status: "lost",
        lostAt: before.lostAt ?? new Date(),
        wonAt: null,
        lostReasonId: input.lostReasonId,
        lostNote: input.lostNote,
      })
      .where(eq(schema.deals.id, id))
      .returning();
    if (before.status === "lost") {
      await audit(tx, ctx, { action: "deal.lost_reason_updated", entityType: "deal", entityId: id });
    } else {
      await afterStageChange(tx, ctx, before, after, stage.name);
    }
    return after;
  });
}

/** Re-opens a closed deal into the first open stage of its pipeline. */
export async function reopenDeal(ctx: ServiceCtx, id: string) {
  assertCanWrite(ctx, "deals.update");
  return ctx.run(async (tx) => {
    const before = await loadDeal(tx, ctx.tenantId, id);
    if (before.status === "open") return before;
    const [stage] = await tx
      .select()
      .from(schema.pipelineStages)
      .where(and(eq(schema.pipelineStages.pipelineId, before.pipelineId), eq(schema.pipelineStages.kind, "open")))
      .orderBy(desc(schema.pipelineStages.position))
      .limit(1);
    if (!stage) throw new AppError("PRECONDITION", "pipelines.needOpenStage");
    const [after] = await tx
      .update(schema.deals)
      .set({ stageId: stage.id, position: await endPosition(tx, stage.id), ...closedFields("open") })
      .where(eq(schema.deals.id, id))
      .returning();
    await afterStageChange(tx, ctx, before, after, stage.name);
    return after;
  });
}

export async function deleteDeal(ctx: ServiceCtx, id: string) {
  assertCanWrite(ctx, "deals.delete");
  await ctx.run(async (tx) => {
    await loadDeal(tx, ctx.tenantId, id);
    await tx.update(schema.deals).set({ deletedAt: new Date() }).where(eq(schema.deals.id, id));
    await audit(tx, ctx, { action: "deal.deleted", entityType: "deal", entityId: id });
  });
}

export async function setDealTags(ctx: ServiceCtx, dealId: string, tagIds: string[]) {
  assertCanWrite(ctx, "deals.update");
  await ctx.run(async (tx) => {
    await loadDeal(tx, ctx.tenantId, dealId);
    await replaceEntityTags(tx, ctx.tenantId, "deal", dealId, tagIds);
  });
}

/* ---------------------------------------------------------------- Forecast */

export type ForecastBucket = { month: string | null; count: number; valueCents: number; weightedCents: number };
export type Forecast = {
  currency: string;
  openCount: number;
  openValueCents: number;
  weightedValueCents: number;
  wonThisMonthCents: number;
  byMonth: ForecastBucket[];
  /** Open value in other currencies (not converted). */
  otherCurrencies: { currency: string; openValueCents: number }[];
};

/**
 * Weighted pipeline: Σ value × (deal probability ?? stage probability) / 100,
 * for open deals in the tenant currency, grouped by expected-close month.
 */
export async function getForecast(ctx: ServiceCtx, opts: { pipelineId?: string; ownerId?: string | null; currency: string }): Promise<Forecast> {
  assertCan(ctx, "deals.view");
  return ctx.run(async (tx) => {
    const pipe = opts.pipelineId ? sql`and d.pipeline_id = ${opts.pipelineId}` : sql``;
    const owner = opts.ownerId ? sql`and d.owner_id = ${opts.ownerId}` : sql``;
    const rows = await tx.execute<{ month: string | null; currency: string; n: number; value: string; weighted: string }>(sql`
      select to_char(date_trunc('month', d.expected_close_date), 'YYYY-MM') as month, d.currency,
             count(*)::int as n,
             sum(d.value_cents)::text as value,
             round(sum(d.value_cents * coalesce(d.probability, s.probability) / 100.0))::text as weighted
      from public.deals d
      join public.pipeline_stages s on s.id = d.stage_id
      where d.tenant_id = ${ctx.tenantId} and d.deleted_at is null and d.status = 'open' ${pipe} ${owner}
      group by 1, 2
      order by 1 nulls last`);
    const [won] = await tx.execute<{ value: string | null }>(sql`
      select sum(value_cents)::text as value from public.deals d
      where d.tenant_id = ${ctx.tenantId} and d.deleted_at is null and d.status = 'won' and d.currency = ${opts.currency}
        and d.won_at >= date_trunc('month', now()) ${pipe} ${owner}`);
    const main = rows.filter((r) => r.currency === opts.currency);
    const others = new Map<string, number>();
    for (const r of rows.filter((r) => r.currency !== opts.currency)) others.set(r.currency, (others.get(r.currency) ?? 0) + Number(r.value));
    return {
      currency: opts.currency,
      openCount: main.reduce((a, r) => a + r.n, 0),
      openValueCents: main.reduce((a, r) => a + Number(r.value), 0),
      weightedValueCents: main.reduce((a, r) => a + Number(r.weighted), 0),
      wonThisMonthCents: Number(won?.value ?? 0),
      byMonth: main.map((r) => ({ month: r.month, count: r.n, valueCents: Number(r.value), weightedCents: Number(r.weighted) })),
      otherCurrencies: [...others].map(([currency, openValueCents]) => ({ currency, openValueCents })),
    };
  });
}

export async function dealStageHistory(ctx: ServiceCtx, dealId: string) {
  assertCan(ctx, "deals.view");
  return ctx.run(async (tx) => {
    await loadDeal(tx, ctx.tenantId, dealId);
    return tx
      .select({ h: schema.dealStageHistory, by: schema.profiles.fullName })
      .from(schema.dealStageHistory)
      .leftJoin(schema.profiles, eq(schema.profiles.id, schema.dealStageHistory.changedBy))
      .where(and(eq(schema.dealStageHistory.tenantId, ctx.tenantId), eq(schema.dealStageHistory.dealId, dealId)))
      .orderBy(asc(schema.dealStageHistory.changedAt), asc(schema.dealStageHistory.id));
  });
}

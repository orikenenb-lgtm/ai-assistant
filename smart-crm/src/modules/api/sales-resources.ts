import { and, asc, desc, eq, isNull, lt, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@/server/db";
import { assertCan, type ServiceCtx } from "@/server/context";
import { AppError } from "@/server/errors";
import { dealInputSchema } from "@/modules/sales/schemas";
import { createDeal, deleteDeal, loadDeal, updateDeal } from "@/modules/sales/deals";
import { createTask, deleteTask, loadTask, setTaskStatus, tenantTimezone, updateTask } from "@/modules/tasks/service";
import { TASK_PRIORITIES, TASK_STATUSES, taskInputSchema } from "@/modules/tasks/schemas";
import { toLocalInput } from "@/modules/calendar/tz";
import { likePattern } from "@/modules/search/service";
import { pagination } from "./framework";

/**
 * Public API v1 — deals and tasks. Reads query tenant-scoped rows directly;
 * writes go through the module services (validation, audit, events, notifications).
 * Money is exchanged as integer minor units (`valueCents`), instants as ISO 8601.
 */

const page = {
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
};

/* ---------------------------------------------------------------- deals */

type DealRow = typeof schema.deals.$inferSelect;

export function serializeDeal(d: DealRow) {
  return {
    id: d.id,
    title: d.title,
    valueCents: d.valueCents,
    currency: d.currency,
    status: d.status,
    pipelineId: d.pipelineId,
    stageId: d.stageId,
    probability: d.probability,
    expectedCloseDate: d.expectedCloseDate,
    contactId: d.contactId,
    companyId: d.companyId,
    leadId: d.leadId,
    ownerId: d.ownerId,
    wonAt: d.wonAt,
    lostAt: d.lostAt,
    customFields: d.customFields,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

const dealListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(["open", "won", "lost"]).optional(),
  pipelineId: z.uuid().optional(),
  stageId: z.uuid().optional(),
  ownerId: z.uuid().optional(),
  contactId: z.uuid().optional(),
  ...page,
});

export async function apiListDeals(ctx: ServiceCtx, raw: Record<string, string>) {
  assertCan(ctx, "deals.view");
  const q = dealListQuery.parse(raw);
  const d = schema.deals;
  return ctx.run(async (tx) => {
    const where = and(
      eq(d.tenantId, ctx.tenantId),
      isNull(d.deletedAt),
      q.status ? eq(d.status, q.status) : undefined,
      q.pipelineId ? eq(d.pipelineId, q.pipelineId) : undefined,
      q.stageId ? eq(d.stageId, q.stageId) : undefined,
      q.ownerId ? eq(d.ownerId, q.ownerId) : undefined,
      q.contactId ? eq(d.contactId, q.contactId) : undefined,
      q.q ? sql`lower(${d.title}) like ${likePattern(q.q)}` : undefined,
    );
    const [{ total }] = await tx.select({ total: sql<number>`count(*)::int` }).from(d).where(where);
    const rows = await tx
      .select()
      .from(d)
      .where(where)
      .orderBy(desc(d.createdAt), asc(d.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    return { data: rows.map(serializeDeal), pagination: pagination(q.page, q.pageSize, total) };
  });
}

async function readDeal(ctx: ServiceCtx, id: string) {
  return ctx.run((tx) => loadDeal(tx, ctx.tenantId, id));
}

export async function apiGetDeal(ctx: ServiceCtx, id: string) {
  assertCan(ctx, "deals.view");
  return serializeDeal(await readDeal(ctx, id));
}

const dealBody = z.object({
  title: z.string().trim().min(1).max(200),
  // No defaults here: the PATCH schema is `.partial()` of this one, and a default would
  // overwrite stored values with zero.
  valueCents: z.number().int().min(0).max(1e14).optional(),
  currency: z.string().length(3).optional(),
  pipelineId: z.uuid(),
  stageId: z.uuid(),
  probability: z.number().int().min(0).max(100).nullable().optional(),
  expectedCloseDate: z.iso.date().nullable().optional(),
  contactId: z.uuid().nullable().optional(),
  companyId: z.uuid().nullable().optional(),
  ownerId: z.uuid().nullable().optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
}).strict();

/** Maps the API body onto the form schema the service validates (major units for `value`). */
function toDealInput(b: Partial<z.infer<typeof dealBody>>) {
  return dealInputSchema.parse({ ...b, value: b.valueCents === undefined ? undefined : b.valueCents / 100, valueCents: undefined });
}

export async function apiCreateDeal(ctx: ServiceCtx, body: unknown) {
  const deal = await createDeal(ctx, toDealInput({ valueCents: 0, ...dealBody.parse(body) }));
  return serializeDeal(await readDeal(ctx, deal.id));
}

export async function apiUpdateDeal(ctx: ServiceCtx, id: string, body: unknown) {
  const patch = dealBody.partial().parse(body);
  const before = await readDeal(ctx, id);
  const merged = {
    title: before.title,
    valueCents: before.valueCents,
    currency: before.currency,
    pipelineId: before.pipelineId,
    stageId: before.stageId,
    probability: before.probability,
    expectedCloseDate: before.expectedCloseDate,
    contactId: before.contactId,
    companyId: before.companyId,
    ownerId: before.ownerId,
    ...patch,
  };
  await updateDeal(ctx, id, toDealInput(merged));
  return serializeDeal(await readDeal(ctx, id));
}

export async function apiDeleteDeal(ctx: ServiceCtx, id: string) {
  await deleteDeal(ctx, id);
}

/* ---------------------------------------------------------------- tasks */

type TaskRow = typeof schema.tasks.$inferSelect;

export function serializeTask(t: TaskRow) {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    status: t.status,
    priority: t.priority,
    dueAt: t.dueAt,
    remindAt: t.remindAt,
    assigneeId: t.assigneeId,
    isTeamTask: t.isTeamTask,
    contactId: t.contactId,
    companyId: t.companyId,
    dealId: t.dealId,
    leadId: t.leadId,
    source: t.source,
    completedAt: t.completedAt,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

const taskListQuery = z.object({
  status: z.enum(TASK_STATUSES).optional(),
  assigneeId: z.uuid().optional(),
  contactId: z.uuid().optional(),
  dealId: z.uuid().optional(),
  dueBefore: z.iso.datetime({ offset: true }).optional(),
  dueAfter: z.iso.datetime({ offset: true }).optional(),
  ...page,
});

export async function apiListTasks(ctx: ServiceCtx, raw: Record<string, string>) {
  assertCan(ctx, "tasks.view");
  const q = taskListQuery.parse(raw);
  const t = schema.tasks;
  return ctx.run(async (tx) => {
    const where = and(
      eq(t.tenantId, ctx.tenantId),
      q.status ? eq(t.status, q.status) : undefined,
      q.assigneeId ? eq(t.assigneeId, q.assigneeId) : undefined,
      q.contactId ? eq(t.contactId, q.contactId) : undefined,
      q.dealId ? eq(t.dealId, q.dealId) : undefined,
      q.dueBefore ? lt(t.dueAt, new Date(q.dueBefore)) : undefined,
      q.dueAfter ? gte(t.dueAt, new Date(q.dueAfter)) : undefined,
    );
    const [{ total }] = await tx.select({ total: sql<number>`count(*)::int` }).from(t).where(where);
    const rows = await tx
      .select()
      .from(t)
      .where(where)
      .orderBy(sql`${t.dueAt} asc nulls last`, desc(t.createdAt), asc(t.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    return { data: rows.map(serializeTask), pagination: pagination(q.page, q.pageSize, total) };
  });
}

async function readTask(ctx: ServiceCtx, id: string) {
  return ctx.run((tx) => loadTask(tx, ctx.tenantId, id));
}

export async function apiGetTask(ctx: ServiceCtx, id: string) {
  assertCan(ctx, "tasks.view");
  return serializeTask(await readTask(ctx, id));
}

const taskBody = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().max(5000).nullable().optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  status: z.enum(["open", "in_progress"]).optional(),
  dueAt: z.iso.datetime({ offset: true }).nullable().optional(),
  assigneeId: z.uuid().nullable().optional(),
  isTeamTask: z.boolean().optional(),
  contactId: z.uuid().nullable().optional(),
  companyId: z.uuid().nullable().optional(),
  dealId: z.uuid().nullable().optional(),
  leadId: z.uuid().nullable().optional(),
}).strict();

/** The task service takes wall-clock input in the tenant zone (the form format). */
async function toTaskInput(ctx: ServiceCtx, b: z.infer<typeof taskBody>) {
  const tz = await ctx.run((tx) => tenantTimezone(tx, ctx.tenantId));
  return taskInputSchema.parse({ ...b, dueAt: b.dueAt ? toLocalInput(new Date(b.dueAt), tz) : null, reminder: b.dueAt ? "at_due" : "none" });
}

export async function apiCreateTask(ctx: ServiceCtx, body: unknown) {
  const task = await createTask(ctx, await toTaskInput(ctx, taskBody.parse(body)), { source: "api" });
  return serializeTask(await readTask(ctx, task.id));
}

const taskPatch = taskBody.partial().extend({ status: z.enum(TASK_STATUSES).optional() });

export async function apiUpdateTask(ctx: ServiceCtx, id: string, body: unknown) {
  const { status, ...patch } = taskPatch.parse(body);
  if (Object.keys(patch).length) {
    const before = await readTask(ctx, id);
    const merged = {
      title: before.title,
      description: before.description,
      priority: before.priority as (typeof TASK_PRIORITIES)[number],
      dueAt: before.dueAt?.toISOString() ?? null,
      assigneeId: before.assigneeId,
      isTeamTask: before.isTeamTask,
      contactId: before.contactId,
      companyId: before.companyId,
      dealId: before.dealId,
      leadId: before.leadId,
      ...patch,
      status: before.status === "in_progress" ? ("in_progress" as const) : ("open" as const),
    };
    await updateTask(ctx, id, await toTaskInput(ctx, merged));
  }
  if (status) await setTaskStatus(ctx, id, status);
  if (!status && !Object.keys(patch).length) throw new AppError("VALIDATION", "errors.validation");
  return serializeTask(await readTask(ctx, id));
}

export async function apiDeleteTask(ctx: ServiceCtx, id: string) {
  await deleteTask(ctx, id);
}

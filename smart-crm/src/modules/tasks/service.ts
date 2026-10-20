import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, lt, ne, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { schema, type Executor, type Tx } from "@/server/db";
import { assertCan, assertCanWrite, type ServiceCtx } from "@/server/context";
import { audit } from "@/server/audit";
import { emitEvent } from "@/server/events";
import { AppError } from "@/server/errors";
import { likePattern } from "@/modules/search/service";
import { assertEntityExists, recordActivity, type EntityRef } from "@/modules/crm/activities";
import { notify } from "@/modules/notifications/service";
import { addDays, dateKey, parseLocalInput, startOfDay } from "@/modules/calendar/tz";
import { REMINDER_OFFSET_MINUTES, type TaskInput, type TaskPriority, type TaskQuery, type TaskStatus } from "./schemas";

export type TaskRow = typeof schema.tasks.$inferSelect;

export type TaskListItem = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueAt: Date | null;
  remindAt: Date | null;
  isTeamTask: boolean;
  assigneeId: string | null;
  assigneeName: string | null;
  completedAt: Date | null;
  createdAt: Date;
  source: string;
  link: { kind: "contact" | "company" | "deal" | "lead"; id: string; name: string } | null;
};

const OPEN_STATUSES = ["open", "in_progress"];

/** The tenant's IANA zone (falls back to Asia/Jerusalem). */
export async function tenantTimezone(tx: Executor, tenantId: string): Promise<string> {
  const [row] = await tx.select({ tz: schema.tenants.timezone }).from(schema.tenants).where(eq(schema.tenants.id, tenantId));
  return row?.tz || "Asia/Jerusalem";
}

function rangeOfDay(key: string, tz: string) {
  return { start: startOfDay(key, tz), end: startOfDay(addDays(key, 1), tz) };
}

function listWhere(ctx: ServiceCtx, q: TaskQuery, tz: string, now: Date): SQL {
  const t = schema.tasks;
  const conds: (SQL | undefined)[] = [eq(t.tenantId, ctx.tenantId)];
  switch (q.tab) {
    case "mine":
      conds.push(inArray(t.status, OPEN_STATUSES), ctx.userId ? eq(t.assigneeId, ctx.userId) : sql`false`);
      break;
    case "team":
      conds.push(inArray(t.status, OPEN_STATUSES));
      break;
    case "overdue":
      conds.push(inArray(t.status, OPEN_STATUSES), isNotNull(t.dueAt), lt(t.dueAt, now));
      break;
    case "today": {
      const { start, end } = rangeOfDay(dateKey(now, tz), tz);
      conds.push(inArray(t.status, OPEN_STATUSES), gte(t.dueAt, start), lt(t.dueAt, end));
      break;
    }
    case "done":
      conds.push(eq(t.status, "done"));
      break;
  }
  if (q.priority) conds.push(eq(t.priority, q.priority));
  if (q.assignee === "me" && ctx.userId) conds.push(eq(t.assigneeId, ctx.userId));
  else if (q.assignee === "unassigned") conds.push(isNull(t.assigneeId));
  else if (q.assignee && /^[0-9a-f-]{36}$/i.test(q.assignee)) conds.push(eq(t.assigneeId, q.assignee));
  if (q.entity === "none") conds.push(sql`num_nonnulls(${t.contactId}, ${t.companyId}, ${t.dealId}, ${t.leadId}) = 0`);
  else if (q.entity) conds.push(isNotNull({ contact: t.contactId, company: t.companyId, deal: t.dealId, lead: t.leadId }[q.entity]));
  if (q.from) conds.push(gte(t.dueAt, startOfDay(q.from, tz)));
  if (q.to) conds.push(lt(t.dueAt, startOfDay(addDays(q.to, 1), tz)));
  if (q.q) conds.push(or(sql`lower(${t.title}) like ${likePattern(q.q)}`, sql`lower(coalesce(${t.description}, '')) like ${likePattern(q.q)}`));
  return and(...conds)!;
}

function orderFor(tab: TaskQuery["tab"]) {
  const t = schema.tasks;
  if (tab === "done") return [desc(t.completedAt), desc(t.id)];
  return [sql`${t.dueAt} asc nulls last`, sql`case ${t.priority} when 'urgent' then 0 when 'high' then 1 when 'medium' then 2 else 3 end`, desc(t.createdAt)];
}

const linkedContacts = alias(schema.contacts, "linked_contact");
const linkedCompanies = alias(schema.companies, "linked_company");
const linkedDeals = alias(schema.deals, "linked_deal");
const linkedLeads = alias(schema.leads, "linked_lead");

async function selectTasks(tx: Tx, where: SQL, order: SQL[] | ReturnType<typeof desc>[], limit: number, offset: number): Promise<TaskListItem[]> {
  const t = schema.tasks;
  const rows = await tx
    .select({
      t,
      assigneeName: schema.profiles.fullName,
      assigneeEmail: schema.profiles.email,
      contactFirst: linkedContacts.firstName,
      contactLast: linkedContacts.lastName,
      contactEmail: linkedContacts.email,
      contactPhone: linkedContacts.phone,
      companyName: linkedCompanies.name,
      dealTitle: linkedDeals.title,
      leadName: linkedLeads.fullName,
      leadEmail: linkedLeads.email,
    })
    .from(t)
    .leftJoin(schema.profiles, eq(schema.profiles.id, t.assigneeId))
    .leftJoin(linkedContacts, eq(linkedContacts.id, t.contactId))
    .leftJoin(linkedCompanies, eq(linkedCompanies.id, t.companyId))
    .leftJoin(linkedDeals, eq(linkedDeals.id, t.dealId))
    .leftJoin(linkedLeads, eq(linkedLeads.id, t.leadId))
    .where(where)
    .orderBy(...(order as SQL[]))
    .limit(limit)
    .offset(offset);
  return rows.map((r) => {
    const x = r.t;
    let link: TaskListItem["link"] = null;
    if (x.contactId) {
      const name = `${r.contactFirst ?? ""} ${r.contactLast ?? ""}`.trim() || r.contactEmail || r.contactPhone || "—";
      link = { kind: "contact", id: x.contactId, name };
    } else if (x.dealId) link = { kind: "deal", id: x.dealId, name: r.dealTitle ?? "—" };
    else if (x.companyId) link = { kind: "company", id: x.companyId, name: r.companyName ?? "—" };
    else if (x.leadId) link = { kind: "lead", id: x.leadId, name: r.leadName || r.leadEmail || "—" };
    return {
      id: x.id,
      title: x.title,
      description: x.description,
      status: x.status as TaskStatus,
      priority: x.priority as TaskPriority,
      dueAt: x.dueAt,
      remindAt: x.remindAt,
      isTeamTask: x.isTeamTask,
      assigneeId: x.assigneeId,
      assigneeName: r.assigneeName || r.assigneeEmail || null,
      completedAt: x.completedAt,
      createdAt: x.createdAt,
      source: x.source,
      link,
    };
  });
}

export async function listTasks(ctx: ServiceCtx, q: TaskQuery, now = new Date()): Promise<{ rows: TaskListItem[]; total: number; timezone: string }> {
  assertCan(ctx, "tasks.view");
  return ctx.run(async (tx) => {
    const tz = await tenantTimezone(tx, ctx.tenantId);
    const where = listWhere(ctx, q, tz, now);
    const [{ total }] = await tx.select({ total: count() }).from(schema.tasks).where(where);
    const rows = await selectTasks(tx, where, orderFor(q.tab), q.pageSize, (q.page - 1) * q.pageSize);
    return { rows, total, timezone: tz };
  });
}

/** Badge counters for the tasks tabs and navigation. */
export async function taskCounts(ctx: ServiceCtx, now = new Date()) {
  assertCan(ctx, "tasks.view");
  return ctx.run(async (tx) => {
    const tz = await tenantTimezone(tx, ctx.tenantId);
    const { start, end } = rangeOfDay(dateKey(now, tz), tz);
    const me = ctx.userId ?? "00000000-0000-0000-0000-000000000000";
    const [row] = await tx.execute<{ mine: number; overdue: number; today: number; mine_overdue: number }>(sql`
      select
        count(*) filter (where assignee_id = ${me})::int as mine,
        count(*) filter (where due_at < ${now.toISOString()}::timestamptz)::int as overdue,
        count(*) filter (where due_at >= ${start.toISOString()}::timestamptz and due_at < ${end.toISOString()}::timestamptz)::int as today,
        count(*) filter (where assignee_id = ${me} and due_at < ${now.toISOString()}::timestamptz)::int as mine_overdue
      from public.tasks
      where tenant_id = ${ctx.tenantId} and status in ('open', 'in_progress')`);
    return { mine: Number(row.mine), overdue: Number(row.overdue), today: Number(row.today), mineOverdue: Number(row.mine_overdue) };
  });
}

export async function loadTask(tx: Tx, tenantId: string, id: string): Promise<TaskRow> {
  const [row] = await tx.select().from(schema.tasks).where(and(eq(schema.tasks.id, id), eq(schema.tasks.tenantId, tenantId)));
  if (!row) throw new AppError("NOT_FOUND", "errors.notFound");
  return row;
}

export async function getTask(ctx: ServiceCtx, id: string) {
  assertCan(ctx, "tasks.view");
  return ctx.run(async (tx) => {
    await loadTask(tx, ctx.tenantId, id);
    const [item] = await selectTasks(tx, and(eq(schema.tasks.id, id), eq(schema.tasks.tenantId, ctx.tenantId))!, [desc(schema.tasks.createdAt)], 1, 0);
    return item;
  });
}

function linksOf(input: Pick<TaskInput, "contactId" | "companyId" | "dealId" | "leadId">): EntityRef {
  return { contactId: input.contactId, companyId: input.companyId, dealId: input.dealId, leadId: input.leadId };
}

async function assertLinks(tx: Tx, tenantId: string, input: Pick<TaskInput, "contactId" | "companyId" | "dealId" | "leadId">) {
  const checks: [("contact" | "company" | "deal" | "lead"), string | null][] = [
    ["contact", input.contactId],
    ["company", input.companyId],
    ["deal", input.dealId],
    ["lead", input.leadId],
  ];
  for (const [kind, id] of checks) {
    if (!id) continue;
    try {
      await assertEntityExists(tx, tenantId, kind, id);
    } catch {
      throw new AppError("VALIDATION", "errors.relatedMissing", { [`${kind}Id`]: ["errors.relatedMissing"] });
    }
  }
}

/** Assignee must be an active member; others can only be chosen with tasks.assign_others. */
async function resolveAssignee(tx: Tx, ctx: ServiceCtx, requested: string | null, current: string | null): Promise<string | null> {
  if (requested === current) return requested;
  // Without tasks.assign_others: only (re)assign to yourself, and never take a task away from someone else.
  if (!ctx.can("tasks.assign_others")) {
    const toOther = requested !== null && requested !== ctx.userId;
    const fromOther = current !== null && current !== ctx.userId;
    if (toOther || fromOther) throw new AppError("FORBIDDEN", "tasks.cannotAssignOthers", { assigneeId: ["tasks.cannotAssignOthers"] });
  }
  if (requested) {
    const [m] = await tx
      .select({ status: schema.memberships.status })
      .from(schema.memberships)
      .where(and(eq(schema.memberships.tenantId, ctx.tenantId), eq(schema.memberships.userId, requested)));
    if (!m || m.status !== "active") throw new AppError("VALIDATION", "errors.relatedMissing", { assigneeId: ["errors.relatedMissing"] });
  }
  return requested;
}

/** Converts wall-clock inputs in the tenant zone into UTC due/remind instants. */
export function computeSchedule(input: Pick<TaskInput, "dueAt" | "reminder" | "remindAt">, tz: string) {
  const dueAt = input.dueAt ? parseLocalInput(input.dueAt, tz) : null;
  if (input.dueAt && !dueAt) throw new AppError("VALIDATION", "errors.validation", { dueAt: ["validation.invalid"] });
  let remindAt: Date | null = null;
  if (input.reminder === "custom") {
    remindAt = input.remindAt ? parseLocalInput(input.remindAt, tz) : null;
    if (!remindAt) throw new AppError("VALIDATION", "errors.validation", { remindAt: ["validation.invalid"] });
  } else if (input.reminder !== "none") {
    if (!dueAt) throw new AppError("VALIDATION", "errors.validation", { reminder: ["tasks.reminderNeedsDue"] });
    remindAt = new Date(dueAt.getTime() - REMINDER_OFFSET_MINUTES[input.reminder] * 60_000);
  }
  return { dueAt, remindAt };
}

async function notifyAssignee(tx: Tx, ctx: ServiceCtx, task: TaskRow) {
  if (!task.assigneeId || task.assigneeId === ctx.userId) return;
  await notify(tx, {
    tenantId: ctx.tenantId,
    userId: task.assigneeId,
    type: "task_assigned",
    title: { he: `שויכה אליך משימה: ${task.title}`, en: `Task assigned to you: ${task.title}` },
    link: `/tasks?task=${task.id}`,
  });
}

export async function createTask(ctx: ServiceCtx, input: TaskInput, opts: { source?: "manual" | "ai" | "automation" | "api" } = {}) {
  assertCanWrite(ctx, "tasks.create");
  return ctx.run(async (tx) => {
    const tz = await tenantTimezone(tx, ctx.tenantId);
    const { dueAt, remindAt } = computeSchedule(input, tz);
    await assertLinks(tx, ctx.tenantId, input);
    // Personal tasks default to the creator; team tasks may stay unassigned.
    const requested = input.assigneeId ?? (input.isTeamTask || ctx.actorType !== "user" ? null : ctx.userId);
    const assigneeId = await resolveAssignee(tx, ctx, requested, ctx.userId);
    const [task] = await tx
      .insert(schema.tasks)
      .values({
        tenantId: ctx.tenantId,
        title: input.title,
        description: input.description,
        status: input.status,
        priority: input.priority,
        dueAt,
        remindAt,
        assigneeId,
        isTeamTask: input.isTeamTask,
        ...linksOf(input),
        source: opts.source ?? (ctx.actorType === "ai" ? "ai" : ctx.actorType === "automation" ? "automation" : ctx.actorType === "api_key" ? "api" : "manual"),
        createdBy: ctx.userId,
      })
      .returning();
    if (input.contactId || input.companyId || input.dealId || input.leadId) {
      await recordActivity(tx, ctx, { ...linksOf(input), type: "task_created", subject: task.title, metadata: { taskId: task.id } });
    }
    await audit(tx, ctx, { action: "task.created", entityType: "task", entityId: task.id, metadata: { assigneeId } });
    await emitEvent(tx, ctx, { type: "task.created", entityType: "task", entityId: task.id, data: { assigneeId, priority: task.priority, ...linksOf(input) } });
    await notifyAssignee(tx, ctx, task);
    return task;
  });
}

export async function updateTask(ctx: ServiceCtx, id: string, input: TaskInput) {
  assertCanWrite(ctx, "tasks.update");
  return ctx.run(async (tx) => {
    const before = await loadTask(tx, ctx.tenantId, id);
    const tz = await tenantTimezone(tx, ctx.tenantId);
    const { dueAt, remindAt } = computeSchedule(input, tz);
    await assertLinks(tx, ctx.tenantId, input);
    const assigneeId = await resolveAssignee(tx, ctx, input.assigneeId, before.assigneeId);
    const reminderChanged = (remindAt?.getTime() ?? null) !== (before.remindAt?.getTime() ?? null);
    const status = before.status === "done" || before.status === "canceled" ? before.status : input.status;
    const [task] = await tx
      .update(schema.tasks)
      .set({
        title: input.title,
        description: input.description,
        priority: input.priority,
        status,
        dueAt,
        remindAt,
        reminderSentAt: reminderChanged ? null : before.reminderSentAt,
        assigneeId,
        isTeamTask: input.isTeamTask,
        ...linksOf(input),
      })
      .where(and(eq(schema.tasks.id, id), eq(schema.tasks.tenantId, ctx.tenantId)))
      .returning();
    const changed = (["title", "priority", "status", "assigneeId", "contactId", "companyId", "dealId", "leadId"] as const).filter((k) => before[k] !== task[k]);
    if ((before.dueAt?.getTime() ?? null) !== (task.dueAt?.getTime() ?? null)) changed.push("dueAt" as never);
    await audit(tx, ctx, { action: "task.updated", entityType: "task", entityId: id, metadata: { changed } });
    if (task.assigneeId !== before.assigneeId) await notifyAssignee(tx, ctx, task);
    return task;
  });
}

/** Status transitions: complete / reopen / start / cancel. */
export async function setTaskStatus(ctx: ServiceCtx, id: string, status: TaskStatus) {
  assertCanWrite(ctx, "tasks.update");
  return ctx.run(async (tx) => {
    const before = await loadTask(tx, ctx.tenantId, id);
    if (before.status === status) return before;
    const done = status === "done";
    const [task] = await tx
      .update(schema.tasks)
      .set({ status, completedAt: done ? new Date() : null, completedBy: done ? ctx.userId : null })
      .where(and(eq(schema.tasks.id, id), eq(schema.tasks.tenantId, ctx.tenantId)))
      .returning();
    const links = { contactId: task.contactId, companyId: task.companyId, dealId: task.dealId, leadId: task.leadId };
    const hasLink = Boolean(links.contactId || links.companyId || links.dealId || links.leadId);
    if (done) {
      if (hasLink) await recordActivity(tx, ctx, { ...links, type: "task_completed", subject: task.title, metadata: { taskId: task.id } });
      await emitEvent(tx, ctx, { type: "task.completed", entityType: "task", entityId: task.id, data: { assigneeId: task.assigneeId, ...links } });
    }
    await audit(tx, ctx, { action: `task.status_${status}`, entityType: "task", entityId: id, metadata: { from: before.status } });
    return task;
  });
}

export async function deleteTask(ctx: ServiceCtx, id: string) {
  assertCanWrite(ctx, "tasks.delete");
  await ctx.run(async (tx) => {
    const task = await loadTask(tx, ctx.tenantId, id);
    await tx.delete(schema.tasks).where(and(eq(schema.tasks.id, id), eq(schema.tasks.tenantId, ctx.tenantId)));
    await audit(tx, ctx, { action: "task.deleted", entityType: "task", entityId: id, metadata: { title: task.title } });
  });
}

/** Tasks with a due date inside [from, to) for the calendar. */
export async function tasksInRange(ctx: ServiceCtx, from: Date, to: Date, opts: { assigneeId?: string | null } = {}) {
  assertCan(ctx, "tasks.view");
  return ctx.run((tx) =>
    selectTasks(
      tx,
      and(
        eq(schema.tasks.tenantId, ctx.tenantId),
        ne(schema.tasks.status, "canceled"),
        gte(schema.tasks.dueAt, from),
        lt(schema.tasks.dueAt, to),
        opts.assigneeId ? eq(schema.tasks.assigneeId, opts.assigneeId) : undefined,
      )!,
      [asc(schema.tasks.dueAt)],
      500,
      0,
    ),
  );
}

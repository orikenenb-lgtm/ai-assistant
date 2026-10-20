import { and, asc, eq, gt, lt } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { schema, type Tx } from "@/server/db";
import { assertCan, assertCanWrite, type ServiceCtx } from "@/server/context";
import { audit } from "@/server/audit";
import { AppError } from "@/server/errors";
import { assertEntityExists } from "@/modules/crm/activities";
import { tasksInRange, tenantTimezone, type TaskListItem } from "@/modules/tasks/service";
import type { EventInput } from "./schemas";
import { addDays, parseDateKey, parseLocalInput, startOfDay } from "./tz";

export type CalendarEventItem = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  ownerId: string | null;
  ownerName: string | null;
  contactId: string | null;
  contactName: string | null;
  companyId: string | null;
  companyName: string | null;
  dealId: string | null;
  dealTitle: string | null;
  externalProvider: string | null;
  createdBy: string | null;
};

const linkedContacts = alias(schema.contacts, "ev_contact");
const linkedCompanies = alias(schema.companies, "ev_company");
const linkedDeals = alias(schema.deals, "ev_deal");

async function selectEvents(tx: Tx, where: ReturnType<typeof and>): Promise<CalendarEventItem[]> {
  const e = schema.calendarEvents;
  const rows = await tx
    .select({
      e,
      ownerName: schema.profiles.fullName,
      contactFirst: linkedContacts.firstName,
      contactLast: linkedContacts.lastName,
      companyName: linkedCompanies.name,
      dealTitle: linkedDeals.title,
    })
    .from(e)
    .leftJoin(schema.profiles, eq(schema.profiles.id, e.ownerId))
    .leftJoin(linkedContacts, eq(linkedContacts.id, e.contactId))
    .leftJoin(linkedCompanies, eq(linkedCompanies.id, e.companyId))
    .leftJoin(linkedDeals, eq(linkedDeals.id, e.dealId))
    .where(where)
    .orderBy(asc(e.startsAt), asc(e.id))
    .limit(1000);
  return rows.map((r) => ({
    id: r.e.id,
    title: r.e.title,
    description: r.e.description,
    location: r.e.location,
    startsAt: r.e.startsAt,
    endsAt: r.e.endsAt,
    allDay: r.e.allDay,
    ownerId: r.e.ownerId,
    ownerName: r.ownerName,
    contactId: r.e.contactId,
    contactName: r.e.contactId ? `${r.contactFirst ?? ""} ${r.contactLast ?? ""}`.trim() || "—" : null,
    companyId: r.e.companyId,
    companyName: r.companyName,
    dealId: r.e.dealId,
    dealTitle: r.dealTitle,
    externalProvider: r.e.externalProvider,
    createdBy: r.e.createdBy,
  }));
}

/** Events overlapping [from, to) plus tasks due in it. */
export async function listCalendarRange(
  ctx: ServiceCtx,
  from: Date,
  to: Date,
  opts: { ownerId?: string | null } = {},
): Promise<{ events: CalendarEventItem[]; tasks: TaskListItem[] }> {
  assertCan(ctx, "calendar.view");
  if (to <= from) throw new AppError("VALIDATION", "errors.validation");
  if (to.getTime() - from.getTime() > 100 * 86_400_000) throw new AppError("VALIDATION", "calendar.rangeTooLong");
  const events = await ctx.run((tx) =>
    selectEvents(
      tx,
      and(
        eq(schema.calendarEvents.tenantId, ctx.tenantId),
        lt(schema.calendarEvents.startsAt, to),
        gt(schema.calendarEvents.endsAt, from),
        opts.ownerId ? eq(schema.calendarEvents.ownerId, opts.ownerId) : undefined,
      ),
    ),
  );
  const tasks = ctx.can("tasks.view") ? await tasksInRange(ctx, from, to, { assigneeId: opts.ownerId }) : [];
  return { events, tasks };
}

export async function loadEvent(tx: Tx, tenantId: string, id: string) {
  const [row] = await tx
    .select()
    .from(schema.calendarEvents)
    .where(and(eq(schema.calendarEvents.id, id), eq(schema.calendarEvents.tenantId, tenantId)));
  if (!row) throw new AppError("NOT_FOUND", "errors.notFound");
  return row;
}

/** Wall-clock input in the tenant zone → stored UTC range (all-day end is exclusive). */
export function eventRange(input: Pick<EventInput, "allDay" | "start" | "end">, tz: string): { startsAt: Date; endsAt: Date } {
  if (input.allDay) {
    if (!parseDateKey(input.start) || !parseDateKey(input.end)) throw new AppError("VALIDATION", "errors.validation", { start: ["validation.invalid"] });
    const startsAt = startOfDay(input.start, tz);
    const endsAt = startOfDay(addDays(input.end, 1), tz);
    if (endsAt <= startsAt) throw new AppError("VALIDATION", "errors.validation", { end: ["calendar.endBeforeStart"] });
    return { startsAt, endsAt };
  }
  const startsAt = parseLocalInput(input.start, tz);
  const endsAt = parseLocalInput(input.end, tz);
  if (!startsAt) throw new AppError("VALIDATION", "errors.validation", { start: ["validation.invalid"] });
  if (!endsAt) throw new AppError("VALIDATION", "errors.validation", { end: ["validation.invalid"] });
  if (endsAt < startsAt) throw new AppError("VALIDATION", "errors.validation", { end: ["calendar.endBeforeStart"] });
  if (endsAt.getTime() - startsAt.getTime() > 31 * 86_400_000) throw new AppError("VALIDATION", "errors.validation", { end: ["calendar.tooLong"] });
  return { startsAt, endsAt };
}

async function assertEventLinks(tx: Tx, ctx: ServiceCtx, input: EventInput) {
  for (const [kind, id] of [
    ["contact", input.contactId],
    ["company", input.companyId],
    ["deal", input.dealId],
  ] as const) {
    if (!id) continue;
    try {
      await assertEntityExists(tx, ctx.tenantId, kind, id);
    } catch {
      throw new AppError("VALIDATION", "errors.relatedMissing", { [`${kind}Id`]: ["errors.relatedMissing"] });
    }
  }
  if (input.ownerId) {
    const [m] = await tx
      .select({ status: schema.memberships.status })
      .from(schema.memberships)
      .where(and(eq(schema.memberships.tenantId, ctx.tenantId), eq(schema.memberships.userId, input.ownerId)));
    if (!m || m.status !== "active") throw new AppError("VALIDATION", "errors.relatedMissing", { ownerId: ["errors.relatedMissing"] });
  }
}

/** Event owners and creators edit their events; owners/managers edit any. */
function assertMayEdit(ctx: ServiceCtx, ev: { ownerId: string | null; createdBy: string | null }) {
  const elevated = ctx.role === "owner" || ctx.role === "manager" || ctx.actorType === "system" || ctx.actorType === "automation";
  if (!elevated && ev.ownerId !== ctx.userId && ev.createdBy !== ctx.userId) throw new AppError("FORBIDDEN", "errors.forbidden");
}

export async function createEvent(ctx: ServiceCtx, input: EventInput) {
  assertCanWrite(ctx, "calendar.manage");
  return ctx.run(async (tx) => {
    const tz = await tenantTimezone(tx, ctx.tenantId);
    const { startsAt, endsAt } = eventRange(input, tz);
    await assertEventLinks(tx, ctx, input);
    const ownerId = input.ownerId ?? ctx.userId;
    if (ownerId && ownerId !== ctx.userId && !(ctx.role === "owner" || ctx.role === "manager" || ctx.actorType !== "user")) {
      throw new AppError("FORBIDDEN", "errors.forbidden");
    }
    const [ev] = await tx
      .insert(schema.calendarEvents)
      .values({
        tenantId: ctx.tenantId,
        title: input.title,
        description: input.description,
        location: input.location,
        startsAt,
        endsAt,
        allDay: input.allDay,
        ownerId,
        contactId: input.contactId,
        companyId: input.companyId,
        dealId: input.dealId,
        createdBy: ctx.userId,
      })
      .returning();
    await audit(tx, ctx, { action: "calendar_event.created", entityType: "calendar_event", entityId: ev.id });
    return ev;
  });
}

export async function updateEvent(ctx: ServiceCtx, id: string, input: EventInput) {
  assertCanWrite(ctx, "calendar.manage");
  return ctx.run(async (tx) => {
    const before = await loadEvent(tx, ctx.tenantId, id);
    assertMayEdit(ctx, before);
    const tz = await tenantTimezone(tx, ctx.tenantId);
    const { startsAt, endsAt } = eventRange(input, tz);
    await assertEventLinks(tx, ctx, input);
    const [ev] = await tx
      .update(schema.calendarEvents)
      .set({
        title: input.title,
        description: input.description,
        location: input.location,
        startsAt,
        endsAt,
        allDay: input.allDay,
        ownerId: input.ownerId ?? before.ownerId,
        contactId: input.contactId,
        companyId: input.companyId,
        dealId: input.dealId,
      })
      .where(and(eq(schema.calendarEvents.id, id), eq(schema.calendarEvents.tenantId, ctx.tenantId)))
      .returning();
    await audit(tx, ctx, { action: "calendar_event.updated", entityType: "calendar_event", entityId: id });
    return ev;
  });
}

export async function deleteEvent(ctx: ServiceCtx, id: string) {
  assertCanWrite(ctx, "calendar.manage");
  await ctx.run(async (tx) => {
    const ev = await loadEvent(tx, ctx.tenantId, id);
    assertMayEdit(ctx, ev);
    await tx.delete(schema.calendarEvents).where(and(eq(schema.calendarEvents.id, id), eq(schema.calendarEvents.tenantId, ctx.tenantId)));
    await audit(tx, ctx, { action: "calendar_event.deleted", entityType: "calendar_event", entityId: id, metadata: { title: ev.title } });
  });
}

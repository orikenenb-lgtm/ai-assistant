import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { schema } from "@/server/db";
import { assertCan, type ServiceCtx } from "@/server/context";
import { AppError } from "@/server/errors";

/** Read models the AI features use. All reads run through ctx (RLS for users). */

export type TranscriptLine = { from: "customer" | "agent" | "bot"; text: string; at: Date };

export async function loadConversation(ctx: ServiceCtx, conversationId: string, limit = 40) {
  assertCan(ctx, "inbox.view");
  return ctx.run(async (tx) => {
    const [conv] = await tx
      .select({ c: schema.conversations, firstName: schema.contacts.firstName, lastName: schema.contacts.lastName, contactId: schema.contacts.id })
      .from(schema.conversations)
      .innerJoin(schema.contacts, eq(schema.contacts.id, schema.conversations.contactId))
      .where(and(eq(schema.conversations.id, conversationId), eq(schema.conversations.tenantId, ctx.tenantId)));
    if (!conv) throw new AppError("NOT_FOUND", "errors.notFound");
    const rows = await tx
      .select()
      .from(schema.messages)
      .where(and(eq(schema.messages.tenantId, ctx.tenantId), eq(schema.messages.conversationId, conversationId)))
      .orderBy(desc(schema.messages.createdAt))
      .limit(limit);
    const lines: TranscriptLine[] = rows.reverse().map((m) => ({
      from: m.direction === "inbound" ? "customer" : m.senderType === "ai" || m.senderType === "automation" ? "bot" : "agent",
      text: m.body ?? (m.template ? `[template ${(m.template as { name?: string }).name ?? ""}]` : `[${m.type}]`),
      at: m.createdAt,
    }));
    return {
      conversation: conv.c,
      contactId: conv.contactId,
      contactName: `${conv.firstName} ${conv.lastName}`.trim(),
      lines,
    };
  });
}

export function transcriptText(lines: TranscriptLine[]): string {
  return lines.map((l) => `[${l.from}] ${l.text}`).join("\n");
}

export async function loadContactContext(ctx: ServiceCtx, contactId: string) {
  assertCan(ctx, "contacts.view");
  return ctx.run(async (tx) => {
    const [c] = await tx
      .select()
      .from(schema.contacts)
      .where(and(eq(schema.contacts.id, contactId), eq(schema.contacts.tenantId, ctx.tenantId), isNull(schema.contacts.deletedAt)));
    if (!c) throw new AppError("NOT_FOUND", "errors.notFound");
    const activities = await tx
      .select({ type: schema.activities.type, subject: schema.activities.subject, body: schema.activities.body, at: schema.activities.occurredAt })
      .from(schema.activities)
      .where(and(eq(schema.activities.tenantId, ctx.tenantId), eq(schema.activities.contactId, contactId)))
      .orderBy(desc(schema.activities.occurredAt))
      .limit(20);
    const notes = await tx
      .select({ body: schema.notes.body, at: schema.notes.createdAt })
      .from(schema.notes)
      .where(and(eq(schema.notes.tenantId, ctx.tenantId), eq(schema.notes.contactId, contactId)))
      .orderBy(desc(schema.notes.createdAt))
      .limit(8);
    const deals = await tx
      .select({ id: schema.deals.id, title: schema.deals.title, valueCents: schema.deals.valueCents, currency: schema.deals.currency, status: schema.deals.status, stage: schema.pipelineStages.name, expectedClose: schema.deals.expectedCloseDate })
      .from(schema.deals)
      .innerJoin(schema.pipelineStages, eq(schema.pipelineStages.id, schema.deals.stageId))
      .where(and(eq(schema.deals.tenantId, ctx.tenantId), eq(schema.deals.contactId, contactId), isNull(schema.deals.deletedAt)))
      .orderBy(desc(schema.deals.updatedAt))
      .limit(10);
    const tasks = await tx
      .select({ title: schema.tasks.title, status: schema.tasks.status, dueAt: schema.tasks.dueAt })
      .from(schema.tasks)
      .where(and(eq(schema.tasks.tenantId, ctx.tenantId), eq(schema.tasks.contactId, contactId), inArray(schema.tasks.status, ["open", "in_progress"])))
      .orderBy(asc(schema.tasks.dueAt))
      .limit(10);
    return { contact: c, activities, notes, deals, tasks };
  });
}

export async function loadLead(ctx: ServiceCtx, leadId: string) {
  assertCan(ctx, "leads.view");
  return ctx.run(async (tx) => {
    const [l] = await tx
      .select()
      .from(schema.leads)
      .where(and(eq(schema.leads.id, leadId), eq(schema.leads.tenantId, ctx.tenantId), isNull(schema.leads.deletedAt)));
    if (!l) throw new AppError("NOT_FOUND", "errors.notFound");
    const activities = await tx
      .select({ type: schema.activities.type, subject: schema.activities.subject, body: schema.activities.body })
      .from(schema.activities)
      .where(and(eq(schema.activities.tenantId, ctx.tenantId), eq(schema.activities.leadId, leadId)))
      .orderBy(desc(schema.activities.occurredAt))
      .limit(10);
    return { lead: l, activities };
  });
}

export async function loadDeal(ctx: ServiceCtx, dealId: string) {
  assertCan(ctx, "deals.view");
  return ctx.run(async (tx) => {
    const [d] = await tx
      .select({ d: schema.deals, stage: schema.pipelineStages.name, probability: schema.pipelineStages.probability })
      .from(schema.deals)
      .innerJoin(schema.pipelineStages, eq(schema.pipelineStages.id, schema.deals.stageId))
      .where(and(eq(schema.deals.id, dealId), eq(schema.deals.tenantId, ctx.tenantId), isNull(schema.deals.deletedAt)));
    if (!d) throw new AppError("NOT_FOUND", "errors.notFound");
    const activities = await tx
      .select({ type: schema.activities.type, subject: schema.activities.subject, body: schema.activities.body, at: schema.activities.occurredAt })
      .from(schema.activities)
      .where(and(eq(schema.activities.tenantId, ctx.tenantId), eq(schema.activities.dealId, dealId)))
      .orderBy(desc(schema.activities.occurredAt))
      .limit(15);
    return { deal: d.d, stage: d.stage, stageProbability: d.probability, activities };
  });
}

/** Aggregates for trend analysis (tenant-scoped; agents only see their own deals). */
export async function salesStats(ctx: ServiceCtx, days: number) {
  assertCan(ctx, "analytics.view");
  const ownerFilter = ctx.role === "agent" && ctx.userId ? sql`and owner_id = ${ctx.userId}` : sql``;
  return ctx.run(async (tx) => {
    const [deals] = await tx.execute<{ won: number; won_value: string; lost: number; open: number; open_value: string; created: number }>(sql`
      select
        count(*) filter (where status = 'won' and won_at >= now() - make_interval(days => ${days}))::int as won,
        coalesce(sum(value_cents) filter (where status = 'won' and won_at >= now() - make_interval(days => ${days})), 0)::text as won_value,
        count(*) filter (where status = 'lost' and lost_at >= now() - make_interval(days => ${days}))::int as lost,
        count(*) filter (where status = 'open')::int as open,
        coalesce(sum(value_cents) filter (where status = 'open'), 0)::text as open_value,
        count(*) filter (where created_at >= now() - make_interval(days => ${days}))::int as created
      from public.deals where tenant_id = ${ctx.tenantId} and deleted_at is null ${ownerFilter}`);
    const prev = await tx.execute<{ won: number; won_value: string }>(sql`
      select count(*)::int as won, coalesce(sum(value_cents), 0)::text as won_value
      from public.deals where tenant_id = ${ctx.tenantId} and deleted_at is null and status = 'won'
        and won_at >= now() - make_interval(days => ${days * 2}) and won_at < now() - make_interval(days => ${days}) ${ownerFilter}`);
    const leadsBySource = await tx.execute<{ source: string; n: number; converted: number }>(sql`
      select source, count(*)::int as n, count(*) filter (where status = 'converted')::int as converted
      from public.leads where tenant_id = ${ctx.tenantId} and deleted_at is null and created_at >= now() - make_interval(days => ${days})
      group by source order by n desc`);
    const lostReasons = await tx.execute<{ label: string; n: number }>(sql`
      select coalesce(lr.label, '—') as label, count(*)::int as n from public.deals d
      left join public.lost_reasons lr on lr.id = d.lost_reason_id
      where d.tenant_id = ${ctx.tenantId} and d.status = 'lost' and d.lost_at >= now() - make_interval(days => ${days})
      group by 1 order by n desc limit 5`);
    return {
      days,
      won: deals?.won ?? 0,
      wonValueCents: Number(deals?.won_value ?? 0),
      lost: deals?.lost ?? 0,
      open: deals?.open ?? 0,
      openValueCents: Number(deals?.open_value ?? 0),
      created: deals?.created ?? 0,
      previousWon: prev[0]?.won ?? 0,
      previousWonValueCents: Number(prev[0]?.won_value ?? 0),
      leadsBySource: leadsBySource.map((r) => ({ source: r.source, leads: r.n, converted: r.converted })),
      lostReasons: lostReasons.map((r) => ({ reason: r.label, count: r.n })),
    };
  });
}

import { and, asc, count, desc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
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
import { LEAD_TRANSITIONS, type ConvertLeadInput, type LeadInput, type LeadListQuery, type LeadStatus } from "./schemas";
import { insertDeal } from "./deals";

export type LeadRow = typeof schema.leads.$inferSelect;
export type LeadListItem = {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  companyName: string | null;
  source: string;
  status: LeadStatus;
  score: number | null;
  aiClassification: string | null;
  ownerId: string | null;
  ownerName: string | null;
  estimatedValueCents: number | null;
  createdAt: Date;
  tags: TagView[];
};

export function leadDisplayName(l: { fullName: string; email?: string | null; phone?: string | null }) {
  return l.fullName || l.email || l.phone || "—";
}

function listWhere(ctx: ServiceCtx, q: Partial<LeadListQuery>): SQL {
  const conds: (SQL | undefined)[] = [eq(schema.leads.tenantId, ctx.tenantId), isNull(schema.leads.deletedAt)];
  if (q.q) {
    const p = likePattern(q.q);
    const digits = q.q.replace(/\D/g, "");
    conds.push(
      or(
        ilike(schema.leads.fullName, p),
        ilike(schema.leads.email, p),
        ilike(schema.leads.companyName, p),
        digits.length >= 4 ? sql`${schema.leads.phone} like ${`%${digits}%`}` : undefined,
      ),
    );
  }
  if (q.status) conds.push(eq(schema.leads.status, q.status));
  if (q.owner === "me" && ctx.userId) conds.push(eq(schema.leads.ownerId, ctx.userId));
  else if (q.owner === "unassigned") conds.push(isNull(schema.leads.ownerId));
  else if (q.owner && /^[0-9a-f-]{36}$/.test(q.owner)) conds.push(eq(schema.leads.ownerId, q.owner));
  if (q.source) conds.push(eq(schema.leads.source, q.source));
  if (q.ai) conds.push(eq(schema.leads.aiClassification, q.ai));
  return and(...conds)!;
}

const SORTS = {
  created_desc: [desc(schema.leads.createdAt)],
  created_asc: [asc(schema.leads.createdAt)],
  score_desc: [sql`${schema.leads.score} desc nulls last`, desc(schema.leads.createdAt)],
  name_asc: [asc(schema.leads.fullName)],
};

export async function listLeads(ctx: ServiceCtx, q: LeadListQuery) {
  assertCan(ctx, "leads.view");
  return ctx.run(async (tx) => {
    const where = listWhere(ctx, q);
    const [{ total }] = await tx.select({ total: count() }).from(schema.leads).where(where);
    const rows = await tx
      .select({ l: schema.leads, ownerName: schema.profiles.fullName })
      .from(schema.leads)
      .leftJoin(schema.profiles, eq(schema.profiles.id, schema.leads.ownerId))
      .where(where)
      .orderBy(...SORTS[q.sort], asc(schema.leads.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    const tags = await tagsFor(
      tx,
      "lead",
      rows.map((r) => r.l.id),
    );
    // Status counts for the tabs (ignoring the status filter itself).
    const counts = await tx
      .select({ status: schema.leads.status, n: count() })
      .from(schema.leads)
      .where(listWhere(ctx, { ...q, status: undefined }))
      .groupBy(schema.leads.status);
    return {
      total,
      statusCounts: Object.fromEntries(counts.map((c) => [c.status, Number(c.n)])) as Partial<Record<LeadStatus, number>>,
      rows: rows.map(
        ({ l, ownerName }): LeadListItem => ({
          id: l.id,
          fullName: l.fullName,
          email: l.email,
          phone: l.phone,
          companyName: l.companyName,
          source: l.source,
          status: l.status as LeadStatus,
          score: l.score,
          aiClassification: l.aiClassification,
          ownerId: l.ownerId,
          ownerName,
          estimatedValueCents: l.estimatedValueCents,
          createdAt: l.createdAt,
          tags: tags.get(l.id) ?? [],
        }),
      ),
    };
  });
}

export async function loadLead(tx: Tx, tenantId: string, id: string, opts: { forUpdate?: boolean } = {}): Promise<LeadRow> {
  const q = tx
    .select()
    .from(schema.leads)
    .where(and(eq(schema.leads.id, id), eq(schema.leads.tenantId, tenantId), isNull(schema.leads.deletedAt)));
  const [l] = opts.forUpdate ? await q.for("update") : await q;
  if (!l) throw new AppError("NOT_FOUND", "errors.notFound");
  return l;
}

export async function getLead(ctx: ServiceCtx, id: string) {
  assertCan(ctx, "leads.view");
  return ctx.run(async (tx) => {
    const lead = await loadLead(tx, ctx.tenantId, id);
    const [owner] = lead.ownerId
      ? await tx.select({ id: schema.profiles.id, fullName: schema.profiles.fullName }).from(schema.profiles).where(eq(schema.profiles.id, lead.ownerId))
      : [];
    const [contact] = lead.contactId
      ? await tx
          .select({ id: schema.contacts.id, firstName: schema.contacts.firstName, lastName: schema.contacts.lastName })
          .from(schema.contacts)
          .where(eq(schema.contacts.id, lead.contactId))
      : [];
    const [deal] = lead.convertedDealId
      ? await tx.select({ id: schema.deals.id, title: schema.deals.title }).from(schema.deals).where(eq(schema.deals.id, lead.convertedDealId))
      : [];
    const tags = (await tagsFor(tx, "lead", [lead.id])).get(lead.id) ?? [];
    const customFieldDefs = await listCustomFields(tx, ctx.tenantId, "lead");
    return {
      lead,
      owner: owner ?? null,
      contact: contact ? { id: contact.id, name: `${contact.firstName} ${contact.lastName}`.trim() } : null,
      deal: deal ?? null,
      tags,
      customFieldDefs,
    };
  });
}

async function notifyAssignment(tx: Tx, ctx: ServiceCtx, lead: LeadRow) {
  if (!lead.ownerId || lead.ownerId === ctx.userId) return;
  const name = leadDisplayName(lead);
  await notify(tx, {
    tenantId: ctx.tenantId,
    userId: lead.ownerId,
    type: "lead_assigned",
    title: { he: `הוקצה לך ליד חדש: ${name}`, en: `New lead assigned to you: ${name}` },
    link: `/leads/${lead.id}`,
  });
}

export async function createLead(ctx: ServiceCtx, input: LeadInput) {
  assertCanWrite(ctx, "leads.create");
  return ctx.run(async (tx) => {
    const defs = await listCustomFields(tx, ctx.tenantId, "lead");
    const customFields = validateCustomFields(defs, input.customFields);
    const [lead] = await tx
      .insert(schema.leads)
      .values({
        tenantId: ctx.tenantId,
        fullName: input.fullName,
        email: input.email,
        phone: input.phone,
        companyName: input.companyName,
        source: input.source,
        score: input.score,
        estimatedValueCents: input.estimatedValue,
        message: input.message,
        ownerId: input.ownerId ?? (ctx.actorType === "user" ? ctx.userId : null),
        customFields,
        createdBy: ctx.userId,
      })
      .returning();
    if (input.tagIds?.length) await replaceEntityTags(tx, ctx.tenantId, "lead", lead.id, input.tagIds);
    await recordActivity(tx, ctx, { type: "lead_created", leadId: lead.id, subject: leadDisplayName(lead) });
    await audit(tx, ctx, { action: "lead.created", entityType: "lead", entityId: lead.id, metadata: { source: lead.source } });
    await emitEvent(tx, ctx, { type: "lead.created", entityType: "lead", entityId: lead.id, data: { source: lead.source, ownerId: lead.ownerId } });
    await notifyAssignment(tx, ctx, lead);
    return lead;
  });
}

export async function updateLead(ctx: ServiceCtx, id: string, input: LeadInput) {
  assertCanWrite(ctx, "leads.update");
  return ctx.run(async (tx) => {
    const before = await loadLead(tx, ctx.tenantId, id);
    const defs = await listCustomFields(tx, ctx.tenantId, "lead");
    const customFields = { ...before.customFields, ...validateCustomFields(defs, input.customFields) };
    const [lead] = await tx
      .update(schema.leads)
      .set({
        fullName: input.fullName,
        email: input.email,
        phone: input.phone,
        companyName: input.companyName,
        source: input.source,
        score: input.score,
        estimatedValueCents: input.estimatedValue,
        message: input.message,
        ownerId: input.ownerId,
        customFields,
      })
      .where(eq(schema.leads.id, id))
      .returning();
    if (input.tagIds) await replaceEntityTags(tx, ctx.tenantId, "lead", id, input.tagIds);
    await audit(tx, ctx, { action: "lead.updated", entityType: "lead", entityId: id });
    if (lead.ownerId !== before.ownerId) await notifyAssignment(tx, ctx, lead);
    return lead;
  });
}

export async function setLeadStatus(ctx: ServiceCtx, id: string, status: Exclude<LeadStatus, "converted">, reason: string | null) {
  assertCanWrite(ctx, "leads.update");
  return ctx.run(async (tx) => {
    const before = await loadLead(tx, ctx.tenantId, id, { forUpdate: true });
    const from = before.status as LeadStatus;
    if (from === status) return before;
    if (!LEAD_TRANSITIONS[from].includes(status)) throw new AppError("VALIDATION", "leads.invalidTransition");
    if (status === "unqualified" && !reason) throw new AppError("VALIDATION", "errors.validation", { reason: ["leads.reasonRequired"] });
    const [lead] = await tx
      .update(schema.leads)
      .set({ status, unqualifiedReason: status === "unqualified" ? reason : null })
      .where(eq(schema.leads.id, id))
      .returning();
    await audit(tx, ctx, { action: "lead.status_changed", entityType: "lead", entityId: id, metadata: { from, to: status } });
    await emitEvent(tx, ctx, { type: "lead.status_changed", entityType: "lead", entityId: id, data: { from, to: status } });
    return lead;
  });
}

export async function deleteLead(ctx: ServiceCtx, id: string) {
  assertCanWrite(ctx, "leads.delete");
  await ctx.run(async (tx) => {
    await loadLead(tx, ctx.tenantId, id);
    await tx.update(schema.leads).set({ deletedAt: new Date() }).where(eq(schema.leads.id, id));
    await audit(tx, ctx, { action: "lead.deleted", entityType: "lead", entityId: id });
  });
}

function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  return { firstName: parts.shift() ?? "", lastName: parts.join(" ") };
}

/**
 * Converts a lead into a contact (reusing an existing one with the same phone or
 * email), optionally a company and a deal. Locks the lead row, so converting
 * twice (or concurrently) fails cleanly instead of duplicating records.
 */
export async function convertLead(ctx: ServiceCtx, input: ConvertLeadInput) {
  assertCanWrite(ctx, "leads.convert");
  if (input.createDeal) assertCanWrite(ctx, "deals.create");
  return ctx.run(async (tx) => {
    const lead = await loadLead(tx, ctx.tenantId, input.leadId, { forUpdate: true });
    if (lead.status === "converted") throw new AppError("CONFLICT", "leads.alreadyConverted");

    // Company: match by name (case-insensitive) or create.
    let companyId: string | null = null;
    if (input.createCompany && lead.companyName) {
      const [existing] = await tx
        .select({ id: schema.companies.id })
        .from(schema.companies)
        .where(and(eq(schema.companies.tenantId, ctx.tenantId), isNull(schema.companies.deletedAt), sql`lower(${schema.companies.name}) = lower(${lead.companyName})`))
        .limit(1);
      if (existing) companyId = existing.id;
      else {
        const [co] = await tx
          .insert(schema.companies)
          .values({ tenantId: ctx.tenantId, name: lead.companyName, ownerId: lead.ownerId, createdBy: ctx.userId })
          .returning({ id: schema.companies.id });
        companyId = co.id;
        await recordActivity(tx, ctx, { type: "company_created", companyId });
        await emitEvent(tx, ctx, { type: "company.created", entityType: "company", entityId: companyId, data: { source: "lead_conversion" } });
      }
    }

    // Contact: reuse by phone/email, else create.
    let contactId: string | null = null;
    let createdContact = false;
    if (lead.phone || lead.email) {
      const [existing] = await tx
        .select({ id: schema.contacts.id, companyId: schema.contacts.companyId })
        .from(schema.contacts)
        .where(
          and(
            eq(schema.contacts.tenantId, ctx.tenantId),
            isNull(schema.contacts.deletedAt),
            or(
              lead.phone ? eq(schema.contacts.phone, lead.phone) : undefined,
              lead.email ? sql`lower(${schema.contacts.email}) = lower(${lead.email})` : undefined,
            ),
          ),
        )
        .orderBy(asc(schema.contacts.createdAt))
        .limit(1);
      if (existing) {
        contactId = existing.id;
        if (!existing.companyId && companyId) await tx.update(schema.contacts).set({ companyId }).where(eq(schema.contacts.id, existing.id));
      }
    }
    if (!contactId) {
      const { firstName, lastName } = splitName(lead.fullName);
      const [c] = await tx
        .insert(schema.contacts)
        .values({
          tenantId: ctx.tenantId,
          firstName,
          lastName,
          email: lead.email,
          phone: lead.phone,
          source: lead.source,
          lifecycleStage: input.createDeal ? "opportunity" : "lead",
          companyId,
          ownerId: lead.ownerId,
          createdBy: ctx.userId,
        })
        .returning({ id: schema.contacts.id });
      contactId = c.id;
      createdContact = true;
      await recordActivity(tx, ctx, { type: "contact_created", contactId, companyId });
      await emitEvent(tx, ctx, { type: "contact.created", entityType: "contact", entityId: contactId, data: { source: "lead_conversion" } });
    }

    // Deal (optional).
    let dealId: string | null = null;
    if (input.createDeal) {
      const deal = await insertDeal(tx, ctx, {
        title: input.dealTitle || lead.companyName || leadDisplayName(lead),
        valueCents: input.dealValue ?? lead.estimatedValueCents ?? 0,
        currency: "ILS",
        pipelineId: input.pipelineId!,
        stageId: input.stageId!,
        probability: null,
        expectedCloseDate: null,
        contactId,
        companyId,
        ownerId: lead.ownerId,
        customFields: {},
        leadId: lead.id,
      });
      dealId = deal.id;
    }

    await tx
      .update(schema.leads)
      .set({ status: "converted", convertedAt: new Date(), contactId, convertedDealId: dealId })
      .where(eq(schema.leads.id, lead.id));
    await recordActivity(tx, ctx, { type: "lead_converted", leadId: lead.id, contactId, dealId, metadata: { createdContact, companyId } });
    await audit(tx, ctx, { action: "lead.converted", entityType: "lead", entityId: lead.id, metadata: { contactId, companyId, dealId, createdContact } });
    await emitEvent(tx, ctx, { type: "lead.converted", entityType: "lead", entityId: lead.id, data: { contactId, companyId, dealId } });
    return { contactId: contactId!, companyId, dealId, createdContact };
  });
}

export async function setLeadTags(ctx: ServiceCtx, leadId: string, tagIds: string[]) {
  assertCanWrite(ctx, "leads.update");
  await ctx.run(async (tx) => {
    await loadLead(tx, ctx.tenantId, leadId);
    await replaceEntityTags(tx, ctx.tenantId, "lead", leadId, tagIds);
  });
}

import { and, asc, count, desc, eq, inArray, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { schema, type Tx } from "@/server/db";
import { assertCan, assertCanWrite, type ServiceCtx } from "@/server/context";
import { audit } from "@/server/audit";
import { emitEvent } from "@/server/events";
import { AppError } from "@/server/errors";
import { likePattern } from "@/modules/search/service";
import { getEntitlements } from "@/modules/billing/entitlements";
import type { ContactInput, ListQuery } from "../schemas";
import { listCustomFields, validateCustomFields } from "../custom-fields";
import { replaceEntityTags, tagsFor, type TagView } from "../tags";
import { recordActivity } from "../activities";

export type ContactRow = typeof schema.contacts.$inferSelect;

export type ContactListItem = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  lifecycleStage: string;
  whatsappConsent: string;
  companyId: string | null;
  companyName: string | null;
  ownerId: string | null;
  ownerName: string | null;
  lastActivityAt: Date | null;
  createdAt: Date;
  tags: TagView[];
};

export function contactDisplayName(c: { firstName: string; lastName: string; email?: string | null; phone?: string | null }) {
  return `${c.firstName} ${c.lastName}`.trim() || c.email || c.phone || "—";
}

function listWhere(ctx: ServiceCtx, q: ListQuery): SQL {
  const conds: (SQL | undefined)[] = [eq(schema.contacts.tenantId, ctx.tenantId), isNull(schema.contacts.deletedAt)];
  if (q.q) {
    const digits = q.q.replace(/\D/g, "");
    conds.push(
      or(
        sql`${schema.contacts.searchText} like ${likePattern(q.q)}`,
        digits.length >= 4 ? sql`${schema.contacts.phone} like ${`%${digits}%`}` : undefined,
      ),
    );
  }
  if (q.owner === "me" && ctx.userId) conds.push(eq(schema.contacts.ownerId, ctx.userId));
  else if (q.owner === "unassigned") conds.push(isNull(schema.contacts.ownerId));
  else if (q.owner && /^[0-9a-f-]{36}$/.test(q.owner)) conds.push(eq(schema.contacts.ownerId, q.owner));
  if (q.stage) conds.push(eq(schema.contacts.lifecycleStage, q.stage));
  if (q.company) conds.push(eq(schema.contacts.companyId, q.company));
  if (q.consent) conds.push(eq(schema.contacts.whatsappConsent, q.consent));
  if (q.tag) {
    conds.push(
      sql`exists (select 1 from public.contact_tags ct where ct.contact_id = ${schema.contacts.id} and ct.tag_id = ${q.tag})`,
    );
  }
  return and(...conds)!;
}

const SORTS = {
  created_desc: [desc(schema.contacts.createdAt)],
  created_asc: [asc(schema.contacts.createdAt)],
  name_asc: [asc(schema.contacts.firstName), asc(schema.contacts.lastName)],
  activity_desc: [sql`${schema.contacts.lastActivityAt} desc nulls last`, desc(schema.contacts.createdAt)],
};

export async function listContacts(ctx: ServiceCtx, q: ListQuery): Promise<{ rows: ContactListItem[]; total: number }> {
  assertCan(ctx, "contacts.view");
  return ctx.run(async (tx) => {
    const where = listWhere(ctx, q);
    const [{ total }] = await tx.select({ total: count() }).from(schema.contacts).where(where);
    const rows = await tx
      .select({ c: schema.contacts, companyName: schema.companies.name, ownerName: schema.profiles.fullName })
      .from(schema.contacts)
      .leftJoin(schema.companies, eq(schema.companies.id, schema.contacts.companyId))
      .leftJoin(schema.profiles, eq(schema.profiles.id, schema.contacts.ownerId))
      .where(where)
      .orderBy(...SORTS[q.sort], asc(schema.contacts.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    const tags = await tagsFor(
      tx,
      "contact",
      rows.map((r) => r.c.id),
    );
    return {
      total,
      rows: rows.map((r) => ({
        id: r.c.id,
        firstName: r.c.firstName,
        lastName: r.c.lastName,
        email: r.c.email,
        phone: r.c.phone,
        lifecycleStage: r.c.lifecycleStage,
        whatsappConsent: r.c.whatsappConsent,
        companyId: r.c.companyId,
        companyName: r.companyName,
        ownerId: r.c.ownerId,
        ownerName: r.ownerName,
        lastActivityAt: r.c.lastActivityAt,
        createdAt: r.c.createdAt,
        tags: tags.get(r.c.id) ?? [],
      })),
    };
  });
}

export async function loadContact(tx: Tx, tenantId: string, id: string): Promise<ContactRow> {
  const [c] = await tx
    .select()
    .from(schema.contacts)
    .where(and(eq(schema.contacts.id, id), eq(schema.contacts.tenantId, tenantId), isNull(schema.contacts.deletedAt)));
  if (!c) throw new AppError("NOT_FOUND", "errors.notFound");
  return c;
}

export async function getContact(ctx: ServiceCtx, id: string) {
  assertCan(ctx, "contacts.view");
  return ctx.run(async (tx) => {
    const c = await loadContact(tx, ctx.tenantId, id);
    const [company] = c.companyId
      ? await tx.select({ id: schema.companies.id, name: schema.companies.name }).from(schema.companies).where(eq(schema.companies.id, c.companyId))
      : [];
    const [owner] = c.ownerId
      ? await tx.select({ id: schema.profiles.id, fullName: schema.profiles.fullName }).from(schema.profiles).where(eq(schema.profiles.id, c.ownerId))
      : [];
    const tags = (await tagsFor(tx, "contact", [c.id])).get(c.id) ?? [];
    const customFieldDefs = await listCustomFields(tx, ctx.tenantId, "contact");
    const [counts] = await tx.execute<{ deals: number; open_tasks: number; conversations: number }>(sql`
      select
        (select count(*)::int from public.deals d where d.contact_id = ${c.id} and d.deleted_at is null) as deals,
        (select count(*)::int from public.tasks t where t.contact_id = ${c.id} and t.status in ('open','in_progress')) as open_tasks,
        (select count(*)::int from public.conversations cv where cv.contact_id = ${c.id}) as conversations`);
    return { contact: c, company: company ?? null, owner: owner ?? null, tags, customFieldDefs, counts };
  });
}

async function assertCompanyInTenant(tx: Tx, tenantId: string, companyId: string | null) {
  if (!companyId) return;
  const [row] = await tx
    .select({ id: schema.companies.id })
    .from(schema.companies)
    .where(and(eq(schema.companies.id, companyId), eq(schema.companies.tenantId, tenantId), isNull(schema.companies.deletedAt)));
  if (!row) throw new AppError("VALIDATION", "errors.relatedMissing", { companyId: ["errors.relatedMissing"] });
}

async function assertContactQuota(tx: Tx, tenantId: string, adding = 1) {
  const ent = await getEntitlements(tx, tenantId);
  const max = ent.limits.max_contacts;
  if (max === undefined) return;
  const [{ n }] = await tx
    .select({ n: count() })
    .from(schema.contacts)
    .where(and(eq(schema.contacts.tenantId, tenantId), isNull(schema.contacts.deletedAt)));
  if (n + adding > max) throw new AppError("QUOTA_EXCEEDED", "errors.quotaExceeded", undefined, { limit: max });
}

export async function createContact(ctx: ServiceCtx, input: ContactInput) {
  assertCanWrite(ctx, "contacts.create");
  return ctx.run(async (tx) => {
    await assertContactQuota(tx, ctx.tenantId);
    await assertCompanyInTenant(tx, ctx.tenantId, input.companyId);
    const defs = await listCustomFields(tx, ctx.tenantId, "contact");
    const customFields = validateCustomFields(defs, input.customFields);
    const [c] = await tx
      .insert(schema.contacts)
      .values({
        tenantId: ctx.tenantId,
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        phone: input.phone,
        title: input.title,
        source: input.source,
        lifecycleStage: input.lifecycleStage,
        companyId: input.companyId,
        ownerId: input.ownerId ?? (ctx.actorType === "user" ? ctx.userId : null),
        customFields,
        createdBy: ctx.userId,
      })
      .returning();
    if (input.tagIds?.length) await replaceEntityTags(tx, ctx.tenantId, "contact", c.id, input.tagIds);
    await recordActivity(tx, ctx, { type: "contact_created", contactId: c.id, companyId: c.companyId });
    await audit(tx, ctx, { action: "contact.created", entityType: "contact", entityId: c.id });
    await emitEvent(tx, ctx, { type: "contact.created", entityType: "contact", entityId: c.id, data: { source: c.source, lifecycleStage: c.lifecycleStage } });
    return c;
  });
}

export async function updateContact(ctx: ServiceCtx, id: string, input: ContactInput) {
  assertCanWrite(ctx, "contacts.update");
  return ctx.run(async (tx) => {
    const before = await loadContact(tx, ctx.tenantId, id);
    await assertCompanyInTenant(tx, ctx.tenantId, input.companyId);
    const defs = await listCustomFields(tx, ctx.tenantId, "contact");
    const customFields = { ...before.customFields, ...validateCustomFields(defs, input.customFields) };
    const [c] = await tx
      .update(schema.contacts)
      .set({
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        phone: input.phone,
        title: input.title,
        source: input.source,
        lifecycleStage: input.lifecycleStage,
        companyId: input.companyId,
        ownerId: input.ownerId,
        customFields,
      })
      .where(and(eq(schema.contacts.id, id), eq(schema.contacts.tenantId, ctx.tenantId)))
      .returning();
    let addedTags: string[] = [];
    if (input.tagIds) addedTags = await replaceEntityTags(tx, ctx.tenantId, "contact", id, input.tagIds);
    const changed = (["firstName", "lastName", "email", "phone", "lifecycleStage", "companyId", "ownerId"] as const).filter(
      (k) => before[k] !== c[k],
    );
    await audit(tx, ctx, { action: "contact.updated", entityType: "contact", entityId: id, metadata: { changed } });
    await emitEvent(tx, ctx, {
      type: "contact.updated",
      entityType: "contact",
      entityId: id,
      data: { changed, lifecycleStage: c.lifecycleStage, previousLifecycleStage: before.lifecycleStage },
    });
    for (const tagId of addedTags) {
      await emitEvent(tx, ctx, { type: "contact.tag_added", entityType: "contact", entityId: id, data: { tagId } });
    }
    return c;
  });
}

/** Soft delete (recoverable by support). Permanent erasure is a privacy request. */
export async function deleteContact(ctx: ServiceCtx, id: string) {
  assertCanWrite(ctx, "contacts.delete");
  await ctx.run(async (tx) => {
    await loadContact(tx, ctx.tenantId, id);
    await tx.update(schema.contacts).set({ deletedAt: new Date() }).where(and(eq(schema.contacts.id, id), eq(schema.contacts.tenantId, ctx.tenantId)));
    await audit(tx, ctx, { action: "contact.deleted", entityType: "contact", entityId: id });
  });
}

/* ------------------------------------------------------------ duplicates */

export type DuplicateCandidate = { id: string; name: string; email: string | null; phone: string | null; matchedOn: ("email" | "phone")[] };

/** Existing contacts sharing the email or phone (used while typing a new contact). */
export async function findDuplicateCandidates(
  ctx: ServiceCtx,
  input: { email?: string | null; phone?: string | null; excludeId?: string },
): Promise<DuplicateCandidate[]> {
  assertCan(ctx, "contacts.view");
  if (!input.email && !input.phone) return [];
  return ctx.run(async (tx) => {
    const rows = await tx
      .select()
      .from(schema.contacts)
      .where(
        and(
          eq(schema.contacts.tenantId, ctx.tenantId),
          isNull(schema.contacts.deletedAt),
          input.excludeId ? ne(schema.contacts.id, input.excludeId) : undefined,
          or(
            input.email ? sql`lower(${schema.contacts.email}) = ${input.email.toLowerCase()}` : undefined,
            input.phone ? eq(schema.contacts.phone, input.phone) : undefined,
          ),
        ),
      )
      .limit(5);
    return rows.map((c) => ({
      id: c.id,
      name: contactDisplayName(c),
      email: c.email,
      phone: c.phone,
      matchedOn: [
        ...(input.email && c.email?.toLowerCase() === input.email.toLowerCase() ? (["email"] as const) : []),
        ...(input.phone && c.phone === input.phone ? (["phone"] as const) : []),
      ],
    }));
  });
}

export type DuplicateGroup = { key: string; matchedOn: "email" | "phone"; contacts: { id: string; name: string; email: string | null; phone: string | null; createdAt: Date }[] };

/** Groups of active contacts sharing a phone number or email address. */
export async function listDuplicateGroups(ctx: ServiceCtx, limit = 50): Promise<DuplicateGroup[]> {
  assertCan(ctx, "contacts.merge");
  return ctx.run(async (tx) => {
    const groups = await tx.execute<{ kind: "email" | "phone"; key: string; ids: string[] }>(sql`
      select 'phone' as kind, phone as key, array_agg(id order by created_at) as ids
        from public.contacts where tenant_id = ${ctx.tenantId} and deleted_at is null and phone is not null
        group by phone having count(*) > 1
      union all
      select 'email', lower(email), array_agg(id order by created_at)
        from public.contacts where tenant_id = ${ctx.tenantId} and deleted_at is null and email is not null
        group by lower(email) having count(*) > 1
      limit ${limit}`);
    const ids = [...new Set(groups.flatMap((g) => g.ids))];
    if (!ids.length) return [];
    const contacts = await tx.select().from(schema.contacts).where(inArray(schema.contacts.id, ids));
    const byId = new Map(contacts.map((c) => [c.id, c]));
    return groups.map((g) => ({
      key: `${g.kind}:${g.key}`,
      matchedOn: g.kind,
      contacts: g.ids
        .map((id) => byId.get(id))
        .filter(Boolean)
        .map((c) => ({ id: c!.id, name: contactDisplayName(c!), email: c!.email, phone: c!.phone, createdAt: c!.createdAt })),
    }));
  });
}

/**
 * Merges `duplicateId` into `primaryId`: re-points every related record, fills
 * the primary's empty fields, unions tags and soft-deletes the duplicate.
 */
export async function mergeContacts(ctx: ServiceCtx, primaryId: string, duplicateId: string) {
  assertCanWrite(ctx, "contacts.merge");
  if (primaryId === duplicateId) throw new AppError("VALIDATION", "contacts.mergeSame");
  return ctx.run(async (tx) => {
    const primary = await loadContact(tx, ctx.tenantId, primaryId);
    const dup = await loadContact(tx, ctx.tenantId, duplicateId);
    const t = ctx.tenantId;
    const moveSimple = async (table: string) =>
      tx.execute(sql`update ${sql.identifier(table)} set contact_id = ${primaryId} where tenant_id = ${t} and contact_id = ${duplicateId}`);
    for (const table of ["deals", "notes", "tasks", "activities", "attachments", "contact_consents", "leads", "quotes", "calendar_events"]) {
      await moveSimple(table);
    }
    // Tags: union.
    await tx.execute(sql`
      insert into public.contact_tags (tenant_id, contact_id, tag_id)
      select tenant_id, ${primaryId}, tag_id from public.contact_tags where contact_id = ${duplicateId}
      on conflict do nothing`);
    await tx.execute(sql`delete from public.contact_tags where contact_id = ${duplicateId}`);
    // Conversations are unique per (account, contact): fold messages into the primary's thread.
    const dupConvs = await tx.select().from(schema.conversations).where(and(eq(schema.conversations.tenantId, t), eq(schema.conversations.contactId, duplicateId)));
    for (const conv of dupConvs) {
      const [existing] = await tx
        .select()
        .from(schema.conversations)
        .where(and(eq(schema.conversations.whatsappAccountId, conv.whatsappAccountId), eq(schema.conversations.contactId, primaryId)));
      if (existing) {
        await tx.execute(sql`update public.messages set conversation_id = ${existing.id} where tenant_id = ${t} and conversation_id = ${conv.id}`);
        await tx.execute(sql`update public.conversation_notes set conversation_id = ${existing.id} where tenant_id = ${t} and conversation_id = ${conv.id}`);
        await tx.execute(sql`update public.tasks set conversation_id = ${existing.id} where tenant_id = ${t} and conversation_id = ${conv.id}`);
        await tx.delete(schema.conversations).where(eq(schema.conversations.id, conv.id));
      } else {
        await tx.update(schema.conversations).set({ contactId: primaryId }).where(eq(schema.conversations.id, conv.id));
      }
    }
    const fill = <K extends keyof ContactRow>(k: K) => (primary[k] === null || primary[k] === "" ? dup[k] : primary[k]);
    // Opt-out always wins: never resurrect consent by merging.
    const consent = primary.whatsappConsent === "opted_out" || dup.whatsappConsent === "opted_out" ? "opted_out" : fill("whatsappConsent");
    await tx
      .update(schema.contacts)
      .set({
        firstName: fill("firstName"),
        lastName: fill("lastName"),
        email: fill("email"),
        phone: fill("phone"),
        title: fill("title"),
        source: fill("source"),
        companyId: fill("companyId"),
        ownerId: fill("ownerId"),
        whatsappConsent: consent,
        customFields: { ...dup.customFields, ...primary.customFields },
      })
      .where(eq(schema.contacts.id, primaryId));
    await tx.update(schema.contacts).set({ deletedAt: new Date() }).where(eq(schema.contacts.id, duplicateId));
    await recordActivity(tx, ctx, { type: "merged", contactId: primaryId, metadata: { mergedId: duplicateId, mergedName: contactDisplayName(dup) } });
    await audit(tx, ctx, { action: "contact.merged", entityType: "contact", entityId: primaryId, metadata: { duplicateId } });
    return { primaryId };
  });
}

/* --------------------------------------------------------------- consent */

export async function setWhatsappConsent(
  ctx: ServiceCtx,
  contactId: string,
  input: { status: "opted_in" | "opted_out"; source: "manual" | "import" | "inbound_keyword" | "form" | "api" | "automation"; evidence?: string | null },
) {
  assertCanWrite(ctx, "inbox.consent");
  await ctx.run((tx) => recordConsent(tx, ctx, contactId, input));
}

/** Shared by the UI and the inbound-keyword handler. */
export async function recordConsent(
  tx: Tx,
  ctx: ServiceCtx,
  contactId: string,
  input: { status: "opted_in" | "opted_out"; source: "manual" | "import" | "inbound_keyword" | "form" | "api" | "automation"; evidence?: string | null },
) {
  const c = await loadContact(tx, ctx.tenantId, contactId);
  if (c.whatsappConsent === input.status) return;
  await tx.update(schema.contacts).set({ whatsappConsent: input.status, consentUpdatedAt: new Date() }).where(eq(schema.contacts.id, contactId));
  await tx.insert(schema.contactConsents).values({
    tenantId: ctx.tenantId,
    contactId,
    channel: "whatsapp",
    status: input.status,
    source: input.source,
    evidence: input.evidence ?? null,
    recordedBy: ctx.userId,
  });
  await recordActivity(tx, ctx, { type: "consent_changed", contactId, metadata: { status: input.status, source: input.source } });
  await audit(tx, ctx, { action: `contact.consent_${input.status}`, entityType: "contact", entityId: contactId, metadata: { source: input.source } });
}

export async function consentHistory(ctx: ServiceCtx, contactId: string) {
  assertCan(ctx, "contacts.view");
  return ctx.run((tx) =>
    tx
      .select({ c: schema.contactConsents, by: schema.profiles.fullName })
      .from(schema.contactConsents)
      .leftJoin(schema.profiles, eq(schema.profiles.id, schema.contactConsents.recordedBy))
      .where(and(eq(schema.contactConsents.tenantId, ctx.tenantId), eq(schema.contactConsents.contactId, contactId)))
      .orderBy(desc(schema.contactConsents.createdAt)),
  );
}

/** Replaces a contact's tags (emits contact.tag_added for each new tag). */
export async function setContactTags(ctx: ServiceCtx, contactId: string, tagIds: string[]) {
  assertCanWrite(ctx, "contacts.update");
  await ctx.run(async (tx) => {
    await loadContact(tx, ctx.tenantId, contactId);
    const added = await replaceEntityTags(tx, ctx.tenantId, "contact", contactId, tagIds);
    for (const tagId of added) await emitEvent(tx, ctx, { type: "contact.tag_added", entityType: "contact", entityId: contactId, data: { tagId } });
  });
}

import { and, asc, count, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { schema, type Tx } from "@/server/db";
import { assertCan, assertCanWrite, type ServiceCtx } from "@/server/context";
import { audit } from "@/server/audit";
import { emitEvent } from "@/server/events";
import { AppError } from "@/server/errors";
import { likePattern } from "@/modules/search/service";
import type { CompanyInput } from "../schemas";
import { listCustomFields, validateCustomFields } from "../custom-fields";
import { replaceEntityTags, tagsFor, type TagView } from "../tags";
import { recordActivity } from "../activities";

export const companyListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  owner: z.string().max(40).optional(),
  tag: z.uuid().optional(),
  sort: z.enum(["name_asc", "created_desc", "activity_desc"]).default("name_asc"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(25),
});
export type CompanyListQuery = z.infer<typeof companyListQuerySchema>;

export type CompanyRow = typeof schema.companies.$inferSelect;
export type CompanyListItem = {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  city: string | null;
  phone: string | null;
  ownerId: string | null;
  ownerName: string | null;
  contactsCount: number;
  openDealsCount: number;
  lastActivityAt: Date | null;
  createdAt: Date;
  tags: TagView[];
};

function listWhere(ctx: ServiceCtx, q: Partial<CompanyListQuery>): SQL {
  const conds: (SQL | undefined)[] = [eq(schema.companies.tenantId, ctx.tenantId), isNull(schema.companies.deletedAt)];
  if (q.q) conds.push(sql`${schema.companies.searchText} like ${likePattern(q.q)}`);
  if (q.owner === "me" && ctx.userId) conds.push(eq(schema.companies.ownerId, ctx.userId));
  else if (q.owner === "unassigned") conds.push(isNull(schema.companies.ownerId));
  else if (q.owner && /^[0-9a-f-]{36}$/.test(q.owner)) conds.push(eq(schema.companies.ownerId, q.owner));
  if (q.tag) conds.push(sql`exists (select 1 from public.company_tags ct where ct.company_id = ${schema.companies.id} and ct.tag_id = ${q.tag})`);
  return and(...conds)!;
}

const SORTS = {
  name_asc: [asc(schema.companies.name)],
  created_desc: [desc(schema.companies.createdAt)],
  activity_desc: [sql`${schema.companies.lastActivityAt} desc nulls last`, asc(schema.companies.name)],
};

export async function listCompanies(ctx: ServiceCtx, q: CompanyListQuery): Promise<{ rows: CompanyListItem[]; total: number }> {
  assertCan(ctx, "companies.view");
  return ctx.run(async (tx) => {
    const where = listWhere(ctx, q);
    const [{ total }] = await tx.select({ total: count() }).from(schema.companies).where(where);
    const rows = await tx
      .select({
        c: schema.companies,
        ownerName: schema.profiles.fullName,
        contactsCount: sql<number>`(select count(*)::int from public.contacts ct where ct.company_id = ${schema.companies.id} and ct.deleted_at is null)`,
        openDealsCount: sql<number>`(select count(*)::int from public.deals d where d.company_id = ${schema.companies.id} and d.deleted_at is null and d.status = 'open')`,
      })
      .from(schema.companies)
      .leftJoin(schema.profiles, eq(schema.profiles.id, schema.companies.ownerId))
      .where(where)
      .orderBy(...SORTS[q.sort], asc(schema.companies.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    const tags = await tagsFor(
      tx,
      "company",
      rows.map((r) => r.c.id),
    );
    return {
      total,
      rows: rows.map((r) => ({
        id: r.c.id,
        name: r.c.name,
        domain: r.c.domain,
        industry: r.c.industry,
        city: r.c.city,
        phone: r.c.phone,
        ownerId: r.c.ownerId,
        ownerName: r.ownerName,
        contactsCount: Number(r.contactsCount),
        openDealsCount: Number(r.openDealsCount),
        lastActivityAt: r.c.lastActivityAt,
        createdAt: r.c.createdAt,
        tags: tags.get(r.c.id) ?? [],
      })),
    };
  });
}

export async function loadCompany(tx: Tx, tenantId: string, id: string): Promise<CompanyRow> {
  const [c] = await tx
    .select()
    .from(schema.companies)
    .where(and(eq(schema.companies.id, id), eq(schema.companies.tenantId, tenantId), isNull(schema.companies.deletedAt)));
  if (!c) throw new AppError("NOT_FOUND", "errors.notFound");
  return c;
}

export async function getCompany(ctx: ServiceCtx, id: string) {
  assertCan(ctx, "companies.view");
  return ctx.run(async (tx) => {
    const company = await loadCompany(tx, ctx.tenantId, id);
    const [owner] = company.ownerId
      ? await tx.select({ id: schema.profiles.id, fullName: schema.profiles.fullName }).from(schema.profiles).where(eq(schema.profiles.id, company.ownerId))
      : [];
    const tags = (await tagsFor(tx, "company", [company.id])).get(company.id) ?? [];
    const customFieldDefs = await listCustomFields(tx, ctx.tenantId, "company");
    const contacts = await tx
      .select({
        id: schema.contacts.id,
        firstName: schema.contacts.firstName,
        lastName: schema.contacts.lastName,
        title: schema.contacts.title,
        email: schema.contacts.email,
        phone: schema.contacts.phone,
      })
      .from(schema.contacts)
      .where(and(eq(schema.contacts.tenantId, ctx.tenantId), eq(schema.contacts.companyId, id), isNull(schema.contacts.deletedAt)))
      .orderBy(asc(schema.contacts.firstName))
      .limit(100);
    const deals = await tx
      .select({
        id: schema.deals.id,
        title: schema.deals.title,
        valueCents: schema.deals.valueCents,
        currency: schema.deals.currency,
        status: schema.deals.status,
        stage: schema.pipelineStages.name,
      })
      .from(schema.deals)
      .innerJoin(schema.pipelineStages, eq(schema.pipelineStages.id, schema.deals.stageId))
      .where(and(eq(schema.deals.tenantId, ctx.tenantId), eq(schema.deals.companyId, id), isNull(schema.deals.deletedAt)))
      .orderBy(desc(schema.deals.createdAt))
      .limit(50);
    return { company, owner: owner ?? null, tags, customFieldDefs, contacts, deals };
  });
}

export async function createCompany(ctx: ServiceCtx, input: CompanyInput) {
  assertCanWrite(ctx, "companies.create");
  return ctx.run(async (tx) => {
    const defs = await listCustomFields(tx, ctx.tenantId, "company");
    const customFields = validateCustomFields(defs, input.customFields);
    const [c] = await tx
      .insert(schema.companies)
      .values({
        tenantId: ctx.tenantId,
        name: input.name,
        domain: input.domain,
        industry: input.industry,
        sizeRange: input.sizeRange ?? null,
        phone: input.phone,
        email: input.email,
        website: input.website,
        address: input.address,
        city: input.city,
        country: input.country ?? null,
        ownerId: input.ownerId ?? (ctx.actorType === "user" ? ctx.userId : null),
        customFields,
        createdBy: ctx.userId,
      })
      .returning();
    if (input.tagIds?.length) await replaceEntityTags(tx, ctx.tenantId, "company", c.id, input.tagIds);
    await recordActivity(tx, ctx, { type: "company_created", companyId: c.id });
    await audit(tx, ctx, { action: "company.created", entityType: "company", entityId: c.id });
    await emitEvent(tx, ctx, { type: "company.created", entityType: "company", entityId: c.id, data: { name: c.name } });
    return c;
  });
}

export async function updateCompany(ctx: ServiceCtx, id: string, input: CompanyInput) {
  assertCanWrite(ctx, "companies.update");
  return ctx.run(async (tx) => {
    const before = await loadCompany(tx, ctx.tenantId, id);
    const defs = await listCustomFields(tx, ctx.tenantId, "company");
    const customFields = { ...before.customFields, ...validateCustomFields(defs, input.customFields) };
    const [c] = await tx
      .update(schema.companies)
      .set({
        name: input.name,
        domain: input.domain,
        industry: input.industry,
        sizeRange: input.sizeRange ?? null,
        phone: input.phone,
        email: input.email,
        website: input.website,
        address: input.address,
        city: input.city,
        country: input.country ?? null,
        ownerId: input.ownerId,
        customFields,
      })
      .where(eq(schema.companies.id, id))
      .returning();
    if (input.tagIds) await replaceEntityTags(tx, ctx.tenantId, "company", id, input.tagIds);
    const changed = (["name", "ownerId", "phone", "email"] as const).filter((k) => before[k] !== c[k]);
    await audit(tx, ctx, { action: "company.updated", entityType: "company", entityId: id, metadata: { changed } });
    return c;
  });
}

/** Soft delete; contacts keep existing but are unlinked from the company. */
export async function deleteCompany(ctx: ServiceCtx, id: string) {
  assertCanWrite(ctx, "companies.delete");
  await ctx.run(async (tx) => {
    await loadCompany(tx, ctx.tenantId, id);
    await tx.update(schema.companies).set({ deletedAt: new Date() }).where(eq(schema.companies.id, id));
    await tx.update(schema.contacts).set({ companyId: null }).where(and(eq(schema.contacts.tenantId, ctx.tenantId), eq(schema.contacts.companyId, id)));
    await audit(tx, ctx, { action: "company.deleted", entityType: "company", entityId: id });
  });
}

export async function setCompanyTags(ctx: ServiceCtx, companyId: string, tagIds: string[]) {
  assertCanWrite(ctx, "companies.update");
  await ctx.run(async (tx) => {
    await loadCompany(tx, ctx.tenantId, companyId);
    await replaceEntityTags(tx, ctx.tenantId, "company", companyId, tagIds);
  });
}

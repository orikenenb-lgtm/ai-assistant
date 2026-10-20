import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@/server/db";
import { assertCan, type ServiceCtx } from "@/server/context";
import { AppError } from "@/server/errors";
import { contactInputSchema, listQuerySchema } from "@/modules/crm/schemas";
import { createContact, deleteContact, getContact, listContacts, updateContact, type ContactListItem } from "@/modules/crm/contacts/service";
import { likePattern } from "@/modules/search/service";
import { pagination } from "./framework";

/* ------------------------------------------------------------- contacts */

export function serializeContactListItem(c: ContactListItem) {
  return {
    id: c.id,
    firstName: c.firstName,
    lastName: c.lastName,
    email: c.email,
    phone: c.phone,
    lifecycleStage: c.lifecycleStage,
    whatsappConsent: c.whatsappConsent,
    companyId: c.companyId,
    companyName: c.companyName,
    ownerId: c.ownerId,
    tags: c.tags.map((t) => ({ id: t.id, name: t.name })),
    lastActivityAt: c.lastActivityAt,
    createdAt: c.createdAt,
  };
}

export async function apiGetContact(ctx: ServiceCtx, id: string) {
  const { contact: c, tags } = await getContact(ctx, id);
  return {
    id: c.id,
    firstName: c.firstName,
    lastName: c.lastName,
    email: c.email,
    phone: c.phone,
    title: c.title,
    source: c.source,
    lifecycleStage: c.lifecycleStage,
    whatsappConsent: c.whatsappConsent,
    companyId: c.companyId,
    ownerId: c.ownerId,
    customFields: c.customFields,
    tags: tags.map((t) => ({ id: t.id, name: t.name })),
    lastActivityAt: c.lastActivityAt,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

export const apiContactListQuery = listQuerySchema.pick({ q: true, stage: true, tag: true, company: true, consent: true, sort: true, page: true }).extend({
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  owner: z.uuid().optional(),
});

export async function apiListContacts(ctx: ServiceCtx, raw: Record<string, string>) {
  const q = apiContactListQuery.parse(raw);
  const { rows, total } = await listContacts(ctx, { ...q, pageSize: q.pageSize });
  return { data: rows.map(serializeContactListItem), pagination: pagination(q.page, q.pageSize, total) };
}

export async function apiCreateContact(ctx: ServiceCtx, body: unknown) {
  const input = contactInputSchema.parse(body);
  const c = await createContact(ctx, input);
  return apiGetContact(ctx, c.id);
}

/** Fields accepted by PATCH (all optional; omitted fields keep their value). */
export const contactPatchSchema = z
  .object({
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    email: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
    source: z.string().nullable().optional(),
    lifecycleStage: z.string().optional(),
    companyId: z.string().nullable().optional(),
    ownerId: z.string().nullable().optional(),
    customFields: z.record(z.string(), z.unknown()).optional(),
    tagIds: z.array(z.string()).optional(),
  })
  .strict();

export async function apiUpdateContact(ctx: ServiceCtx, id: string, body: unknown) {
  const patch = contactPatchSchema.parse(body);
  const { contact: c, tags } = await getContact(ctx, id);
  const merged = contactInputSchema.parse({
    firstName: c.firstName,
    lastName: c.lastName,
    email: c.email,
    phone: c.phone,
    title: c.title,
    source: c.source,
    lifecycleStage: c.lifecycleStage,
    companyId: c.companyId,
    ownerId: c.ownerId,
    tagIds: tags.map((t) => t.id),
    ...patch,
    // Unspecified custom fields keep their stored values.
    customFields: { ...c.customFields, ...(patch.customFields ?? {}) },
  });
  await updateContact(ctx, id, merged);
  return apiGetContact(ctx, id);
}

export async function apiDeleteContact(ctx: ServiceCtx, id: string) {
  await deleteContact(ctx, id);
}

/* ------------------------------------------------------------ companies */

const companyListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

function serializeCompany(c: typeof schema.companies.$inferSelect) {
  return {
    id: c.id,
    name: c.name,
    domain: c.domain,
    industry: c.industry,
    sizeRange: c.sizeRange,
    phone: c.phone,
    email: c.email,
    website: c.website,
    address: c.address,
    city: c.city,
    country: c.country,
    ownerId: c.ownerId,
    customFields: c.customFields,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

export async function apiListCompanies(ctx: ServiceCtx, raw: Record<string, string>) {
  assertCan(ctx, "companies.view");
  const q = companyListQuery.parse(raw);
  return ctx.run(async (tx) => {
    const where = and(
      eq(schema.companies.tenantId, ctx.tenantId),
      isNull(schema.companies.deletedAt),
      q.q ? sql`${schema.companies.searchText} like ${likePattern(q.q)}` : undefined,
    );
    const [{ total }] = await tx.select({ total: sql<number>`count(*)::int` }).from(schema.companies).where(where);
    const rows = await tx
      .select()
      .from(schema.companies)
      .where(where)
      .orderBy(desc(schema.companies.createdAt), asc(schema.companies.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    return { data: rows.map(serializeCompany), pagination: pagination(q.page, q.pageSize, total) };
  });
}

export async function apiGetCompany(ctx: ServiceCtx, id: string) {
  assertCan(ctx, "companies.view");
  return ctx.run(async (tx) => {
    const [c] = await tx
      .select()
      .from(schema.companies)
      .where(and(eq(schema.companies.id, id), eq(schema.companies.tenantId, ctx.tenantId), isNull(schema.companies.deletedAt)));
    if (!c) throw new AppError("NOT_FOUND", "errors.notFound");
    return serializeCompany(c);
  });
}

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { schema, type Tx } from "@/server/db";
import { assertCan, assertCanWrite, type ServiceCtx } from "@/server/context";
import { audit } from "@/server/audit";
import { AppError, isUniqueViolation } from "@/server/errors";

export type TagView = { id: string; name: string; color: string };

export const TAG_COLORS = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#8b5cf6", "#64748b"];

export const tagInputSchema = z.object({
  name: z.string().trim().min(1).max(40),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#6366f1"),
});

export async function listTags(ctx: ServiceCtx): Promise<TagView[]> {
  return ctx.run((tx) =>
    tx
      .select({ id: schema.tags.id, name: schema.tags.name, color: schema.tags.color })
      .from(schema.tags)
      .where(eq(schema.tags.tenantId, ctx.tenantId))
      .orderBy(asc(schema.tags.name)),
  );
}

export async function createTag(ctx: ServiceCtx, input: z.infer<typeof tagInputSchema>): Promise<TagView> {
  assertCanWrite(ctx, "contacts.update");
  try {
    return await ctx.run(async (tx) => {
      const [tag] = await tx.insert(schema.tags).values({ tenantId: ctx.tenantId, ...input }).returning();
      await audit(tx, ctx, { action: "tag.created", entityType: "tag", entityId: tag.id, metadata: { name: tag.name } });
      return { id: tag.id, name: tag.name, color: tag.color };
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new AppError("CONFLICT", "tags.exists");
    throw e;
  }
}

export async function updateTag(ctx: ServiceCtx, id: string, input: z.infer<typeof tagInputSchema>) {
  assertCanWrite(ctx, "settings.manage");
  await ctx.run(async (tx) => {
    const [tag] = await tx
      .update(schema.tags)
      .set(input)
      .where(and(eq(schema.tags.id, id), eq(schema.tags.tenantId, ctx.tenantId)))
      .returning();
    if (!tag) throw new AppError("NOT_FOUND", "errors.notFound");
    await audit(tx, ctx, { action: "tag.updated", entityType: "tag", entityId: id });
  });
}

export async function deleteTag(ctx: ServiceCtx, id: string) {
  assertCanWrite(ctx, "settings.manage");
  await ctx.run(async (tx) => {
    const [tag] = await tx.delete(schema.tags).where(and(eq(schema.tags.id, id), eq(schema.tags.tenantId, ctx.tenantId))).returning();
    if (!tag) throw new AppError("NOT_FOUND", "errors.notFound");
    await audit(tx, ctx, { action: "tag.deleted", entityType: "tag", entityId: id, metadata: { name: tag.name } });
  });
}

/** Validates that every tag id belongs to the tenant (RLS + explicit check). */
export async function assertTagsBelong(tx: Tx, tenantId: string, tagIds: string[]) {
  if (!tagIds.length) return;
  const rows = await tx
    .select({ id: schema.tags.id })
    .from(schema.tags)
    .where(and(eq(schema.tags.tenantId, tenantId), inArray(schema.tags.id, tagIds)));
  if (rows.length !== new Set(tagIds).size) throw new AppError("VALIDATION", "errors.relatedMissing");
}

type TagJoin = typeof schema.contactTags | typeof schema.companyTags | typeof schema.dealTags | typeof schema.leadTags;

/** Replaces the tag set of an entity; returns the newly added tag ids. */
export async function replaceEntityTags(
  tx: Tx,
  tenantId: string,
  entity: "contact" | "company" | "deal" | "lead",
  entityId: string,
  tagIds: string[],
): Promise<string[]> {
  await assertTagsBelong(tx, tenantId, tagIds);
  const table: TagJoin = { contact: schema.contactTags, company: schema.companyTags, deal: schema.dealTags, lead: schema.leadTags }[entity];
  const col = {
    contact: schema.contactTags.contactId,
    company: schema.companyTags.companyId,
    deal: schema.dealTags.dealId,
    lead: schema.leadTags.leadId,
  }[entity];
  const current = (await tx.select({ tagId: table.tagId }).from(table).where(eq(col, entityId))).map((r) => r.tagId);
  const wanted = [...new Set(tagIds)];
  const toAdd = wanted.filter((t) => !current.includes(t));
  const toRemove = current.filter((t) => !wanted.includes(t));
  if (toRemove.length) await tx.delete(table).where(and(eq(col, entityId), inArray(table.tagId, toRemove)));
  if (toAdd.length) {
    const key = { contact: "contactId", company: "companyId", deal: "dealId", lead: "leadId" }[entity];
    await tx.insert(table).values(toAdd.map((tagId) => ({ tenantId, tagId, [key]: entityId })) as never);
  }
  return toAdd;
}

/** Tags for many entities at once: Map<entityId, TagView[]>. */
export async function tagsFor(tx: Tx, entity: "contact" | "company" | "deal" | "lead", ids: string[]): Promise<Map<string, TagView[]>> {
  const map = new Map<string, TagView[]>();
  if (!ids.length) return map;
  const join = { contact: schema.contactTags, company: schema.companyTags, deal: schema.dealTags, lead: schema.leadTags }[entity];
  const col = {
    contact: schema.contactTags.contactId,
    company: schema.companyTags.companyId,
    deal: schema.dealTags.dealId,
    lead: schema.leadTags.leadId,
  }[entity];
  const rows = await tx
    .select({ entityId: col, id: schema.tags.id, name: schema.tags.name, color: schema.tags.color })
    .from(join)
    .innerJoin(schema.tags, eq(schema.tags.id, join.tagId))
    .where(inArray(col, ids))
    .orderBy(asc(schema.tags.name));
  for (const r of rows) {
    const list = map.get(r.entityId) ?? [];
    list.push({ id: r.id, name: r.name, color: r.color });
    map.set(r.entityId, list);
  }
  return map;
}

export async function tagUsageCounts(ctx: ServiceCtx) {
  assertCan(ctx, "contacts.view");
  return ctx.run(async (tx) => {
    const rows = await tx.execute<{ tag_id: string; n: number }>(sql`
      select tag_id, count(*)::int as n from (
        select tag_id from public.contact_tags where tenant_id = ${ctx.tenantId}
        union all select tag_id from public.company_tags where tenant_id = ${ctx.tenantId}
        union all select tag_id from public.deal_tags where tenant_id = ${ctx.tenantId}
        union all select tag_id from public.lead_tags where tenant_id = ${ctx.tenantId}
      ) t group by tag_id`);
    return new Map(rows.map((r) => [r.tag_id, Number(r.n)]));
  });
}

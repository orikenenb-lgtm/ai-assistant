import { and, asc, desc, eq, ne } from "drizzle-orm";
import { schema, type Executor } from "@/server/db";
import { assertCan, assertCanWrite, type ServiceCtx } from "@/server/context";
import { audit } from "@/server/audit";
import { AppError } from "@/server/errors";
import type { TemplateInput } from "./schemas";

export type DocumentTemplate = typeof schema.documentTemplates.$inferSelect;

export const DEFAULT_TAX_RATE_BP = 1800; // Israeli VAT 18% (since 2025-01-01)

export async function listTemplates(ctx: ServiceCtx): Promise<DocumentTemplate[]> {
  assertCan(ctx, "documents.view");
  return ctx.run((tx) =>
    tx
      .select()
      .from(schema.documentTemplates)
      .where(and(eq(schema.documentTemplates.tenantId, ctx.tenantId), eq(schema.documentTemplates.kind, "quote")))
      .orderBy(desc(schema.documentTemplates.isDefault), asc(schema.documentTemplates.name)),
  );
}

/** The tenant's default quote template (or any template, or null). */
export async function defaultTemplate(tx: Executor, tenantId: string): Promise<DocumentTemplate | null> {
  const [row] = await tx
    .select()
    .from(schema.documentTemplates)
    .where(and(eq(schema.documentTemplates.tenantId, tenantId), eq(schema.documentTemplates.kind, "quote")))
    .orderBy(desc(schema.documentTemplates.isDefault), asc(schema.documentTemplates.createdAt))
    .limit(1);
  return row ?? null;
}

async function clearDefault(tx: Executor, tenantId: string, exceptId?: string) {
  await tx
    .update(schema.documentTemplates)
    .set({ isDefault: false })
    .where(
      and(
        eq(schema.documentTemplates.tenantId, tenantId),
        eq(schema.documentTemplates.isDefault, true),
        exceptId ? ne(schema.documentTemplates.id, exceptId) : undefined,
      ),
    );
}

export async function createTemplate(ctx: ServiceCtx, input: TemplateInput) {
  assertCanWrite(ctx, "documents.templates");
  return ctx.run(async (tx) => {
    const hasAny = Boolean(await defaultTemplate(tx, ctx.tenantId));
    const makeDefault = input.isDefault || !hasAny;
    if (makeDefault) await clearDefault(tx, ctx.tenantId);
    const [row] = await tx
      .insert(schema.documentTemplates)
      .values({ tenantId: ctx.tenantId, kind: "quote", ...input, isDefault: makeDefault })
      .returning();
    await audit(tx, ctx, { action: "document_template.created", entityType: "document_template", entityId: row.id });
    return row;
  });
}

export async function updateTemplate(ctx: ServiceCtx, id: string, input: TemplateInput) {
  assertCanWrite(ctx, "documents.templates");
  return ctx.run(async (tx) => {
    const [current] = await tx
      .select()
      .from(schema.documentTemplates)
      .where(and(eq(schema.documentTemplates.id, id), eq(schema.documentTemplates.tenantId, ctx.tenantId)));
    if (!current) throw new AppError("NOT_FOUND", "errors.notFound");
    // A default template can only lose its flag by making another one default.
    const isDefault = current.isDefault || input.isDefault;
    if (input.isDefault && !current.isDefault) await clearDefault(tx, ctx.tenantId, id);
    const [row] = await tx
      .update(schema.documentTemplates)
      .set({ ...input, isDefault })
      .where(eq(schema.documentTemplates.id, id))
      .returning();
    await audit(tx, ctx, { action: "document_template.updated", entityType: "document_template", entityId: id });
    return row;
  });
}

export async function deleteTemplate(ctx: ServiceCtx, id: string) {
  assertCanWrite(ctx, "documents.templates");
  await ctx.run(async (tx) => {
    const [current] = await tx
      .select()
      .from(schema.documentTemplates)
      .where(and(eq(schema.documentTemplates.id, id), eq(schema.documentTemplates.tenantId, ctx.tenantId)));
    if (!current) throw new AppError("NOT_FOUND", "errors.notFound");
    if (current.isDefault) throw new AppError("VALIDATION", "documents.cannotDeleteDefault");
    await tx.delete(schema.documentTemplates).where(eq(schema.documentTemplates.id, id));
    await audit(tx, ctx, { action: "document_template.deleted", entityType: "document_template", entityId: id, metadata: { name: current.name } });
  });
}

/* ------------------------------------------------- tenant document settings */

export function taxRateFromSettings(settings: Record<string, unknown> | null | undefined): number {
  const v = settings?.defaultTaxRateBp;
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 10_000 ? v : DEFAULT_TAX_RATE_BP;
}

export async function getDocumentSettings(ctx: ServiceCtx) {
  assertCan(ctx, "documents.view");
  return ctx.run(async (tx) => {
    const [t] = await tx.select({ settings: schema.tenants.settings, currency: schema.tenants.currency }).from(schema.tenants).where(eq(schema.tenants.id, ctx.tenantId));
    return { defaultTaxRateBp: taxRateFromSettings(t?.settings), currency: t?.currency ?? "ILS" };
  });
}

/** Stored in tenants.settings.defaultTaxRateBp (shared key with organization settings). */
export async function updateDocumentSettings(ctx: ServiceCtx, input: { defaultTaxRateBp: number }) {
  assertCanWrite(ctx, "documents.templates");
  await ctx.run(async (tx) => {
    const [t] = await tx.select({ settings: schema.tenants.settings }).from(schema.tenants).where(eq(schema.tenants.id, ctx.tenantId));
    if (!t) throw new AppError("NOT_FOUND", "errors.notFound");
    const rows = await tx
      .update(schema.tenants)
      .set({ settings: { ...(t.settings ?? {}), defaultTaxRateBp: input.defaultTaxRateBp } })
      .where(eq(schema.tenants.id, ctx.tenantId))
      .returning({ id: schema.tenants.id });
    if (!rows.length) throw new AppError("FORBIDDEN", "errors.forbidden");
    await audit(tx, ctx, { action: "documents.settings_updated", entityType: "tenant", entityId: ctx.tenantId, metadata: input });
  });
}

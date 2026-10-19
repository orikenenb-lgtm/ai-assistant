import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { schema, type Executor } from "@/server/db";
import { assertCan, assertCanWrite, type ServiceCtx } from "@/server/context";
import { audit } from "@/server/audit";
import { AppError } from "@/server/errors";
import { normalizePhone } from "@/lib/phone";
import { assertFeature, getEntitlements } from "@/modules/billing/entitlements";

export const CUSTOM_FIELD_TYPES = ["text", "textarea", "number", "date", "boolean", "select", "multiselect", "url", "email", "phone"] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];
export type CustomFieldEntity = "contact" | "company" | "deal" | "lead";

export type CustomFieldDef = {
  id: string;
  entityType: CustomFieldEntity;
  key: string;
  label: string;
  fieldType: CustomFieldType;
  options: string[];
  required: boolean;
  position: number;
};

export const customFieldDefSchema = z
  .object({
    entityType: z.enum(["contact", "company", "deal", "lead"]),
    label: z.string().trim().min(1).max(80),
    key: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]{0,39}$/)
      .optional(),
    fieldType: z.enum(CUSTOM_FIELD_TYPES),
    options: z.array(z.string().trim().min(1).max(80)).max(100).default([]),
    required: z.boolean().default(false),
  })
  .refine((v) => !["select", "multiselect"].includes(v.fieldType) || v.options.length > 0, {
    path: ["options"],
    message: "customFields.optionsRequired",
  });

export async function listCustomFields(tx: Executor, tenantId: string, entityType: CustomFieldEntity): Promise<CustomFieldDef[]> {
  const rows = await tx
    .select()
    .from(schema.customFieldDefinitions)
    .where(
      and(
        eq(schema.customFieldDefinitions.tenantId, tenantId),
        eq(schema.customFieldDefinitions.entityType, entityType),
        isNull(schema.customFieldDefinitions.archivedAt),
      ),
    )
    .orderBy(asc(schema.customFieldDefinitions.position), asc(schema.customFieldDefinitions.label));
  return rows.map((r) => ({
    id: r.id,
    entityType: r.entityType as CustomFieldEntity,
    key: r.key,
    label: r.label,
    fieldType: r.fieldType as CustomFieldType,
    options: (r.options as string[]) ?? [],
    required: r.required,
    position: r.position,
  }));
}

/**
 * Validates and normalizes custom field values against the tenant's
 * definitions. Unknown keys are dropped; values are coerced to canonical types.
 */
export function validateCustomFields(defs: CustomFieldDef[], values: Record<string, unknown>, opts: { partial?: boolean } = {}) {
  const out: Record<string, unknown> = {};
  const errors: Record<string, string[]> = {};
  for (const def of defs) {
    const raw = values[def.key];
    const empty = raw === undefined || raw === null || raw === "" || (Array.isArray(raw) && raw.length === 0);
    if (empty) {
      if (def.required && !opts.partial) errors[`customFields.${def.key}`] = ["validation.required"];
      continue;
    }
    const fail = (msg = "validation.invalid") => (errors[`customFields.${def.key}`] = [msg]);
    switch (def.fieldType) {
      case "text":
      case "textarea": {
        const s = String(raw).trim();
        if (s.length > (def.fieldType === "text" ? 500 : 5000)) fail("validation.invalid");
        else out[def.key] = s;
        break;
      }
      case "number": {
        const n = typeof raw === "number" ? raw : Number(String(raw).replace(/,/g, ""));
        if (!Number.isFinite(n)) fail();
        else out[def.key] = n;
        break;
      }
      case "date": {
        const s = String(raw);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) fail();
        else out[def.key] = s;
        break;
      }
      case "boolean":
        out[def.key] = raw === true || raw === "true" || raw === "on" || raw === "1";
        break;
      case "select": {
        const s = String(raw);
        if (!def.options.includes(s)) fail("validation.invalidOption");
        else out[def.key] = s;
        break;
      }
      case "multiselect": {
        const arr = (Array.isArray(raw) ? raw : String(raw).split(",")).map((x) => String(x).trim()).filter(Boolean);
        if (arr.some((x) => !def.options.includes(x))) fail("validation.invalidOption");
        else out[def.key] = [...new Set(arr)];
        break;
      }
      case "url": {
        const s = String(raw).trim();
        if (!/^https?:\/\/[^\s]+$/i.test(s)) fail("validation.url");
        else out[def.key] = s;
        break;
      }
      case "email": {
        const s = String(raw).trim().toLowerCase();
        if (!z.email().safeParse(s).success) fail("validation.email");
        else out[def.key] = s;
        break;
      }
      case "phone": {
        const p = normalizePhone(String(raw));
        if (!p) fail("validation.phone");
        else out[def.key] = p;
        break;
      }
    }
  }
  if (Object.keys(errors).length) throw new AppError("VALIDATION", "errors.validation", errors);
  return out;
}

function keyFromLabel(label: string): string {
  const ascii = label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 30);
  return /^[a-z]/.test(ascii) ? ascii : `field_${Math.random().toString(36).slice(2, 8)}`;
}

export async function createCustomField(ctx: ServiceCtx, input: z.infer<typeof customFieldDefSchema>) {
  assertCanWrite(ctx, "settings.manage");
  return ctx.run(async (tx) => {
    assertFeature(await getEntitlements(tx, ctx.tenantId), "custom_fields");
    const existing = await listCustomFields(tx, ctx.tenantId, input.entityType);
    if (existing.length >= 50) throw new AppError("QUOTA_EXCEEDED", "customFields.tooMany");
    const [row] = await tx
      .insert(schema.customFieldDefinitions)
      .values({
        tenantId: ctx.tenantId,
        entityType: input.entityType,
        key: input.key ?? keyFromLabel(input.label),
        label: input.label,
        fieldType: input.fieldType,
        options: input.options,
        required: input.required,
        position: existing.length,
      })
      .returning();
    await audit(tx, ctx, { action: "custom_field.created", entityType: "custom_field", entityId: row.id, metadata: { key: row.key } });
    return row;
  });
}

export async function updateCustomField(
  ctx: ServiceCtx,
  id: string,
  input: { label?: string; options?: string[]; required?: boolean; position?: number },
) {
  assertCanWrite(ctx, "settings.manage");
  await ctx.run(async (tx) => {
    const [row] = await tx
      .update(schema.customFieldDefinitions)
      .set(input)
      .where(and(eq(schema.customFieldDefinitions.id, id), eq(schema.customFieldDefinitions.tenantId, ctx.tenantId)))
      .returning();
    if (!row) throw new AppError("NOT_FOUND", "errors.notFound");
    await audit(tx, ctx, { action: "custom_field.updated", entityType: "custom_field", entityId: id });
  });
}

/** Archives (soft-deletes) a definition; stored values stay in the JSON for recovery. */
export async function archiveCustomField(ctx: ServiceCtx, id: string) {
  assertCanWrite(ctx, "settings.manage");
  await ctx.run(async (tx) => {
    const [row] = await tx
      .update(schema.customFieldDefinitions)
      .set({ archivedAt: new Date() })
      .where(and(eq(schema.customFieldDefinitions.id, id), eq(schema.customFieldDefinitions.tenantId, ctx.tenantId)))
      .returning();
    if (!row) throw new AppError("NOT_FOUND", "errors.notFound");
    await audit(tx, ctx, { action: "custom_field.archived", entityType: "custom_field", entityId: id });
  });
}

export async function getCustomFieldDefs(ctx: ServiceCtx, entityType: CustomFieldEntity) {
  assertCan(ctx, "org.view");
  return ctx.run((tx) => listCustomFields(tx, ctx.tenantId, entityType));
}

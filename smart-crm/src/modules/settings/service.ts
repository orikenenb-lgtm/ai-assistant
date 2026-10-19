import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/server/db";
import { assertCan, assertCanWrite, type ServiceCtx } from "@/server/context";
import { audit } from "@/server/audit";
import { AppError } from "@/server/errors";
import { storage, storageKey } from "@/server/storage";

export const DEFAULT_VAT_RATE_BP = 1800;

export type TenantSettings = {
  defaultVatRateBp: number;
  retention: { messagesDays: number | null; aiLogsDays: number | null };
};

/** Typed view over tenants.settings (unknown keys are preserved on write). */
export function readTenantSettings(raw: Record<string, unknown> | null | undefined): TenantSettings {
  const s = raw ?? {};
  const retention = (s.retention ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    defaultVatRateBp: num(s.defaultVatRateBp) ?? DEFAULT_VAT_RATE_BP,
    retention: { messagesDays: num(retention.messagesDays), aiLogsDays: num(retention.aiLogsDays) },
  };
}

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

const retentionDays = z
  .union([z.coerce.number().int().min(30).max(3650), z.literal(""), z.null()])
  .optional()
  .transform((v) => (typeof v === "number" ? v : null));

export const orgProfileSchema = z.object({
  name: z.string().trim().min(2).max(120),
  locale: z.enum(["he", "en"]),
  timezone: z.string().trim().min(1).max(64).refine((tz) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "validation.invalid"),
  currency: z.enum(["ILS", "USD", "EUR", "GBP"]),
  website: optional(300).pipe(z.union([z.null(), z.url({ protocol: /^https?$/ })])),
  phone: optional(40),
  email: optional(254).pipe(z.union([z.null(), z.email()])),
  address: optional(300),
  taxId: optional(40),
  vatRatePercent: z.coerce.number().min(0).max(100).multipleOf(0.01),
  messagesRetentionDays: retentionDays,
  aiLogsRetentionDays: retentionDays,
});
export type OrgProfileInput = z.infer<typeof orgProfileSchema>;

export const brandColorSchema = z.object({
  brandColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "validation.color")
    .nullable(),
});

export async function getOrgSettings(ctx: ServiceCtx) {
  assertCan(ctx, "org.view");
  return ctx.run(async (tx) => {
    const [t] = await tx.select().from(schema.tenants).where(eq(schema.tenants.id, ctx.tenantId));
    if (!t) throw new AppError("NOT_FOUND", "errors.notFound");
    return { tenant: t, settings: readTenantSettings(t.settings) };
  });
}

export async function updateOrgProfile(ctx: ServiceCtx, input: OrgProfileInput) {
  assertCanWrite(ctx, "org.update");
  await ctx.run(async (tx) => {
    const [before] = await tx.select().from(schema.tenants).where(eq(schema.tenants.id, ctx.tenantId));
    if (!before) throw new AppError("NOT_FOUND", "errors.notFound");
    const settings = {
      ...(before.settings ?? {}),
      defaultVatRateBp: Math.round(input.vatRatePercent * 100),
      retention: { messagesDays: input.messagesRetentionDays, aiLogsDays: input.aiLogsRetentionDays },
    };
    await tx
      .update(schema.tenants)
      .set({
        name: input.name,
        locale: input.locale,
        timezone: input.timezone,
        currency: input.currency,
        website: input.website,
        phone: input.phone,
        email: input.email,
        address: input.address,
        taxId: input.taxId,
        settings,
      })
      .where(eq(schema.tenants.id, ctx.tenantId));
    const changed = (["name", "locale", "timezone", "currency", "website", "phone", "email", "address", "taxId"] as const).filter(
      (k) => (before[k] ?? null) !== (input[k] ?? null),
    );
    await audit(tx, ctx, {
      action: "org.updated",
      entityType: "tenant",
      entityId: ctx.tenantId,
      metadata: { changed, vatRateBp: settings.defaultVatRateBp, retention: settings.retention },
    });
  });
}

export async function updateBrandColor(ctx: ServiceCtx, brandColor: string | null) {
  assertCanWrite(ctx, "org.update");
  await ctx.run(async (tx) => {
    await tx.update(schema.tenants).set({ brandColor }).where(eq(schema.tenants.id, ctx.tenantId));
    await audit(tx, ctx, { action: "org.branding_updated", entityType: "tenant", entityId: ctx.tenantId, metadata: { brandColor } });
  });
}

export const LOGO_MAX_BYTES = 512 * 1024;
const LOGO_TYPES: Record<string, string[]> = { "image/png": [".png"], "image/jpeg": [".jpg", ".jpeg"], "image/webp": [".webp"] };

/** Magic-number check so a renamed file cannot pose as an image. */
function sniffImage(bytes: Buffer): string | null {
  if (bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length > 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

export async function uploadLogo(ctx: ServiceCtx, file: { name: string; type: string; bytes: Buffer }) {
  assertCanWrite(ctx, "org.update");
  const ext = (/\.[a-z0-9]+$/i.exec(file.name)?.[0] ?? "").toLowerCase();
  if (file.bytes.length === 0 || file.bytes.length > LOGO_MAX_BYTES) throw new AppError("VALIDATION", "orgSettings.logoTooLarge");
  const sniffed = sniffImage(file.bytes);
  if (!sniffed || sniffed !== file.type || !LOGO_TYPES[sniffed]?.includes(ext)) throw new AppError("VALIDATION", "orgSettings.logoType");
  const key = storageKey(ctx.tenantId, "branding", `logo${ext}`);
  await storage().put(key, file.bytes, sniffed);
  let previous: string | null = null;
  try {
    await ctx.run(async (tx) => {
      const [before] = await tx.select({ logoPath: schema.tenants.logoPath }).from(schema.tenants).where(eq(schema.tenants.id, ctx.tenantId));
      previous = before?.logoPath ?? null;
      await tx.update(schema.tenants).set({ logoPath: key }).where(eq(schema.tenants.id, ctx.tenantId));
      await audit(tx, ctx, { action: "org.logo_uploaded", entityType: "tenant", entityId: ctx.tenantId, metadata: { size: file.bytes.length } });
    });
  } catch (e) {
    await storage().delete(key).catch(() => undefined);
    throw e;
  }
  if (previous) await storage().delete(previous).catch(() => undefined);
  return { key };
}

export async function removeLogo(ctx: ServiceCtx) {
  assertCanWrite(ctx, "org.update");
  const previous = await ctx.run(async (tx) => {
    const [before] = await tx.select({ logoPath: schema.tenants.logoPath }).from(schema.tenants).where(eq(schema.tenants.id, ctx.tenantId));
    await tx.update(schema.tenants).set({ logoPath: null }).where(eq(schema.tenants.id, ctx.tenantId));
    await audit(tx, ctx, { action: "org.logo_removed", entityType: "tenant", entityId: ctx.tenantId });
    return before?.logoPath ?? null;
  });
  if (previous) await storage().delete(previous).catch(() => undefined);
}

/** Small logos are inlined as data URLs (no extra authorized route needed). */
export async function logoDataUrl(logoPath: string | null): Promise<string | null> {
  if (!logoPath) return null;
  try {
    const bytes = await storage().get(logoPath);
    const type = sniffImage(bytes);
    if (!type || bytes.length > LOGO_MAX_BYTES) return null;
    return `data:${type};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

/** Tenant settings read with system privileges (jobs, other modules). */
export async function tenantSettingsFor(tenantId: string): Promise<TenantSettings> {
  const [t] = await db().select({ settings: schema.tenants.settings }).from(schema.tenants).where(eq(schema.tenants.id, tenantId));
  return readTenantSettings(t?.settings);
}

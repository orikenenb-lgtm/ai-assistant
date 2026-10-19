import { randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/server/db";
import { assertCan, assertCanWrite, type ServiceCtx } from "@/server/context";
import { audit } from "@/server/audit";
import { AppError } from "@/server/errors";
import { randomToken, sha256Hex } from "@/server/crypto";
import type { Permission } from "@/server/rbac/permissions";
import { assertFeature, getEntitlements } from "@/modules/billing/entitlements";

export const API_SCOPES = [
  "contacts:read",
  "contacts:write",
  "companies:read",
  "deals:read",
  "deals:write",
  "tasks:read",
  "tasks:write",
  "webhooks:manage",
] as const;
export type ApiScope = (typeof API_SCOPES)[number];

/** API scopes map onto the same permission vocabulary the UI uses. */
export const SCOPE_PERMISSIONS: Record<ApiScope, Permission[]> = {
  "contacts:read": ["contacts.view"],
  "contacts:write": ["contacts.view", "contacts.create", "contacts.update", "contacts.delete"],
  "companies:read": ["companies.view"],
  "deals:read": ["deals.view"],
  "deals:write": ["deals.view", "deals.create", "deals.update", "deals.delete"],
  "tasks:read": ["tasks.view"],
  "tasks:write": ["tasks.view", "tasks.create", "tasks.update", "tasks.delete", "tasks.assign_others"],
  "webhooks:manage": ["integrations.manage"],
};

export function permissionsForScopes(scopes: string[]): Permission[] {
  return [...new Set(scopes.flatMap((s) => SCOPE_PERMISSIONS[s as ApiScope] ?? []))];
}

export const MAX_KEYS_PER_TENANT = 25;

export const createApiKeySchema = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z.array(z.enum(API_SCOPES)).min(1).max(API_SCOPES.length),
  expiresInDays: z.coerce.number().int().min(1).max(3650).optional().nullable(),
});

export type ApiKeyView = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdByName: string | null;
};

const PREFIX_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function randomPrefix(): string {
  const bytes = randomBytes(8);
  return Array.from(bytes, (b) => PREFIX_ALPHABET[b % PREFIX_ALPHABET.length]).join("");
}

/** Full key format: sck_<8 lowercase alnum>_<43 char secret>. Only the SHA-256 is stored. */
export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const prefix = `sck_${randomPrefix()}`;
  const key = `${prefix}_${randomToken(32)}`;
  return { key, prefix, hash: sha256Hex(key) };
}

export function looksLikeApiKey(value: string): boolean {
  return /^sck_[a-z0-9]{8}_[A-Za-z0-9_-]{30,64}$/.test(value);
}

async function assertApiFeature(ctx: ServiceCtx) {
  assertFeature(await getEntitlements(db(), ctx.tenantId), "api");
}

export async function listApiKeys(ctx: ServiceCtx): Promise<ApiKeyView[]> {
  assertCan(ctx, "api_keys.manage");
  return ctx.run(async (tx) => {
    const rows = await tx
      .select({ k: schema.apiKeys, by: schema.profiles.fullName })
      .from(schema.apiKeys)
      .leftJoin(schema.profiles, eq(schema.profiles.id, schema.apiKeys.createdBy))
      .where(eq(schema.apiKeys.tenantId, ctx.tenantId))
      .orderBy(desc(schema.apiKeys.createdAt));
    return rows.map((r) => ({
      id: r.k.id,
      name: r.k.name,
      prefix: r.k.prefix,
      scopes: r.k.scopes,
      createdAt: r.k.createdAt,
      lastUsedAt: r.k.lastUsedAt,
      expiresAt: r.k.expiresAt,
      revokedAt: r.k.revokedAt,
      createdByName: r.by,
    }));
  });
}

/** Returns the plaintext key exactly once. */
export async function createApiKey(ctx: ServiceCtx, input: z.infer<typeof createApiKeySchema>): Promise<{ id: string; key: string }> {
  assertCanWrite(ctx, "api_keys.manage");
  await assertApiFeature(ctx);
  const { key, prefix, hash } = generateApiKey();
  return ctx.run(async (tx) => {
    const active = await tx
      .select({ id: schema.apiKeys.id })
      .from(schema.apiKeys)
      .where(and(eq(schema.apiKeys.tenantId, ctx.tenantId)));
    if (active.length >= MAX_KEYS_PER_TENANT) throw new AppError("QUOTA_EXCEEDED", "apiKeys.tooMany");
    const [row] = await tx
      .insert(schema.apiKeys)
      .values({
        tenantId: ctx.tenantId,
        name: input.name,
        prefix,
        keyHash: hash,
        scopes: [...new Set(input.scopes)],
        createdBy: ctx.userId,
        expiresAt: input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86400_000) : null,
      })
      .returning({ id: schema.apiKeys.id });
    await audit(tx, ctx, { action: "api_key.created", entityType: "api_key", entityId: row.id, metadata: { name: input.name, prefix, scopes: input.scopes } });
    return { id: row.id, key };
  });
}

export async function revokeApiKey(ctx: ServiceCtx, id: string) {
  assertCanWrite(ctx, "api_keys.manage");
  await ctx.run(async (tx) => {
    const [row] = await tx
      .update(schema.apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.apiKeys.id, id), eq(schema.apiKeys.tenantId, ctx.tenantId)))
      .returning();
    if (!row) throw new AppError("NOT_FOUND", "errors.notFound");
    await audit(tx, ctx, { action: "api_key.revoked", entityType: "api_key", entityId: id, metadata: { prefix: row.prefix } });
  });
}

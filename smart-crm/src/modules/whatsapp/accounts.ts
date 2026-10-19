import { randomUUID } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import { schema, withSystemTx, type Executor } from "@/server/db";
import { assertCan, assertCanWrite, type ServiceCtx } from "@/server/context";
import { audit } from "@/server/audit";
import { decryptSecret, encryptSecret } from "@/server/crypto";
import { env } from "@/server/env";
import { AppError, isUniqueViolation } from "@/server/errors";
import { assertFeature, getEntitlements } from "@/modules/billing/entitlements";
import type { ConnectAccountInput } from "./schemas";
import { MetaCloudWhatsAppProvider } from "./meta-provider";
import { MockWhatsAppProvider } from "./mock-provider";
import { WhatsAppProviderError, type WhatsAppProvider } from "./provider";

export type AccountRow = typeof schema.whatsappAccounts.$inferSelect;

export type AccountView = {
  id: string;
  provider: "meta" | "mock";
  displayName: string;
  phoneNumber: string;
  phoneNumberId: string;
  wabaId: string;
  status: "active" | "disabled" | "error";
  qualityRating: string | null;
  sendRatePerMinute: number;
  lastError: string | null;
  lastSyncedAt: Date | null;
  hasToken: boolean;
  createdAt: Date;
};

export function toAccountView(a: AccountRow): AccountView {
  return {
    id: a.id,
    provider: a.provider as AccountView["provider"],
    displayName: a.displayName,
    phoneNumber: a.phoneNumber,
    phoneNumberId: a.phoneNumberId,
    wabaId: a.wabaId,
    status: a.status as AccountView["status"],
    qualityRating: a.qualityRating,
    sendRatePerMinute: a.sendRatePerMinute,
    lastError: a.lastError,
    lastSyncedAt: a.lastSyncedAt,
    hasToken: a.accessTokenSecretId !== null,
    createdAt: a.createdAt,
  };
}

/** Tokens are bound to their account via AES-GCM additional data. */
const tokenAad = (accountId: string) => `whatsapp_account:${accountId}`;

export const mockAllowed = () => env().WHATSAPP_PROVIDER === "mock" && env().APP_ENV !== "production";

/* ------------------------------------------------------- provider factory */

type ProviderFactory = (account: AccountRow, token: string | null) => WhatsAppProvider;
let factoryOverride: ProviderFactory | null = null;

/** Test hook: replace the provider used for every account. */
export function __setProviderFactoryForTests(factory: ProviderFactory | null) {
  factoryOverride = factory;
}

/** Builds the provider for an account (system context: decrypts the access token). */
export async function providerForAccount(account: AccountRow, tx?: Executor): Promise<WhatsAppProvider> {
  let token: string | null = null;
  if (account.accessTokenSecretId) {
    const load = async (t: Executor) => {
      const [secret] = await t.select().from(schema.secrets).where(eq(schema.secrets.id, account.accessTokenSecretId!));
      return secret ? decryptSecret(secret.ciphertext, tokenAad(account.id)) : null;
    };
    token = tx ? await load(tx) : await withSystemTx(load);
  }
  if (factoryOverride) return factoryOverride(account, token);
  if (account.provider === "mock") {
    if (!mockAllowed()) throw new WhatsAppProviderError("mock WhatsApp accounts are disabled in this environment", "permanent");
    return new MockWhatsAppProvider();
  }
  if (!token) throw new WhatsAppProviderError("WhatsApp access token is missing", "permanent");
  return new MetaCloudWhatsAppProvider({ phoneNumberId: account.phoneNumberId, wabaId: account.wabaId }, token);
}

/* -------------------------------------------------------------- accounts */

export async function listAccounts(ctx: ServiceCtx): Promise<AccountView[]> {
  assertCan(ctx, "inbox.view");
  const rows = await ctx.run((tx) =>
    tx
      .select()
      .from(schema.whatsappAccounts)
      .where(eq(schema.whatsappAccounts.tenantId, ctx.tenantId))
      .orderBy(asc(schema.whatsappAccounts.createdAt)),
  );
  return rows.map(toAccountView);
}

async function loadAccount(tx: Executor, tenantId: string, id: string): Promise<AccountRow> {
  const [a] = await tx
    .select()
    .from(schema.whatsappAccounts)
    .where(and(eq(schema.whatsappAccounts.id, id), eq(schema.whatsappAccounts.tenantId, tenantId)));
  if (!a) throw new AppError("NOT_FOUND", "errors.notFound");
  return a;
}

/**
 * Connects a WhatsApp Business phone number. The access token is encrypted into
 * public.secrets (unreadable by app roles) and never returned to the client.
 */
export async function connectAccount(ctx: ServiceCtx, input: ConnectAccountInput): Promise<AccountView> {
  assertCanWrite(ctx, "integrations.manage");
  if (input.provider === "mock" && !mockAllowed()) throw new AppError("VALIDATION", "whatsapp.mockDisabled");
  await ctx.run(async (tx) => assertFeature(await getEntitlements(tx, ctx.tenantId), "whatsapp"));
  const accountId = randomUUID();
  try {
    return await withSystemTx(async (tx) => {
      let secretId: string | null = null;
      if (input.accessToken) {
        const [secret] = await tx
          .insert(schema.secrets)
          .values({ tenantId: ctx.tenantId, kind: "whatsapp_access_token", ciphertext: encryptSecret(input.accessToken, tokenAad(accountId)) })
          .returning({ id: schema.secrets.id });
        secretId = secret.id;
      }
      const [account] = await tx
        .insert(schema.whatsappAccounts)
        .values({
          id: accountId,
          tenantId: ctx.tenantId,
          provider: input.provider,
          displayName: input.displayName,
          phoneNumber: input.phoneNumber,
          phoneNumberId: input.phoneNumberId,
          wabaId: input.wabaId,
          accessTokenSecretId: secretId,
          sendRatePerMinute: input.sendRatePerMinute,
          createdBy: ctx.userId,
        })
        .returning();
      await audit(tx, ctx, {
        action: "whatsapp.account_connected",
        entityType: "whatsapp_account",
        entityId: account.id,
        metadata: { provider: input.provider, phoneNumberId: input.phoneNumberId },
      });
      return toAccountView(account);
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new AppError("CONFLICT", "whatsapp.accountExists");
    throw e;
  }
}

export async function updateAccount(
  ctx: ServiceCtx,
  input: { id: string; displayName?: string; sendRatePerMinute?: number; accessToken?: string },
) {
  assertCanWrite(ctx, "integrations.manage");
  await ctx.run((tx) => loadAccount(tx, ctx.tenantId, input.id));
  await withSystemTx(async (tx) => {
    const account = await loadAccount(tx, ctx.tenantId, input.id);
    const patch: Partial<AccountRow> = {};
    if (input.displayName) patch.displayName = input.displayName;
    if (input.sendRatePerMinute) patch.sendRatePerMinute = input.sendRatePerMinute;
    if (input.accessToken) {
      const ciphertext = encryptSecret(input.accessToken, tokenAad(account.id));
      if (account.accessTokenSecretId) {
        await tx.update(schema.secrets).set({ ciphertext, rotatedAt: new Date() }).where(eq(schema.secrets.id, account.accessTokenSecretId));
      } else {
        const [s] = await tx
          .insert(schema.secrets)
          .values({ tenantId: ctx.tenantId, kind: "whatsapp_access_token", ciphertext })
          .returning({ id: schema.secrets.id });
        patch.accessTokenSecretId = s.id;
      }
    }
    if (Object.keys(patch).length) await tx.update(schema.whatsappAccounts).set(patch).where(eq(schema.whatsappAccounts.id, account.id));
    await audit(tx, ctx, {
      action: input.accessToken ? "whatsapp.token_rotated" : "whatsapp.account_updated",
      entityType: "whatsapp_account",
      entityId: account.id,
      metadata: { fields: Object.keys(input).filter((k) => k !== "id" && k !== "accessToken") },
    });
  });
}

export async function setAccountStatus(ctx: ServiceCtx, id: string, status: "active" | "disabled") {
  assertCanWrite(ctx, "integrations.manage");
  await ctx.run(async (tx) => {
    await loadAccount(tx, ctx.tenantId, id);
    await tx.update(schema.whatsappAccounts).set({ status, lastError: null }).where(eq(schema.whatsappAccounts.id, id));
    await audit(tx, ctx, { action: status === "active" ? "whatsapp.account_enabled" : "whatsapp.account_disabled", entityType: "whatsapp_account", entityId: id });
  });
}

export async function testAccountConnection(ctx: ServiceCtx, id: string) {
  assertCanWrite(ctx, "integrations.manage");
  const account = await ctx.run((tx) => loadAccount(tx, ctx.tenantId, id));
  let check;
  try {
    check = await (await providerForAccount(account)).testConnection();
  } catch (e) {
    check = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  await withSystemTx((tx) =>
    tx
      .update(schema.whatsappAccounts)
      .set({
        lastError: check.ok ? null : (check.error ?? "connection failed").slice(0, 500),
        qualityRating: check.ok ? (check.qualityRating ?? null) : account.qualityRating,
        status: check.ok ? (account.status === "error" ? "active" : account.status) : "error",
        lastSyncedAt: new Date(),
      })
      .where(eq(schema.whatsappAccounts.id, id)),
  );
  return check;
}

/* ------------------------------------------------------------- templates */

export type TemplateView = {
  id: string;
  accountId: string;
  name: string;
  language: string;
  category: string;
  status: string;
  components: unknown;
  rejectedReason: string | null;
  syncedAt: Date | null;
};

export async function listTemplates(ctx: ServiceCtx, accountId?: string): Promise<TemplateView[]> {
  assertCan(ctx, "inbox.view");
  const rows = await ctx.run((tx) =>
    tx
      .select()
      .from(schema.messageTemplates)
      .where(
        and(
          eq(schema.messageTemplates.tenantId, ctx.tenantId),
          accountId ? eq(schema.messageTemplates.whatsappAccountId, accountId) : undefined,
        ),
      )
      .orderBy(asc(schema.messageTemplates.name), desc(schema.messageTemplates.language)),
  );
  return rows.map((t) => ({
    id: t.id,
    accountId: t.whatsappAccountId,
    name: t.name,
    language: t.language,
    category: t.category,
    status: t.status,
    components: t.components,
    rejectedReason: t.rejectedReason,
    syncedAt: t.syncedAt,
  }));
}

/** Pulls templates from Meta and upserts them (status changes included). */
export async function syncTemplates(ctx: ServiceCtx, accountId: string): Promise<{ synced: number }> {
  assertCanWrite(ctx, "integrations.manage");
  const account = await ctx.run((tx) => loadAccount(tx, ctx.tenantId, accountId));
  let templates;
  try {
    templates = await (await providerForAccount(account)).fetchTemplates();
  } catch (e) {
    throw new AppError("PROVIDER_ERROR", "whatsapp.syncFailed", undefined, { reason: e instanceof Error ? e.message : String(e) });
  }
  const now = new Date();
  await ctx.run(async (tx) => {
    for (const t of templates) {
      if (!/^[a-z0-9_]{1,512}$/.test(t.name) || !/^[a-z]{2,3}(_[A-Z]{2})?$/.test(t.language)) continue;
      await tx
        .insert(schema.messageTemplates)
        .values({
          tenantId: ctx.tenantId,
          whatsappAccountId: accountId,
          name: t.name,
          language: t.language,
          category: t.category,
          status: t.status,
          components: t.components,
          metaTemplateId: t.metaTemplateId,
          rejectedReason: t.rejectedReason,
          syncedAt: now,
        })
        .onConflictDoUpdate({
          target: [schema.messageTemplates.whatsappAccountId, schema.messageTemplates.name, schema.messageTemplates.language],
          set: {
            category: t.category,
            status: t.status,
            components: t.components,
            metaTemplateId: t.metaTemplateId,
            rejectedReason: t.rejectedReason,
            syncedAt: now,
          },
        });
    }
    await tx.update(schema.whatsappAccounts).set({ lastSyncedAt: now }).where(eq(schema.whatsappAccounts.id, accountId));
    await audit(tx, ctx, { action: "whatsapp.templates_synced", entityType: "whatsapp_account", entityId: accountId, metadata: { count: templates.length } });
  });
  return { synced: templates.length };
}

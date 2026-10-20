import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { env } from "@/server/env";
import { assertCan, assertCanWrite, type ServiceCtx } from "@/server/context";
import { audit } from "@/server/audit";
import { AppError } from "@/server/errors";
import { decryptSecret, encryptSecret } from "@/server/crypto";

export type IntegrationProvider = (typeof schema.integrationConnections.$inferSelect)["provider"];
export type IntegrationState = "connected" | "mock" | "not_configured" | "error" | "disabled";

export type IntegrationCard = {
  key: "whatsapp" | "ai" | "email" | "calendar" | "invoicing" | "billing" | "storage";
  state: IntegrationState;
  /** Non-secret facts shown to admins (provider name, counts…). */
  detail: Record<string, string | number | boolean>;
  href?: string;
};

/**
 * Integration status for the settings page. Never returns credentials — only
 * whether they are present and which provider is active.
 */
export async function integrationStatus(ctx: ServiceCtx): Promise<IntegrationCard[]> {
  assertCan(ctx, "integrations.manage");
  const e = env();
  const [wa] = await ctx.run((tx) =>
    tx.execute<{ total: number; active: number }>(sql`
      select count(*)::int as total, count(*) filter (where status = 'active')::int as active
      from public.whatsapp_accounts where tenant_id = ${ctx.tenantId}`),
  );
  const connections = await ctx.run((tx) =>
    tx.select().from(schema.integrationConnections).where(eq(schema.integrationConnections.tenantId, ctx.tenantId)),
  );
  const conn = (p: IntegrationProvider) => connections.find((c) => c.provider === p);
  const [calendarFlag] = await db().select().from(schema.featureFlags).where(eq(schema.featureFlags.key, "calendar.sync"));
  const invoicing = conn("greeninvoice") ?? conn("icount") ?? conn("rivhit");

  return [
    {
      key: "whatsapp",
      state: e.WHATSAPP_PROVIDER === "mock" ? "mock" : Number(wa?.active ?? 0) > 0 ? "connected" : e.META_APP_SECRET ? "not_configured" : "error",
      detail: { provider: e.WHATSAPP_PROVIDER, accounts: Number(wa?.total ?? 0), activeAccounts: Number(wa?.active ?? 0) },
      href: "/settings/whatsapp",
    },
    {
      key: "ai",
      state: e.AI_PROVIDER === "mock" ? "mock" : e.OPENAI_API_KEY ? "connected" : "error",
      detail: { provider: e.AI_PROVIDER, model: e.AI_PROVIDER === "openai" ? e.OPENAI_MODEL : "mock" },
    },
    {
      key: "email",
      state: e.EMAIL_PROVIDER === "log" ? "mock" : e.RESEND_API_KEY ? "connected" : "error",
      detail: { provider: e.EMAIL_PROVIDER, from: e.EMAIL_PROVIDER === "log" ? "dev mailbox" : e.EMAIL_FROM },
    },
    {
      key: "calendar",
      state: !calendarFlag?.enabled ? "disabled" : conn("google_calendar")?.status === "connected" || conn("microsoft_calendar")?.status === "connected" ? "connected" : "not_configured",
      detail: { featureFlag: Boolean(calendarFlag?.enabled) },
      href: "/calendar",
    },
    {
      key: "invoicing",
      state: invoicing ? (invoicing.status === "connected" ? "connected" : invoicing.status === "error" ? "error" : "not_configured") : "not_configured",
      detail: { provider: invoicing?.provider ?? "none" },
    },
    {
      key: "billing",
      state: e.BILLING_PROVIDER === "mock" ? "mock" : e.STRIPE_SECRET_KEY ? "connected" : "error",
      detail: { provider: e.BILLING_PROVIDER, liveMode: e.BILLING_LIVE_MODE },
      href: "/settings/billing",
    },
    {
      key: "storage",
      state: e.STORAGE_PROVIDER === "local" ? "mock" : "connected",
      detail: { provider: e.STORAGE_PROVIDER },
    },
  ];
}

/* --------------------------------------------- generic connection store */

/**
 * Saves an integration connection: non-secret config in jsonb, the credential
 * (if any) encrypted in the system-only secrets table.
 */
export async function saveIntegrationConnection(
  ctx: ServiceCtx,
  provider: IntegrationProvider,
  input: { config: Record<string, unknown>; secret?: string | null; status?: "pending" | "connected" | "disconnected" },
) {
  assertCanWrite(ctx, "integrations.manage");
  let secretId: string | null = null;
  if (input.secret) {
    const [s] = await db()
      .insert(schema.secrets)
      .values({ tenantId: ctx.tenantId, kind: "integration", ciphertext: encryptSecret(input.secret, `integration:${ctx.tenantId}:${provider}`) })
      .returning({ id: schema.secrets.id });
    secretId = s.id;
  }
  const previousSecret = await ctx.run(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.integrationConnections)
      .where(and(eq(schema.integrationConnections.tenantId, ctx.tenantId), eq(schema.integrationConnections.provider, provider)));
    if (existing) {
      await tx
        .update(schema.integrationConnections)
        .set({ config: input.config, status: input.status ?? "pending", ...(secretId ? { secretId } : {}), connectedBy: ctx.userId, lastError: null })
        .where(eq(schema.integrationConnections.id, existing.id));
    } else {
      await tx.insert(schema.integrationConnections).values({
        tenantId: ctx.tenantId,
        provider,
        config: input.config,
        status: input.status ?? "pending",
        secretId,
        connectedBy: ctx.userId,
      });
    }
    await audit(tx, ctx, { action: "integration.saved", entityType: "integration", entityId: provider, metadata: { secretUpdated: Boolean(secretId) } });
    return secretId ? (existing?.secretId ?? null) : null;
  });
  if (previousSecret) await db().delete(schema.secrets).where(eq(schema.secrets.id, previousSecret));
}

/** Decrypted credential for server-side use only (system context). */
export async function integrationSecret(tenantId: string, provider: IntegrationProvider): Promise<string | null> {
  const [row] = await db()
    .select({ ciphertext: schema.secrets.ciphertext })
    .from(schema.integrationConnections)
    .innerJoin(schema.secrets, eq(schema.secrets.id, schema.integrationConnections.secretId))
    .where(and(eq(schema.integrationConnections.tenantId, tenantId), eq(schema.integrationConnections.provider, provider)));
  return row ? decryptSecret(row.ciphertext, `integration:${tenantId}:${provider}`) : null;
}

export type ConnectionTester = (input: { tenantId: string; config: Record<string, unknown>; secret: string | null }) => Promise<{ ok: boolean; message?: string }>;
const testers = new Map<IntegrationProvider, ConnectionTester>();

/** Modules register a connection test for their provider (e.g. invoicing). */
export function registerIntegrationTester(provider: IntegrationProvider, tester: ConnectionTester) {
  testers.set(provider, tester);
}

export async function testIntegrationConnection(ctx: ServiceCtx, provider: IntegrationProvider) {
  assertCanWrite(ctx, "integrations.manage");
  const tester = testers.get(provider);
  if (!tester) throw new AppError("PRECONDITION", "integrations.noTester");
  const [conn] = await ctx.run((tx) =>
    tx
      .select()
      .from(schema.integrationConnections)
      .where(and(eq(schema.integrationConnections.tenantId, ctx.tenantId), eq(schema.integrationConnections.provider, provider))),
  );
  if (!conn) throw new AppError("NOT_FOUND", "errors.notFound");
  let result: { ok: boolean; message?: string };
  try {
    result = await tester({ tenantId: ctx.tenantId, config: conn.config as Record<string, unknown>, secret: await integrationSecret(ctx.tenantId, provider) });
  } catch (e) {
    result = { ok: false, message: e instanceof Error ? e.message : "test failed" };
  }
  await ctx.run(async (tx) => {
    await tx
      .update(schema.integrationConnections)
      .set({ status: result.ok ? "connected" : "error", lastCheckedAt: new Date(), lastError: result.ok ? null : (result.message ?? "failed").slice(0, 500) })
      .where(eq(schema.integrationConnections.id, conn.id));
    await audit(tx, ctx, { action: "integration.tested", entityType: "integration", entityId: provider, metadata: { ok: result.ok } });
  });
  return result;
}

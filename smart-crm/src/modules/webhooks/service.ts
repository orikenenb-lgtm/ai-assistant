import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema, withSystemTx } from "@/server/db";
import { assertCan, assertCanWrite, type ServiceCtx } from "@/server/context";
import { audit } from "@/server/audit";
import { AppError } from "@/server/errors";
import { decryptSecret, encryptSecret, randomToken } from "@/server/crypto";
import { DOMAIN_EVENTS } from "@/server/events";
import { enqueueJob } from "@/server/jobs/queue";
import { assertFeature, getEntitlements } from "@/modules/billing/entitlements";
import { validateWebhookUrl } from "./ssrf";

export const MAX_WEBHOOKS_PER_TENANT = 20;

export const webhookInputSchema = z.object({
  url: z.string().trim().min(8).max(2000),
  description: z
    .string()
    .trim()
    .max(200)
    .optional()
    .nullable()
    .transform((v) => v || null),
  events: z.array(z.enum(DOMAIN_EVENTS)).min(1).max(DOMAIN_EVENTS.length),
});
export type WebhookInput = z.infer<typeof webhookInputSchema>;

export type WebhookView = {
  id: string;
  url: string;
  description: string | null;
  events: string[];
  active: boolean;
  consecutiveFailures: number;
  disabledReason: string | null;
  createdAt: Date;
};

const toView = (w: typeof schema.outboundWebhooks.$inferSelect): WebhookView => ({
  id: w.id,
  url: w.url,
  description: w.description,
  events: w.events,
  active: w.active,
  consecutiveFailures: w.consecutiveFailures,
  disabledReason: w.disabledReason,
  createdAt: w.createdAt,
});

function assertUrl(url: string) {
  const check = validateWebhookUrl(url);
  if (!check.ok) throw new AppError("VALIDATION", `webhooks.urlErrors.${check.reason}`, { url: [`webhooks.urlErrors.${check.reason}`] });
}

async function assertWebhooksFeature(ctx: ServiceCtx) {
  assertFeature(await getEntitlements(db(), ctx.tenantId), "webhooks");
}

export async function listWebhooks(ctx: ServiceCtx): Promise<WebhookView[]> {
  assertCan(ctx, "integrations.manage");
  return ctx.run(async (tx) =>
    (
      await tx
        .select()
        .from(schema.outboundWebhooks)
        .where(eq(schema.outboundWebhooks.tenantId, ctx.tenantId))
        .orderBy(desc(schema.outboundWebhooks.createdAt))
    ).map(toView),
  );
}

/** Generates a signing secret, stores it encrypted (system-only table) and returns its id. */
async function storeSigningSecret(tenantId: string): Promise<{ secretId: string; secret: string }> {
  const secret = `whsec_${randomToken(32)}`;
  const [row] = await db()
    .insert(schema.secrets)
    .values({ tenantId, kind: "webhook_signing", ciphertext: encryptSecret(secret, `webhook:${tenantId}`) })
    .returning({ id: schema.secrets.id });
  return { secretId: row.id, secret };
}

/** Returns the plaintext signing secret ONCE, at creation. */
export async function createWebhook(ctx: ServiceCtx, input: WebhookInput): Promise<{ webhook: WebhookView; secret: string }> {
  assertCanWrite(ctx, "integrations.manage");
  await assertWebhooksFeature(ctx);
  assertUrl(input.url);
  const existing = await ctx.run(async (tx) => {
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.outboundWebhooks)
      .where(eq(schema.outboundWebhooks.tenantId, ctx.tenantId));
    return n;
  });
  if (existing >= MAX_WEBHOOKS_PER_TENANT) throw new AppError("QUOTA_EXCEEDED", "webhooks.tooMany");
  const { secretId, secret } = await storeSigningSecret(ctx.tenantId);
  try {
    const webhook = await ctx.run(async (tx) => {
      const [w] = await tx
        .insert(schema.outboundWebhooks)
        .values({
          tenantId: ctx.tenantId,
          url: input.url,
          description: input.description,
          events: [...new Set(input.events)],
          secretId,
          createdBy: ctx.userId,
        })
        .returning();
      await audit(tx, ctx, { action: "webhook.created", entityType: "webhook", entityId: w.id, metadata: { url: w.url, events: w.events } });
      return w;
    });
    return { webhook: toView(webhook), secret };
  } catch (e) {
    await db().delete(schema.secrets).where(eq(schema.secrets.id, secretId));
    throw e;
  }
}

export async function updateWebhook(ctx: ServiceCtx, id: string, input: WebhookInput & { active?: boolean }) {
  assertCanWrite(ctx, "integrations.manage");
  assertUrl(input.url);
  await ctx.run(async (tx) => {
    const [w] = await tx
      .update(schema.outboundWebhooks)
      .set({
        url: input.url,
        description: input.description,
        events: [...new Set(input.events)],
        ...(input.active === undefined
          ? {}
          : input.active
            ? { active: true, consecutiveFailures: 0, disabledReason: null }
            : { active: false, disabledReason: "manual" }),
      })
      .where(and(eq(schema.outboundWebhooks.id, id), eq(schema.outboundWebhooks.tenantId, ctx.tenantId)))
      .returning();
    if (!w) throw new AppError("NOT_FOUND", "errors.notFound");
    await audit(tx, ctx, { action: "webhook.updated", entityType: "webhook", entityId: id, metadata: { active: w.active } });
  });
}

export async function setWebhookActive(ctx: ServiceCtx, id: string, active: boolean) {
  assertCanWrite(ctx, "integrations.manage");
  await ctx.run(async (tx) => {
    const [w] = await tx
      .update(schema.outboundWebhooks)
      .set(active ? { active: true, consecutiveFailures: 0, disabledReason: null } : { active: false, disabledReason: "manual" })
      .where(and(eq(schema.outboundWebhooks.id, id), eq(schema.outboundWebhooks.tenantId, ctx.tenantId)))
      .returning();
    if (!w) throw new AppError("NOT_FOUND", "errors.notFound");
    await audit(tx, ctx, { action: active ? "webhook.enabled" : "webhook.disabled", entityType: "webhook", entityId: id });
  });
}

export async function deleteWebhook(ctx: ServiceCtx, id: string) {
  assertCanWrite(ctx, "integrations.manage");
  const secretId = await ctx.run(async (tx) => {
    const [w] = await tx
      .delete(schema.outboundWebhooks)
      .where(and(eq(schema.outboundWebhooks.id, id), eq(schema.outboundWebhooks.tenantId, ctx.tenantId)))
      .returning();
    if (!w) throw new AppError("NOT_FOUND", "errors.notFound");
    await audit(tx, ctx, { action: "webhook.deleted", entityType: "webhook", entityId: id, metadata: { url: w.url } });
    return w.secretId;
  });
  if (secretId) await db().delete(schema.secrets).where(and(eq(schema.secrets.id, secretId), eq(schema.secrets.tenantId, ctx.tenantId)));
}

/** Issues a new signing secret (old one stops working immediately). */
export async function rotateWebhookSecret(ctx: ServiceCtx, id: string): Promise<{ secret: string }> {
  assertCanWrite(ctx, "integrations.manage");
  const current = await ctx.run(async (tx) => {
    const [w] = await tx
      .select()
      .from(schema.outboundWebhooks)
      .where(and(eq(schema.outboundWebhooks.id, id), eq(schema.outboundWebhooks.tenantId, ctx.tenantId)));
    if (!w) throw new AppError("NOT_FOUND", "errors.notFound");
    return w;
  });
  const { secretId, secret } = await storeSigningSecret(ctx.tenantId);
  await ctx.run(async (tx) => {
    await tx.update(schema.outboundWebhooks).set({ secretId }).where(eq(schema.outboundWebhooks.id, id));
    await audit(tx, ctx, { action: "webhook.secret_rotated", entityType: "webhook", entityId: id });
  });
  if (current.secretId) await db().delete(schema.secrets).where(eq(schema.secrets.id, current.secretId));
  return { secret };
}

export async function webhookSigningSecret(tenantId: string, secretId: string | null): Promise<string | null> {
  if (!secretId) return null;
  const [row] = await db()
    .select()
    .from(schema.secrets)
    .where(and(eq(schema.secrets.id, secretId), eq(schema.secrets.tenantId, tenantId)));
  return row ? decryptSecret(row.ciphertext, `webhook:${tenantId}`) : null;
}

export type DeliveryView = {
  id: string;
  eventType: string;
  eventId: string;
  status: string;
  attempts: number;
  responseStatus: number | null;
  responseExcerpt: string | null;
  lastError: string | null;
  createdAt: Date;
  deliveredAt: Date | null;
};

export async function listDeliveries(ctx: ServiceCtx, webhookId: string, limit = 50): Promise<DeliveryView[]> {
  assertCan(ctx, "integrations.manage");
  return ctx.run(async (tx) => {
    const rows = await tx
      .select()
      .from(schema.outboundWebhookDeliveries)
      .where(and(eq(schema.outboundWebhookDeliveries.tenantId, ctx.tenantId), eq(schema.outboundWebhookDeliveries.webhookId, webhookId)))
      .orderBy(desc(schema.outboundWebhookDeliveries.createdAt))
      .limit(limit);
    return rows.map((d) => ({
      id: d.id,
      eventType: d.eventType,
      eventId: d.eventId,
      status: d.status,
      attempts: d.attempts,
      responseStatus: d.responseStatus,
      responseExcerpt: d.responseExcerpt,
      lastError: d.lastError,
      createdAt: d.createdAt,
      deliveredAt: d.deliveredAt,
    }));
  });
}

/** Queues another delivery attempt of a past event. */
export async function redeliver(ctx: ServiceCtx, deliveryId: string) {
  assertCanWrite(ctx, "integrations.manage");
  const delivery = await ctx.run(async (tx) => {
    const [d] = await tx
      .select()
      .from(schema.outboundWebhookDeliveries)
      .where(and(eq(schema.outboundWebhookDeliveries.id, deliveryId), eq(schema.outboundWebhookDeliveries.tenantId, ctx.tenantId)));
    if (!d) throw new AppError("NOT_FOUND", "errors.notFound");
    await audit(tx, ctx, { action: "webhook.redelivered", entityType: "webhook_delivery", entityId: deliveryId });
    return d;
  });
  // Deliveries are written by the system context only.
  await withSystemTx(async (tx) => {
    await tx
      .update(schema.outboundWebhookDeliveries)
      .set({ status: "pending", lastError: null })
      .where(eq(schema.outboundWebhookDeliveries.id, delivery.id));
    await enqueueJob(tx, {
      tenantId: ctx.tenantId,
      type: "webhooks.deliver",
      payload: { deliveryId: delivery.id },
      idempotencyKey: `whd:${delivery.id}:${Date.now()}`,
      maxAttempts: 6,
    });
  });
}

/**
 * WhatsApp background jobs (registered via src/server/jobs/registry.ts):
 *  whatsapp.process_webhook  — parse a stored Meta webhook event
 *  whatsapp.send             — deliver an outbound message
 *  whatsapp.download_media   — copy inbound media into private storage
 *  whatsapp.mark_read        — blue ticks for the customer (best effort)
 */
import { and, desc, eq } from "drizzle-orm";
import { schema, withSystemTx } from "@/server/db";
import { PermanentJobError, registerJobHandler } from "@/server/jobs/runner";
import { errorFields, logger } from "@/server/logger";
import { storage, storageKey } from "@/server/storage";
import { providerForAccount } from "./accounts";
import { deliverOutboundMessage } from "./outbound";
import { WhatsAppProviderError } from "./provider";
import { processWebhookEvent } from "./webhook";

const MAX_INBOUND_MEDIA_BYTES = 32 * 1024 * 1024;

function requireString(payload: Record<string, unknown>, key: string): string {
  const v = payload[key];
  if (typeof v !== "string" || !v) throw new PermanentJobError(`missing ${key}`);
  return v;
}

registerJobHandler("whatsapp.process_webhook", async (job) => {
  await processWebhookEvent(requireString(job.payload, "webhookEventId"));
});

registerJobHandler("whatsapp.send", async (job) => {
  await deliverOutboundMessage(requireString(job.payload, "messageId"), { finalAttempt: job.attempts >= job.maxAttempts, tenantId: job.tenantId });
});

registerJobHandler("whatsapp.download_media", async (job) => {
  const messageId = requireString(job.payload, "messageId");
  const [row] = await withSystemTx((tx) =>
    tx
      .select({ m: schema.messages, account: schema.whatsappAccounts })
      .from(schema.messages)
      .innerJoin(schema.conversations, eq(schema.conversations.id, schema.messages.conversationId))
      .innerJoin(schema.whatsappAccounts, eq(schema.whatsappAccounts.id, schema.conversations.whatsappAccountId))
      .where(eq(schema.messages.id, messageId)),
  );
  if (!row || (job.tenantId && row.m.tenantId !== job.tenantId)) return;
  const media = (row.m.media ?? {}) as Record<string, unknown>;
  if (typeof media.mediaId !== "string" || media.storageKey) return;
  let file;
  try {
    file = await (await providerForAccount(row.account)).downloadMedia(media.mediaId);
  } catch (e) {
    if (e instanceof WhatsAppProviderError && e.kind === "permanent") throw new PermanentJobError(e.message);
    throw e;
  }
  if (file.bytes.length > MAX_INBOUND_MEDIA_BYTES) {
    await withSystemTx((tx) => tx.update(schema.messages).set({ media: { ...media, tooLarge: true } }).where(eq(schema.messages.id, messageId)));
    return;
  }
  const key = storageKey(row.m.tenantId, "whatsapp", String(media.fileName ?? "media"));
  await storage().put(key, file.bytes, file.mimeType);
  await withSystemTx((tx) =>
    tx
      .update(schema.messages)
      .set({ media: { ...media, storageKey: key, mimeType: file.mimeType, size: file.bytes.length } })
      .where(eq(schema.messages.id, messageId)),
  );
});

registerJobHandler("whatsapp.mark_read", async (job) => {
  const conversationId = requireString(job.payload, "conversationId");
  const [row] = await withSystemTx((tx) =>
    tx
      .select({ waMessageId: schema.messages.waMessageId, account: schema.whatsappAccounts })
      .from(schema.messages)
      .innerJoin(schema.conversations, eq(schema.conversations.id, schema.messages.conversationId))
      .innerJoin(schema.whatsappAccounts, eq(schema.whatsappAccounts.id, schema.conversations.whatsappAccountId))
      .where(and(eq(schema.messages.conversationId, conversationId), eq(schema.messages.direction, "inbound")))
      .orderBy(desc(schema.messages.createdAt))
      .limit(1),
  );
  if (!row?.waMessageId || (job.tenantId && row.account.tenantId !== job.tenantId)) return;
  try {
    await (await providerForAccount(row.account)).markRead(row.waMessageId);
  } catch (e) {
    // Read receipts are cosmetic: never retry-storm or dead-letter them.
    logger().info({ conversationId, ...errorFields(e) }, "whatsapp mark-read skipped");
  }
});

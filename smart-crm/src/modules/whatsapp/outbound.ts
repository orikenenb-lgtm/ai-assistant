import { and, eq, gt, sql } from "drizzle-orm";
import { schema, withSystemTx } from "@/server/db";
import { systemCtx, type ActorType } from "@/server/context";
import { emitEvent } from "@/server/events";
import { PermanentJobError, RetryJobLater } from "@/server/jobs/runner";
import { errorFields, logger } from "@/server/logger";
import { hitRateLimit } from "@/server/rate-limit";
import { storage } from "@/server/storage";
import { e164ToWaId } from "@/lib/phone";
import { recordActivity } from "@/modules/crm/activities";
import { recordUsage } from "@/modules/billing/entitlements";
import { serviceWindow } from "@/modules/inbox/window";
import { providerForAccount } from "./accounts";
import { OUTBOUND_MEDIA, WhatsAppProviderError, type OutboundTemplate } from "./provider";

type MediaMeta = { storageKey?: string; mimeType?: string; fileName?: string; caption?: string | null };

async function markFailed(messageId: string, tenantId: string, conversationId: string, code: string, message: string) {
  await withSystemTx(async (tx) => {
    const rows = await tx
      .update(schema.messages)
      .set({ status: "failed", errorCode: code.slice(0, 40), errorMessage: message.slice(0, 500), failedAt: new Date() })
      .where(and(eq(schema.messages.id, messageId), sql`${schema.messages.status} in ('queued', 'sending')`))
      .returning({ id: schema.messages.id });
    if (rows.length) {
      await emitEvent(tx, systemCtx(tenantId), { type: "message.failed", entityType: "message", entityId: messageId, data: { conversationId, errorCode: code } });
    }
  });
}

const actorFor = (senderType: string): ActorType =>
  senderType === "automation" ? "automation" : senderType === "ai" ? "ai" : senderType === "user" ? "user" : "system";

/**
 * Worker side of an outbound message: re-checks compliance at send time, calls
 * the provider and records the outcome. Safe to retry: only queued/sending
 * messages are processed.
 */
export async function deliverOutboundMessage(messageId: string, opts: { finalAttempt: boolean; tenantId?: string | null }) {
  const [row] = await withSystemTx((tx) =>
    tx
      .select({ m: schema.messages, conv: schema.conversations, account: schema.whatsappAccounts, contact: schema.contacts })
      .from(schema.messages)
      .innerJoin(schema.conversations, eq(schema.conversations.id, schema.messages.conversationId))
      .innerJoin(schema.whatsappAccounts, eq(schema.whatsappAccounts.id, schema.conversations.whatsappAccountId))
      .innerJoin(schema.contacts, eq(schema.contacts.id, schema.conversations.contactId))
      .where(eq(schema.messages.id, messageId)),
  );
  if (!row || (opts.tenantId && row.m.tenantId !== opts.tenantId)) throw new PermanentJobError("message not found");
  const { m, conv, account, contact } = row;
  if (m.direction !== "outbound" || !["queued", "sending"].includes(m.status)) return;

  const fail = (code: string, msg: string) => markFailed(m.id, m.tenantId, conv.id, code, msg);
  if (contact.whatsappConsent === "opted_out") return fail("OPTED_OUT", "contact opted out of WhatsApp");
  if (account.status === "disabled") return fail("ACCOUNT_DISABLED", "WhatsApp account is disabled");
  if (!contact.phone) return fail("NO_PHONE", "contact has no phone number");
  if (m.type !== "template" && !serviceWindow(conv.lastInboundAt).open) {
    return fail("131047", "24-hour customer service window is closed");
  }

  const throughput = await hitRateLimit(`wa-send:${account.id}`, account.sendRatePerMinute, 60);
  if (!throughput.allowed) throw new RetryJobLater(throughput.resetAt, "account send rate reached");

  await withSystemTx((tx) =>
    tx.update(schema.messages).set({ status: "sending" }).where(and(eq(schema.messages.id, m.id), eq(schema.messages.status, "queued"))),
  );

  const to = e164ToWaId(contact.phone);
  let waMessageId: string;
  try {
    const provider = await providerForAccount(account);
    if (m.type === "text") {
      ({ waMessageId } = await provider.sendText(to, m.body ?? ""));
    } else if (m.type === "template") {
      ({ waMessageId } = await provider.sendTemplate(to, m.template as OutboundTemplate));
    } else {
      const media = (m.media ?? {}) as MediaMeta;
      if (!media.storageKey || !media.mimeType || !OUTBOUND_MEDIA[media.mimeType]) throw new WhatsAppProviderError("invalid media", "permanent");
      const bytes = await storage().get(media.storageKey);
      ({ waMessageId } = await provider.sendMedia(to, {
        kind: OUTBOUND_MEDIA[media.mimeType].kind,
        bytes,
        mimeType: media.mimeType,
        fileName: media.fileName ?? "file",
        caption: m.body,
      }));
    }
  } catch (e) {
    const err =
      e instanceof WhatsAppProviderError ? e : new WhatsAppProviderError(e instanceof Error ? e.message : String(e), "retryable");
    if (err.kind === "permanent") {
      await fail(err.code ?? "PERMANENT", err.message);
      throw new PermanentJobError(`WhatsApp rejected message ${m.id}: ${err.code ?? ""} ${err.message}`);
    }
    // Give the message back to the queue state for the retry.
    await withSystemTx((tx) => tx.update(schema.messages).set({ status: "queued" }).where(and(eq(schema.messages.id, m.id), eq(schema.messages.status, "sending"))));
    if (opts.finalAttempt) {
      await fail(err.code ?? "SEND_FAILED", err.message);
      throw err;
    }
    if (err.kind === "rate_limited") throw new RetryJobLater(new Date(Date.now() + 60_000), "WhatsApp rate limit");
    logger().warn({ messageId: m.id, ...errorFields(err) }, "whatsapp send failed, will retry");
    throw err;
  }

  await withSystemTx(async (tx) => {
    const now = new Date();
    await tx.execute(sql`
      update public.messages set wa_message_id = ${waMessageId},
        status = case when status in ('queued', 'sending') then 'sent' else status end,
        sent_at = coalesce(sent_at, now()), error_code = null, error_message = null
      where id = ${m.id}`);
    await tx.update(schema.conversations).set({ lastOutboundAt: now }).where(eq(schema.conversations.id, conv.id));
    await recordUsage(tx, { tenantId: m.tenantId, metric: "whatsapp_messages", quantity: 1, refType: "message", refId: m.id, idempotencyKey: `wa-msg:${m.id}` });
    const ctx = systemCtx(m.tenantId, { actorType: actorFor(m.senderType), userId: m.senderUserId });
    const [recent] = await tx
      .select({ id: schema.activities.id })
      .from(schema.activities)
      .where(
        and(
          eq(schema.activities.tenantId, m.tenantId),
          eq(schema.activities.contactId, contact.id),
          eq(schema.activities.type, "whatsapp_out"),
          gt(schema.activities.occurredAt, new Date(now.getTime() - 30 * 60_000)),
        ),
      )
      .limit(1);
    if (!recent) {
      await recordActivity(tx, ctx, { type: "whatsapp_out", contactId: contact.id, body: (m.body ?? "").slice(0, 300), metadata: { conversationId: conv.id } });
    }
    await emitEvent(tx, ctx, { type: "message.sent", entityType: "message", entityId: m.id, data: { conversationId: conv.id, contactId: contact.id, messageType: m.type } });
  });
}

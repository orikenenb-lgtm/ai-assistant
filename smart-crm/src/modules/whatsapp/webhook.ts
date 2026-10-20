import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { schema, withSystemTx, type Tx } from "@/server/db";
import { systemCtx } from "@/server/context";
import { sha256Hex } from "@/server/crypto";
import { env } from "@/server/env";
import { emitEvent } from "@/server/events";
import { enqueueJob } from "@/server/jobs/queue";
import { errorFields, logger } from "@/server/logger";
import { normalizePhone, waIdToE164 } from "@/lib/phone";
import { recordActivity } from "@/modules/crm/activities";
import { recordConsent } from "@/modules/crm/contacts/service";
import { notify } from "@/modules/notifications/service";
import type { AccountRow } from "./accounts";
import { isOptOut, wantsHuman } from "./keywords";
import { verifyMetaSignature } from "./signature";

/* ------------------------------------------------------- payload shapes */

type MetaMedia = { id?: string; mime_type?: string; sha256?: string; caption?: string; filename?: string };
export type MetaInboundMessage = {
  id: string;
  from: string;
  timestamp?: string;
  type: string;
  text?: { body?: string };
  image?: MetaMedia;
  video?: MetaMedia;
  audio?: MetaMedia;
  sticker?: MetaMedia;
  document?: MetaMedia;
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
  contacts?: { name?: { formatted_name?: string }; phones?: { phone?: string }[] }[];
  interactive?: { type?: string; button_reply?: { title?: string }; list_reply?: { title?: string } };
  button?: { text?: string };
  reaction?: { emoji?: string; message_id?: string };
};
export type MetaStatus = {
  id: string;
  status: "sent" | "delivered" | "read" | "failed" | string;
  timestamp?: string;
  recipient_id?: string;
  errors?: { code?: number; title?: string; message?: string; error_data?: { details?: string } }[];
};
type MetaValue = {
  metadata?: { phone_number_id?: string; display_phone_number?: string };
  contacts?: { wa_id?: string; profile?: { name?: string } }[];
  messages?: MetaInboundMessage[];
  statuses?: MetaStatus[];
};
export type MetaWebhookPayload = { object?: string; entry?: { id?: string; changes?: { field?: string; value?: MetaValue }[] }[] };

/** Max accepted webhook body (Meta batches are small; this blocks abuse). */
export const MAX_WEBHOOK_BYTES = 512 * 1024;

/* ------------------------------------------------------------- ingestion */

export type IngestResult = { status: 200 | 400 | 401 | 413; eventId?: string; duplicate?: boolean };

/**
 * Verifies the signature, persists the raw event (deduplicated by body hash)
 * and enqueues processing. Must return fast — Meta retries slow webhooks.
 */
export async function ingestWhatsAppWebhook(rawBody: string, signatureHeader: string | null): Promise<IngestResult> {
  if (Buffer.byteLength(rawBody) > MAX_WEBHOOK_BYTES) return { status: 413 };
  if (!verifyMetaSignature(rawBody, signatureHeader, env().META_APP_SECRET)) {
    logger().warn({ hasSignature: Boolean(signatureHeader) }, "whatsapp webhook rejected: bad signature");
    return { status: 401 };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { status: 400 };
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return { status: 400 };
  return withSystemTx(async (tx) => {
    const [row] = await tx
      .insert(schema.webhookEvents)
      .values({ provider: "whatsapp", eventKey: sha256Hex(rawBody), signatureValid: true, payload: payload as Record<string, unknown> })
      .onConflictDoNothing()
      .returning({ id: schema.webhookEvents.id });
    if (!row) return { status: 200 as const, duplicate: true };
    await enqueueJob(tx, {
      tenantId: null,
      type: "whatsapp.process_webhook",
      payload: { webhookEventId: row.id },
      idempotencyKey: `wa-webhook:${row.id}`,
      priority: 10,
    });
    return { status: 200 as const, eventId: row.id };
  });
}

/* ------------------------------------------------------------ processing */

const STATUS_RANK_SQL = sql`(case status when 'queued' then 0 when 'sending' then 1 when 'sent' then 2 when 'delivered' then 3 when 'read' then 4 else 99 end)`;
const RANK: Record<string, number> = { sent: 2, delivered: 3, read: 4 };
const MEDIA_TYPES = new Set(["image", "video", "audio", "sticker", "document"]);
const ALLOWED_TYPES = new Set(["text", "image", "document", "audio", "video", "sticker", "location", "contacts", "interactive", "reaction", "button"]);

function tsToDate(ts: string | undefined): Date {
  const n = Number(ts);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : new Date();
}

/** Maps a Meta message object to our columns. */
export function mapInbound(msg: MetaInboundMessage): { type: string; body: string | null; media: Record<string, unknown> | null } {
  const type = ALLOWED_TYPES.has(msg.type) ? msg.type : "unsupported";
  if (type === "text") return { type, body: msg.text?.body?.slice(0, 4096) ?? "", media: null };
  if (MEDIA_TYPES.has(type)) {
    const m = (msg as unknown as Record<string, MetaMedia | undefined>)[type] ?? {};
    const ext = (m.mime_type?.split("/")[1] ?? "bin").split(";")[0];
    return {
      type,
      body: m.caption?.slice(0, 4096) ?? null,
      media: { mediaId: m.id ?? null, mimeType: m.mime_type ?? "application/octet-stream", fileName: m.filename ?? `${type}.${ext}`, sha256: m.sha256 ?? null },
    };
  }
  if (type === "location") {
    const l = msg.location ?? {};
    return { type, body: [l.name, l.address, l.latitude !== undefined ? `${l.latitude},${l.longitude}` : null].filter(Boolean).join(" · ").slice(0, 4096), media: null };
  }
  if (type === "contacts") {
    return { type, body: (msg.contacts ?? []).map((c) => [c.name?.formatted_name, c.phones?.[0]?.phone].filter(Boolean).join(" ")).join("\n").slice(0, 4096), media: null };
  }
  if (type === "interactive") return { type, body: msg.interactive?.button_reply?.title ?? msg.interactive?.list_reply?.title ?? null, media: null };
  if (type === "button") return { type, body: msg.button?.text ?? null, media: null };
  if (type === "reaction") return { type, body: msg.reaction?.emoji ?? null, media: { reactsTo: msg.reaction?.message_id ?? null } };
  return { type, body: null, media: null };
}

function preview(type: string, body: string | null): string {
  const icon: Record<string, string> = { image: "📷", video: "🎬", audio: "🎤", document: "📄", sticker: "🙂", location: "📍", contacts: "👤" };
  return `${icon[type] ? `${icon[type]} ` : ""}${body ?? ""}`.trim().slice(0, 200) || (icon[type] ?? "…");
}

async function managersOf(tx: Tx, tenantId: string): Promise<string[]> {
  const rows = await tx
    .select({ userId: schema.memberships.userId })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.tenantId, tenantId), eq(schema.memberships.status, "active"), inArray(schema.memberships.role, ["owner", "manager"])));
  return rows.map((r) => r.userId);
}

/** Stores one inbound message (idempotent on the WhatsApp message id). */
export async function processInboundMessage(account: AccountRow, msg: MetaInboundMessage, profileName: string | undefined) {
  const tenantId = account.tenantId;
  const ctx = systemCtx(tenantId, { actorType: "webhook" });
  const phone = normalizePhone(waIdToE164(msg.from)) ?? (/^\+[1-9]\d{6,14}$/.test(waIdToE164(msg.from)) ? waIdToE164(msg.from) : null);
  if (!phone || !msg.id) {
    logger().warn({ tenantId, from: msg.from }, "whatsapp inbound message with invalid sender ignored");
    return;
  }
  await withSystemTx(async (tx) => {
    const [dupe] = await tx.select({ id: schema.messages.id }).from(schema.messages).where(eq(schema.messages.waMessageId, msg.id)).limit(1);
    if (dupe) return;
    // Serialize concurrent first messages from the same number (one contact, one conversation).
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`wa:${tenantId}:${phone}`}))`);

    let [contact] = await tx
      .select()
      .from(schema.contacts)
      .where(and(eq(schema.contacts.tenantId, tenantId), eq(schema.contacts.phone, phone), sql`${schema.contacts.deletedAt} is null`))
      .orderBy(schema.contacts.createdAt)
      .limit(1);
    if (!contact) {
      const parts = (profileName ?? "").trim().split(/\s+/).filter(Boolean);
      [contact] = await tx
        .insert(schema.contacts)
        .values({
          tenantId,
          firstName: (parts.shift() ?? "").slice(0, 100),
          lastName: parts.join(" ").slice(0, 100),
          phone,
          source: "whatsapp",
          lifecycleStage: "lead",
        })
        .returning();
      await recordActivity(tx, ctx, { type: "contact_created", contactId: contact.id, metadata: { source: "whatsapp" } });
      await emitEvent(tx, ctx, { type: "contact.created", entityType: "contact", entityId: contact.id, data: { source: "whatsapp" } });
    }

    const [conv] = await tx.execute<{
      id: string;
      status: string;
      assignee_id: string | null;
      unread_count: number;
      inserted: boolean;
    }>(sql`
      insert into public.conversations (tenant_id, whatsapp_account_id, contact_id, status)
      values (${tenantId}, ${account.id}, ${contact.id}, 'open')
      on conflict (whatsapp_account_id, contact_id) do update set updated_at = now()
      returning id, status, assignee_id, unread_count, (xmax = 0) as inserted`);

    const createdAt = tsToDate(msg.timestamp);
    const { type, body, media } = mapInbound(msg);
    const [message] = await tx
      .insert(schema.messages)
      .values({
        tenantId,
        conversationId: conv.id,
        direction: "inbound",
        type,
        body,
        media,
        waMessageId: msg.id,
        status: "received",
        senderType: "contact",
        createdAt,
      })
      .onConflictDoNothing()
      .returning({ id: schema.messages.id });
    if (!message) return;

    const handoff = type === "text" && wantsHuman(body);
    await tx.execute(sql`
      update public.conversations set
        last_message_at = greatest(coalesce(last_message_at, ${createdAt.toISOString()}::timestamptz), ${createdAt.toISOString()}::timestamptz),
        last_message_preview = ${preview(type, body)},
        last_inbound_at = greatest(coalesce(last_inbound_at, ${createdAt.toISOString()}::timestamptz), ${createdAt.toISOString()}::timestamptz),
        unread_count = unread_count + 1,
        status = 'open',
        closed_at = null
        ${handoff ? sql`, needs_attention = true, handoff_state = 'human'` : sql``}
      where id = ${conv.id}`);

    if (media && typeof media.mediaId === "string") {
      await enqueueJob(tx, { tenantId, type: "whatsapp.download_media", payload: { messageId: message.id }, idempotencyKey: `wa-media:${message.id}` });
    }

    if (type === "text" && isOptOut(body)) {
      await recordConsent(tx, ctx, contact.id, { status: "opted_out", source: "inbound_keyword", evidence: `WhatsApp: "${(body ?? "").slice(0, 200)}"` });
    }

    // One timeline entry per conversation burst (not per message).
    const [recent] = await tx
      .select({ id: schema.activities.id })
      .from(schema.activities)
      .where(
        and(
          eq(schema.activities.tenantId, tenantId),
          eq(schema.activities.contactId, contact.id),
          eq(schema.activities.type, "whatsapp_in"),
          gt(schema.activities.occurredAt, new Date(createdAt.getTime() - 30 * 60_000)),
        ),
      )
      .limit(1);
    if (!recent) {
      await recordActivity(tx, ctx, { type: "whatsapp_in", contactId: contact.id, body: preview(type, body), occurredAt: createdAt, metadata: { conversationId: conv.id } });
    }

    await emitEvent(tx, ctx, {
      type: "message.received",
      entityType: "message",
      entityId: message.id,
      data: { conversationId: conv.id, contactId: contact.id, accountId: account.id, messageType: type, text: body?.slice(0, 1000) ?? null },
    });

    const name = `${contact.firstName} ${contact.lastName}`.trim() || phone;
    const link = `/inbox?c=${conv.id}`;
    const reopened = conv.inserted || conv.status === "closed";
    if (handoff) {
      const targets = conv.assignee_id ? [conv.assignee_id] : await managersOf(tx, tenantId);
      for (const userId of targets) {
        await notify(tx, {
          tenantId,
          userId,
          type: "message_received",
          title: { he: `${name} מבקש/ת לדבר עם נציג`, en: `${name} asked for a human agent` },
          body: body ?? undefined,
          link,
        });
      }
    } else if (conv.assignee_id) {
      if (Number(conv.unread_count) === 0) {
        await notify(tx, { tenantId, userId: conv.assignee_id, type: "message_received", title: { he: `הודעה חדשה מ-${name}`, en: `New message from ${name}` }, body: preview(type, body), link });
      }
    } else if (reopened) {
      for (const userId of await managersOf(tx, tenantId)) {
        await notify(tx, { tenantId, userId, type: "message_received", title: { he: `שיחה חדשה מ-${name}`, en: `New conversation from ${name}` }, body: preview(type, body), link });
      }
    }
  });
}

/** Applies a delivery status; statuses only move forward (sent → delivered → read). */
export async function processStatus(account: AccountRow, st: MetaStatus) {
  if (!st.id) return;
  const ts = tsToDate(st.timestamp).toISOString();
  await withSystemTx(async (tx) => {
    if (st.status === "failed") {
      const err = st.errors?.[0];
      const rows = await tx.execute<{ id: string; conversation_id: string }>(sql`
        update public.messages set status = 'failed', failed_at = ${ts}::timestamptz,
          error_code = ${err?.code !== undefined ? String(err.code) : null},
          error_message = ${(err?.error_data?.details ?? err?.message ?? err?.title ?? "failed").slice(0, 500)}
        where wa_message_id = ${st.id} and tenant_id = ${account.tenantId} and direction = 'outbound'
          and status in ('queued', 'sending', 'sent')
        returning id, conversation_id`);
      if (rows[0]) {
        const ctx = systemCtx(account.tenantId, { actorType: "webhook" });
        await emitEvent(tx, ctx, { type: "message.failed", entityType: "message", entityId: rows[0].id, data: { conversationId: rows[0].conversation_id, errorCode: err?.code ?? null } });
      }
      return;
    }
    const rank = RANK[st.status];
    if (rank === undefined) return;
    await tx.execute(sql`
      update public.messages set
        status = ${st.status},
        sent_at = coalesce(sent_at, ${ts}::timestamptz),
        delivered_at = case when ${rank} >= 3 then coalesce(delivered_at, ${ts}::timestamptz) else delivered_at end,
        read_at = case when ${rank} >= 4 then coalesce(read_at, ${ts}::timestamptz) else read_at end
      where wa_message_id = ${st.id} and tenant_id = ${account.tenantId} and direction = 'outbound'
        and ${STATUS_RANK_SQL} < ${rank}`);
  });
}

/** Job handler body: processes a stored webhook event exactly once. */
export async function processWebhookEvent(eventId: string) {
  const [ev] = await withSystemTx((tx) => tx.select().from(schema.webhookEvents).where(eq(schema.webhookEvents.id, eventId)));
  if (!ev || ev.status === "processed" || ev.status === "ignored") return;
  await withSystemTx((tx) =>
    tx.update(schema.webhookEvents).set({ status: "processing", attempts: sql`${schema.webhookEvents.attempts} + 1` }).where(eq(schema.webhookEvents.id, eventId)),
  );
  const payload = ev.payload as MetaWebhookPayload;
  let matchedTenant: string | null = null;
  try {
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== "messages" || !change.value) continue;
        const value = change.value;
        const pnid = value.metadata?.phone_number_id;
        if (!pnid) continue;
        const [account] = await withSystemTx((tx) => tx.select().from(schema.whatsappAccounts).where(eq(schema.whatsappAccounts.phoneNumberId, pnid)));
        if (!account) {
          logger().info({ phoneNumberId: pnid }, "whatsapp webhook for unknown phone number id ignored");
          continue;
        }
        // The event must come from the WABA the account was verified against, and the account must be live.
        if (entry.id !== account.wabaId || account.status !== "active") {
          logger().warn({ phoneNumberId: pnid, entryId: entry.id, status: account.status }, "whatsapp webhook ignored: WABA mismatch or inactive account");
          continue;
        }
        matchedTenant = account.tenantId;
        const names = new Map((value.contacts ?? []).map((c) => [c.wa_id ?? "", c.profile?.name]));
        for (const msg of value.messages ?? []) await processInboundMessage(account, msg, names.get(msg.from));
        for (const st of value.statuses ?? []) await processStatus(account, st);
      }
    }
    await withSystemTx((tx) =>
      tx
        .update(schema.webhookEvents)
        .set({ status: matchedTenant ? "processed" : "ignored", tenantId: matchedTenant, processedAt: new Date(), error: null })
        .where(eq(schema.webhookEvents.id, eventId)),
    );
  } catch (e) {
    logger().error({ eventId, ...errorFields(e) }, "whatsapp webhook processing failed");
    await withSystemTx((tx) =>
      tx
        .update(schema.webhookEvents)
        .set({ status: "failed", tenantId: matchedTenant, error: (e instanceof Error ? e.message : String(e)).slice(0, 1000) })
        .where(eq(schema.webhookEvents.id, eventId)),
    );
    throw e;
  }
}

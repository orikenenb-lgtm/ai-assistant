import { and, asc, desc, eq, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { schema, type Tx } from "@/server/db";
import { assertCan, assertCanWrite, type ServiceCtx } from "@/server/context";
import { audit } from "@/server/audit";
import { emitEvent } from "@/server/events";
import { AppError } from "@/server/errors";
import { enqueueJob } from "@/server/jobs/queue";
import { hitRateLimit } from "@/server/rate-limit";
import { assertFeature, assertMonthlyQuota, getEntitlements } from "@/modules/billing/entitlements";
import { notify } from "@/modules/notifications/service";
import { likePattern } from "@/modules/search/service";
import { renderTemplate, templateParts } from "./templates";
import { serviceWindow } from "./window";

/* --------------------------------------------------------------- schemas */

export const conversationFilterSchema = z.object({
  assignee: z.enum(["mine", "unassigned", "all"]).default("all"),
  status: z.enum(["open", "pending", "closed", "all"]).default("open"),
  attention: z.boolean().default(false),
  q: z.string().trim().max(100).optional(),
  accountId: z.uuid().optional(),
  before: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type ConversationFilter = z.infer<typeof conversationFilterSchema>;

export const outboundSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string().trim().min(1).max(4096) }),
  z.object({
    kind: z.literal("template"),
    templateId: z.uuid(),
    headerParams: z.array(z.string().trim().min(1).max(1024)).max(10).default([]),
    bodyParams: z.array(z.string().trim().min(1).max(1024)).max(20).default([]),
  }),
  z.object({
    kind: z.literal("media"),
    storageKey: z.string().min(1).max(500),
    mimeType: z.string().max(127),
    fileName: z.string().max(255),
    sizeBytes: z.number().int().positive(),
    caption: z.string().trim().max(1024).optional(),
  }),
]);
export type OutboundInput = z.infer<typeof outboundSchema>;

/* ------------------------------------------------------------------ list */

export type ConversationListItem = {
  id: string;
  status: "open" | "pending" | "closed";
  contactId: string;
  contactName: string;
  contactPhone: string | null;
  accountId: string;
  accountName: string;
  assigneeId: string | null;
  assigneeName: string | null;
  lastMessageAt: Date | null;
  lastMessagePreview: string | null;
  lastInboundAt: Date | null;
  unreadCount: number;
  needsAttention: boolean;
  handoffState: "bot" | "human";
};

const contactName = (c: { firstName: string; lastName: string; phone: string | null }) => `${c.firstName} ${c.lastName}`.trim() || c.phone || "—";

export async function listConversations(ctx: ServiceCtx, f: ConversationFilter): Promise<{ items: ConversationListItem[]; hasMore: boolean }> {
  assertCan(ctx, "inbox.view");
  const conds: (SQL | undefined)[] = [eq(schema.conversations.tenantId, ctx.tenantId)];
  if (f.status !== "all") conds.push(eq(schema.conversations.status, f.status));
  if (f.assignee === "mine" && ctx.userId) conds.push(eq(schema.conversations.assigneeId, ctx.userId));
  if (f.assignee === "unassigned") conds.push(isNull(schema.conversations.assigneeId));
  if (f.attention) conds.push(eq(schema.conversations.needsAttention, true));
  if (f.accountId) conds.push(eq(schema.conversations.whatsappAccountId, f.accountId));
  if (f.before) conds.push(lt(schema.conversations.lastMessageAt, f.before));
  if (f.q) {
    const digits = f.q.replace(/\D/g, "");
    conds.push(
      or(
        sql`${schema.contacts.searchText} like ${likePattern(f.q)}`,
        digits.length >= 3 ? sql`${schema.contacts.phone} like ${`%${digits}%`}` : undefined,
      ),
    );
  }
  return ctx.run(async (tx) => {
    const rows = await tx
      .select({ c: schema.conversations, contact: schema.contacts, accountName: schema.whatsappAccounts.displayName, assigneeName: schema.profiles.fullName })
      .from(schema.conversations)
      .innerJoin(schema.contacts, eq(schema.contacts.id, schema.conversations.contactId))
      .innerJoin(schema.whatsappAccounts, eq(schema.whatsappAccounts.id, schema.conversations.whatsappAccountId))
      .leftJoin(schema.profiles, eq(schema.profiles.id, schema.conversations.assigneeId))
      .where(and(...conds))
      .orderBy(sql`${schema.conversations.lastMessageAt} desc nulls last`, desc(schema.conversations.createdAt))
      .limit(f.limit + 1);
    return {
      hasMore: rows.length > f.limit,
      items: rows.slice(0, f.limit).map((r) => ({
        id: r.c.id,
        status: r.c.status as ConversationListItem["status"],
        contactId: r.contact.id,
        contactName: contactName(r.contact),
        contactPhone: r.contact.phone,
        accountId: r.c.whatsappAccountId,
        accountName: r.accountName,
        assigneeId: r.c.assigneeId,
        assigneeName: r.assigneeName,
        lastMessageAt: r.c.lastMessageAt,
        lastMessagePreview: r.c.lastMessagePreview,
        lastInboundAt: r.c.lastInboundAt,
        unreadCount: r.c.unreadCount,
        needsAttention: r.c.needsAttention,
        handoffState: r.c.handoffState as ConversationListItem["handoffState"],
      })),
    };
  });
}

/* ---------------------------------------------------------------- thread */

export type ThreadMessage = {
  id: string;
  direction: "inbound" | "outbound";
  type: string;
  body: string | null;
  media: { mimeType?: string; fileName?: string; storageKey?: string; size?: number; tooLarge?: boolean } | null;
  templateName: string | null;
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
  senderType: string;
  senderName: string | null;
  createdAt: Date;
};
export type ThreadNote = { id: string; body: string; authorName: string | null; createdAt: Date };

async function loadConversation(tx: Tx, tenantId: string, id: string) {
  const [row] = await tx
    .select({ c: schema.conversations, contact: schema.contacts, account: schema.whatsappAccounts })
    .from(schema.conversations)
    .innerJoin(schema.contacts, eq(schema.contacts.id, schema.conversations.contactId))
    .innerJoin(schema.whatsappAccounts, eq(schema.whatsappAccounts.id, schema.conversations.whatsappAccountId))
    .where(and(eq(schema.conversations.id, id), eq(schema.conversations.tenantId, tenantId)));
  if (!row) throw new AppError("NOT_FOUND", "errors.notFound");
  return row;
}

export async function getThread(ctx: ServiceCtx, conversationId: string, opts: { before?: Date; limit?: number; markRead?: boolean } = {}) {
  assertCan(ctx, "inbox.view");
  const limit = Math.min(opts.limit ?? 80, 200);
  return ctx.run(async (tx) => {
    const { c, contact, account } = await loadConversation(tx, ctx.tenantId, conversationId);
    const rows = await tx
      .select({ m: schema.messages, senderName: schema.profiles.fullName })
      .from(schema.messages)
      .leftJoin(schema.profiles, eq(schema.profiles.id, schema.messages.senderUserId))
      .where(
        and(
          eq(schema.messages.tenantId, ctx.tenantId),
          eq(schema.messages.conversationId, conversationId),
          opts.before ? lt(schema.messages.createdAt, opts.before) : undefined,
        ),
      )
      .orderBy(desc(schema.messages.createdAt))
      .limit(limit + 1);
    const notes = await tx
      .select({ n: schema.conversationNotes, authorName: schema.profiles.fullName })
      .from(schema.conversationNotes)
      .leftJoin(schema.profiles, eq(schema.profiles.id, schema.conversationNotes.authorId))
      .where(and(eq(schema.conversationNotes.tenantId, ctx.tenantId), eq(schema.conversationNotes.conversationId, conversationId)))
      .orderBy(asc(schema.conversationNotes.createdAt));

    if (opts.markRead && c.unreadCount > 0 && !ctx.readOnly && ctx.can("inbox.reply")) {
      await tx.update(schema.conversations).set({ unreadCount: 0 }).where(eq(schema.conversations.id, c.id));
      await enqueueJob(tx, { tenantId: ctx.tenantId, type: "whatsapp.mark_read", payload: { conversationId: c.id } });
    }

    return {
      conversation: {
        id: c.id,
        status: c.status as "open" | "pending" | "closed",
        assigneeId: c.assigneeId,
        handoffState: c.handoffState as "bot" | "human",
        needsAttention: c.needsAttention,
        lastInboundAt: c.lastInboundAt,
        unreadCount: opts.markRead ? 0 : c.unreadCount,
      },
      contact: {
        id: contact.id,
        name: contactName(contact),
        phone: contact.phone,
        email: contact.email,
        consent: contact.whatsappConsent as "unknown" | "opted_in" | "opted_out",
        lifecycleStage: contact.lifecycleStage,
        companyId: contact.companyId,
      },
      account: { id: account.id, displayName: account.displayName, phoneNumber: account.phoneNumber, provider: account.provider, status: account.status },
      window: (() => {
        const w = serviceWindow(c.lastInboundAt);
        return { ...w, msLeft: w.open && w.closesAt ? w.closesAt.getTime() - Date.now() : 0 };
      })(),
      hasMore: rows.length > limit,
      messages: rows
        .slice(0, limit)
        .reverse()
        .map(
          (r): ThreadMessage => ({
            id: r.m.id,
            direction: r.m.direction as ThreadMessage["direction"],
            type: r.m.type,
            body: r.m.body,
            media: (r.m.media as ThreadMessage["media"]) ?? null,
            templateName: (r.m.template as { name?: string } | null)?.name ?? null,
            status: r.m.status,
            errorCode: r.m.errorCode,
            errorMessage: r.m.errorMessage,
            senderType: r.m.senderType,
            senderName: r.senderName,
            createdAt: r.m.createdAt,
          }),
        ),
      notes: notes.map((n) => ({ id: n.n.id, body: n.n.body, authorName: n.authorName, createdAt: n.n.createdAt })),
    };
  });
}

/* ------------------------------------------------- open by contact (deep link) */

/** Finds or creates the conversation for a contact (used by "WhatsApp" buttons). */
export async function openConversationForContact(ctx: ServiceCtx, contactId: string, accountId?: string): Promise<string> {
  assertCan(ctx, "inbox.view");
  return ctx.run(async (tx) => {
    const [contact] = await tx
      .select()
      .from(schema.contacts)
      .where(and(eq(schema.contacts.id, contactId), eq(schema.contacts.tenantId, ctx.tenantId), isNull(schema.contacts.deletedAt)));
    if (!contact) throw new AppError("NOT_FOUND", "errors.notFound");
    if (!contact.phone) throw new AppError("PRECONDITION", "inbox.contactNoPhone");
    const accounts = await tx
      .select()
      .from(schema.whatsappAccounts)
      .where(and(eq(schema.whatsappAccounts.tenantId, ctx.tenantId), eq(schema.whatsappAccounts.status, "active")))
      .orderBy(asc(schema.whatsappAccounts.createdAt));
    const account = accountId ? accounts.find((a) => a.id === accountId) : accounts[0];
    if (!account) throw new AppError("PRECONDITION", "inbox.noAccount");
    const [existing] = await tx
      .select({ id: schema.conversations.id })
      .from(schema.conversations)
      .where(and(eq(schema.conversations.whatsappAccountId, account.id), eq(schema.conversations.contactId, contact.id)));
    if (existing) return existing.id;
    if (ctx.readOnly) throw new AppError("READ_ONLY", "errors.readOnly");
    const [created] = await tx
      .insert(schema.conversations)
      .values({ tenantId: ctx.tenantId, whatsappAccountId: account.id, contactId: contact.id, status: "open", assigneeId: ctx.actorType === "user" ? ctx.userId : null })
      .onConflictDoNothing()
      .returning({ id: schema.conversations.id });
    if (created) return created.id;
    const [again] = await tx
      .select({ id: schema.conversations.id })
      .from(schema.conversations)
      .where(and(eq(schema.conversations.whatsappAccountId, account.id), eq(schema.conversations.contactId, contact.id)));
    return again.id;
  });
}

/* ------------------------------------------------------------------ send */

const senderTypeOf = (ctx: ServiceCtx) =>
  ctx.actorType === "user" ? "user" : ctx.actorType === "ai" ? "ai" : ctx.actorType === "automation" ? "automation" : "system";

/**
 * Queues an outbound WhatsApp message after every compliance check: plan,
 * quota, consent, the 24-hour window (templates outside it) and rate limits.
 * The worker job `whatsapp.send` performs delivery.
 */
export async function sendMessage(ctx: ServiceCtx, conversationId: string, input: OutboundInput, opts: { clientKey?: string } = {}) {
  assertCanWrite(ctx, "inbox.reply");
  return ctx.run(async (tx) => {
    assertFeature(await getEntitlements(tx, ctx.tenantId), "whatsapp");
    const { c, contact, account } = await loadConversation(tx, ctx.tenantId, conversationId);
    if (opts.clientKey) {
      const [dupe] = await tx
        .select({ id: schema.messages.id })
        .from(schema.messages)
        .where(and(eq(schema.messages.tenantId, ctx.tenantId), eq(schema.messages.clientKey, opts.clientKey)));
      if (dupe) return { id: dupe.id, duplicate: true };
    }
    if (account.status !== "active") throw new AppError("PRECONDITION", "inbox.accountInactive");
    if (!contact.phone) throw new AppError("PRECONDITION", "inbox.contactNoPhone");
    if (contact.whatsappConsent === "opted_out") throw new AppError("PRECONDITION", "inbox.optedOut");
    const window = serviceWindow(c.lastInboundAt);

    let type: string;
    let body: string | null;
    let media: Record<string, unknown> | null = null;
    let template: Record<string, unknown> | null = null;
    if (input.kind === "template") {
      const [tpl] = await tx
        .select()
        .from(schema.messageTemplates)
        .where(
          and(
            eq(schema.messageTemplates.id, input.templateId),
            eq(schema.messageTemplates.tenantId, ctx.tenantId),
            eq(schema.messageTemplates.whatsappAccountId, account.id),
          ),
        );
      if (!tpl) throw new AppError("NOT_FOUND", "errors.notFound");
      if (tpl.status !== "APPROVED") throw new AppError("PRECONDITION", "inbox.templateNotApproved");
      if (tpl.category === "MARKETING" && contact.whatsappConsent !== "opted_in") throw new AppError("PRECONDITION", "inbox.marketingNeedsOptIn");
      const parts = templateParts(tpl.components);
      if (input.bodyParams.length !== parts.bodyParams || input.headerParams.length !== parts.headerParams) {
        throw new AppError("VALIDATION", "inbox.templateParams");
      }
      type = "template";
      body = renderTemplate(tpl.components, { header: input.headerParams, body: input.bodyParams }).slice(0, 4096);
      template = {
        name: tpl.name,
        language: tpl.language,
        components: [
          ...(input.headerParams.length ? [{ type: "header", parameters: input.headerParams.map((text) => ({ type: "text", text })) }] : []),
          ...(input.bodyParams.length ? [{ type: "body", parameters: input.bodyParams.map((text) => ({ type: "text", text })) }] : []),
        ],
      };
    } else {
      if (!window.open) throw new AppError("PRECONDITION", "inbox.windowClosed");
      if (input.kind === "text") {
        type = "text";
        body = input.text;
      } else {
        if (!input.storageKey.startsWith(`${ctx.tenantId}/`)) throw new AppError("FORBIDDEN", "errors.forbidden");
        type = input.mimeType.startsWith("image/") ? "image" : input.mimeType.startsWith("audio/") ? "audio" : input.mimeType.startsWith("video/") ? "video" : "document";
        body = input.caption ?? null;
        media = { storageKey: input.storageKey, mimeType: input.mimeType, fileName: input.fileName, size: input.sizeBytes };
      }
    }

    await assertMonthlyQuota(tx, ctx.tenantId, "whatsapp_messages", 1);
    if (ctx.userId) {
      const rl = await hitRateLimit(`wa-enqueue:${account.id}:${ctx.userId}`, 30, 60);
      if (!rl.allowed) throw new AppError("RATE_LIMITED", "errors.rateLimited");
    }

    const [msg] = await tx
      .insert(schema.messages)
      .values({
        tenantId: ctx.tenantId,
        conversationId: c.id,
        direction: "outbound",
        type,
        body,
        media,
        template,
        status: "queued",
        senderType: senderTypeOf(ctx),
        senderUserId: ctx.userId,
        clientKey: opts.clientKey ?? null,
      })
      .returning({ id: schema.messages.id, createdAt: schema.messages.createdAt });
    const previewText = (body ?? (media ? `📎 ${String(media.fileName)}` : "")).slice(0, 200);
    await tx
      .update(schema.conversations)
      .set({
        lastMessageAt: msg.createdAt,
        lastMessagePreview: previewText,
        unreadCount: 0,
        ...(c.status === "closed" ? { status: "open", closedAt: null } : {}),
      })
      .where(eq(schema.conversations.id, c.id));
    await enqueueJob(tx, {
      tenantId: ctx.tenantId,
      type: "whatsapp.send",
      payload: { messageId: msg.id },
      idempotencyKey: `wa-send:${msg.id}`,
      maxAttempts: 6,
      priority: 5,
    });
    return { id: msg.id, duplicate: false };
  });
}

/* -------------------------------------------------- notes / assignment / status */

export async function addConversationNote(ctx: ServiceCtx, conversationId: string, body: string) {
  assertCanWrite(ctx, "inbox.reply");
  return ctx.run(async (tx) => {
    await loadConversation(tx, ctx.tenantId, conversationId);
    const [note] = await tx
      .insert(schema.conversationNotes)
      .values({ tenantId: ctx.tenantId, conversationId, authorId: ctx.userId, body })
      .returning({ id: schema.conversationNotes.id });
    return note;
  });
}

export async function assignConversation(ctx: ServiceCtx, conversationId: string, assigneeId: string | null) {
  assertCanWrite(ctx, "inbox.assign");
  const managerial = ctx.role === "owner" || ctx.role === "manager" || ctx.role === null;
  if (!managerial && assigneeId !== null && assigneeId !== ctx.userId) throw new AppError("FORBIDDEN", "inbox.agentsAssignSelf");
  await ctx.run(async (tx) => {
    const { c, contact } = await loadConversation(tx, ctx.tenantId, conversationId);
    if (!managerial && c.assigneeId && c.assigneeId !== ctx.userId) throw new AppError("FORBIDDEN", "inbox.agentsAssignSelf");
    if (c.assigneeId === assigneeId) return;
    if (assigneeId) {
      const [member] = await tx
        .select({ id: schema.memberships.id })
        .from(schema.memberships)
        .where(and(eq(schema.memberships.tenantId, ctx.tenantId), eq(schema.memberships.userId, assigneeId), eq(schema.memberships.status, "active")));
      if (!member) throw new AppError("VALIDATION", "errors.relatedMissing");
    }
    await tx.update(schema.conversations).set({ assigneeId, needsAttention: assigneeId ? false : c.needsAttention }).where(eq(schema.conversations.id, c.id));
    await audit(tx, ctx, { action: "conversation.assigned", entityType: "conversation", entityId: c.id, metadata: { from: c.assigneeId, to: assigneeId } });
    await emitEvent(tx, ctx, { type: "conversation.assigned", entityType: "conversation", entityId: c.id, data: { assigneeId, previousAssigneeId: c.assigneeId, contactId: contact.id } });
    if (assigneeId && assigneeId !== ctx.userId) {
      const name = contactName(contact);
      await notify(tx, {
        tenantId: ctx.tenantId,
        userId: assigneeId,
        type: "conversation_assigned",
        title: { he: `שויכה אליך שיחה עם ${name}`, en: `Conversation with ${name} was assigned to you` },
        link: `/inbox?c=${c.id}`,
      });
    }
  });
}

export async function setConversationStatus(ctx: ServiceCtx, conversationId: string, status: "open" | "pending" | "closed") {
  assertCanWrite(ctx, "inbox.reply");
  await ctx.run(async (tx) => {
    const { c, contact } = await loadConversation(tx, ctx.tenantId, conversationId);
    if (c.status === status) return;
    await tx
      .update(schema.conversations)
      .set({ status, closedAt: status === "closed" ? new Date() : null, ...(status === "closed" ? { needsAttention: false, unreadCount: 0 } : {}) })
      .where(eq(schema.conversations.id, c.id));
    await audit(tx, ctx, { action: `conversation.${status}`, entityType: "conversation", entityId: c.id, metadata: { from: c.status } });
    if (status === "closed") {
      await emitEvent(tx, ctx, { type: "conversation.closed", entityType: "conversation", entityId: c.id, data: { contactId: contact.id } });
    }
  });
}

export async function setHandoff(ctx: ServiceCtx, conversationId: string, state: "bot" | "human") {
  assertCanWrite(ctx, "inbox.reply");
  await ctx.run(async (tx) => {
    const { c } = await loadConversation(tx, ctx.tenantId, conversationId);
    await tx
      .update(schema.conversations)
      .set({ handoffState: state, ...(state === "human" ? { needsAttention: false } : {}) })
      .where(eq(schema.conversations.id, c.id));
    await audit(tx, ctx, { action: `conversation.handoff_${state}`, entityType: "conversation", entityId: c.id });
  });
}

/** Counters for the sidebar badges. */
export async function inboxCounts(ctx: ServiceCtx) {
  assertCan(ctx, "inbox.view");
  return ctx.run(async (tx) => {
    const [r] = await tx.execute<{ unread: number; mine: number; unassigned: number; attention: number }>(sql`
      select
        coalesce(sum(unread_count) filter (where status <> 'closed'), 0)::int as unread,
        count(*) filter (where status <> 'closed' and assignee_id = ${ctx.userId})::int as mine,
        count(*) filter (where status <> 'closed' and assignee_id is null)::int as unassigned,
        count(*) filter (where status <> 'closed' and needs_attention)::int as attention
      from public.conversations where tenant_id = ${ctx.tenantId}`);
    return { unread: Number(r?.unread ?? 0), mine: Number(r?.mine ?? 0), unassigned: Number(r?.unassigned ?? 0), attention: Number(r?.attention ?? 0) };
  });
}

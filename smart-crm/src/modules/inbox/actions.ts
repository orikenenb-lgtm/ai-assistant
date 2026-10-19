"use server";

import { z } from "zod";
import { tenantAction, type ActionResult } from "@/server/action";
import { drainWhatsAppJobsInDev } from "@/modules/whatsapp/dev";
import {
  addConversationNote,
  assignConversation,
  conversationFilterSchema,
  getThread,
  inboxCounts,
  listConversations,
  openConversationForContact,
  clientOutboundSchema,
  sendMessage,
  setConversationStatus,
  setHandoff,
  type ConversationListItem,
} from "./service";

const conv = z.object({ conversationId: z.uuid() });

export async function listConversationsAction(input: unknown): Promise<ActionResult<{ items: ConversationListItem[]; hasMore: boolean }>> {
  return tenantAction(input, { schema: conversationFilterSchema, permission: "inbox.view", write: false }, (f, { ctx }) => listConversations(ctx, f));
}

export async function getThreadAction(input: unknown): Promise<ActionResult<Awaited<ReturnType<typeof getThread>>>> {
  return tenantAction(
    input,
    { schema: conv.extend({ before: z.coerce.date().optional(), markRead: z.boolean().default(false) }), permission: "inbox.view", write: false },
    ({ conversationId, before, markRead }, { ctx }) => getThread(ctx, conversationId, { before, markRead }),
  );
}

export async function inboxCountsAction(): Promise<ActionResult<Awaited<ReturnType<typeof inboxCounts>>>> {
  return tenantAction({}, { schema: z.object({}), permission: "inbox.view", write: false }, (_, { ctx }) => inboxCounts(ctx));
}

export async function sendMessageAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return tenantAction(
    input,
    { schema: conv.extend({ message: clientOutboundSchema, clientKey: z.string().min(8).max(100).optional() }), permission: "inbox.reply" },
    async ({ conversationId, message, clientKey }, { ctx }) => {
      const r = await sendMessage(ctx, conversationId, message, { clientKey });
      await drainWhatsAppJobsInDev();
      return { id: r.id };
    },
  );
}

export async function addConversationNoteAction(input: unknown): Promise<ActionResult> {
  return tenantAction(input, { schema: conv.extend({ body: z.string().trim().min(1).max(4000) }), permission: "inbox.reply" }, async (d, { ctx }) => {
    await addConversationNote(ctx, d.conversationId, d.body);
    return null;
  });
}

export async function assignConversationAction(input: unknown): Promise<ActionResult> {
  return tenantAction(input, { schema: conv.extend({ assigneeId: z.uuid().nullable() }), permission: "inbox.assign" }, async (d, { ctx }) => {
    await assignConversation(ctx, d.conversationId, d.assigneeId);
    return null;
  });
}

export async function setConversationStatusAction(input: unknown): Promise<ActionResult> {
  return tenantAction(input, { schema: conv.extend({ status: z.enum(["open", "pending", "closed"]) }), permission: "inbox.reply" }, async (d, { ctx }) => {
    await setConversationStatus(ctx, d.conversationId, d.status);
    return null;
  });
}

export async function openConversationAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return tenantAction(
    input,
    { schema: z.object({ contactId: z.uuid(), accountId: z.uuid().optional() }), permission: "inbox.view", write: false },
    async ({ contactId, accountId }, { ctx }) => ({ id: await openConversationForContact(ctx, contactId, accountId) }),
  );
}

export async function setHandoffAction(input: unknown): Promise<ActionResult> {
  return tenantAction(input, { schema: conv.extend({ state: z.enum(["bot", "human"]) }), permission: "inbox.reply" }, async (d, { ctx }) => {
    await setHandoff(ctx, d.conversationId, d.state);
    return null;
  });
}

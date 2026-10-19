"use server";

import { getLocale } from "next-intl/server";
import { z } from "zod";
import { tenantAction, type ActionResult } from "@/server/action";
import { analyzeTrends, classifyLead, detectIntent, draftReply, recommendNextActions, summarizeContact, summarizeConversation } from "./features";
import { copilotChat, type ChatResult } from "./chat";
import { approveProposal, createProposal, listProposals, rejectProposal, PROPOSAL_TYPES, type ProposalView } from "./proposals";
import "./executors";
import { aiUsageSummary } from "./usage";

const locale = async () => ((await getLocale()) === "en" ? "en" : "he") as "he" | "en";
const ai = { permission: "ai.use" as const, write: false };

export async function copilotChatAction(input: unknown): Promise<ActionResult<ChatResult>> {
  return tenantAction(
    input,
    { schema: z.object({ history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(4000) })).min(1).max(30) }), ...ai },
    async ({ history }, { ctx }) => copilotChat(ctx, history, await locale()),
  );
}

export async function summarizeConversationAction(input: unknown) {
  return tenantAction(input, { schema: z.object({ conversationId: z.uuid() }), ...ai }, async ({ conversationId }, { ctx }) =>
    summarizeConversation(ctx, conversationId, await locale()),
  );
}

export async function draftReplyAction(input: unknown) {
  return tenantAction(
    input,
    { schema: z.object({ conversationId: z.uuid(), instructions: z.string().trim().max(500).optional() }), ...ai },
    async ({ conversationId, instructions }, { ctx }) => draftReply(ctx, conversationId, { locale: await locale(), instructions }),
  );
}

export async function detectIntentAction(input: unknown) {
  return tenantAction(input, { schema: z.object({ conversationId: z.uuid() }), ...ai }, async ({ conversationId }, { ctx }) =>
    detectIntent(ctx, conversationId, await locale()),
  );
}

export async function classifyLeadAction(input: unknown) {
  return tenantAction(input, { schema: z.object({ leadId: z.uuid() }), ...ai }, async ({ leadId }, { ctx }) => classifyLead(ctx, leadId, await locale()));
}

export async function summarizeContactAction(input: unknown) {
  return tenantAction(input, { schema: z.object({ contactId: z.uuid() }), ...ai }, async ({ contactId }, { ctx }) =>
    summarizeContact(ctx, contactId, await locale()),
  );
}

export async function nextActionsAction(input: unknown) {
  return tenantAction(
    input,
    { schema: z.object({ entityType: z.enum(["contact", "deal"]), entityId: z.uuid() }), ...ai },
    async ({ entityType, entityId }, { ctx }) => recommendNextActions(ctx, { type: entityType, id: entityId }, await locale()),
  );
}

export async function analyzeTrendsAction(input: unknown) {
  return tenantAction(input, { schema: z.object({ days: z.number().int().min(7).max(365) }), ...ai }, async ({ days }, { ctx }) =>
    analyzeTrends(ctx, days, await locale()),
  );
}

export async function createProposalAction(input: unknown) {
  return tenantAction(
    input,
    { schema: z.object({ actionType: z.enum(PROPOSAL_TYPES), payload: z.record(z.string(), z.unknown()), rationale: z.string().max(2000).optional() }), permission: "ai.use" },
    async (data, { ctx }) => {
      const p = await createProposal(ctx, data);
      return { id: p.id };
    },
  );
}

export async function listProposalsAction(input: unknown): Promise<ActionResult<ProposalView[]>> {
  return tenantAction(input, { schema: z.object({ status: z.enum(["pending", "all"]).default("pending") }), ...ai }, ({ status }, { ctx }) =>
    listProposals(ctx, { status }),
  );
}

export async function approveProposalAction(input: unknown) {
  return tenantAction(input, { schema: z.object({ id: z.uuid() }), permission: "ai.approve" }, ({ id }, { ctx }) => approveProposal(ctx, id));
}

export async function rejectProposalAction(input: unknown): Promise<ActionResult> {
  return tenantAction(input, { schema: z.object({ id: z.uuid() }), permission: "ai.approve" }, async ({ id }, { ctx }) => {
    await rejectProposal(ctx, id);
    return null;
  });
}

export async function aiUsageAction() {
  return tenantAction({}, { schema: z.object({}), ...ai }, (_, { ctx }) => aiUsageSummary(ctx));
}

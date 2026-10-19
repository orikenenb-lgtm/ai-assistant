import { and, desc, eq, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/server/db";
import { assertCan, assertCanWrite, type ServiceCtx } from "@/server/context";
import { audit } from "@/server/audit";
import { AppError, isAppError } from "@/server/errors";
import type { Permission } from "@/server/rbac/permissions";
import { registerJobHandler } from "@/server/jobs/runner";
import { registerSchedule } from "@/server/jobs/scheduler";
import { addNote } from "@/modules/crm/activities";
import { setContactTags } from "@/modules/crm/contacts/service";

/**
 * AI never writes directly. It creates proposals; a human with the right
 * permission approves, and the action then runs AS THAT HUMAN (their RBAC and
 * RLS apply), so the model can never exceed the approver's access.
 */
export const PROPOSAL_TYPES = [
  "create_task",
  "update_deal_stage",
  "update_lead_status",
  "send_whatsapp_message",
  "assign_conversation",
  "add_note",
  "add_tag",
] as const;
export type ProposalType = (typeof PROPOSAL_TYPES)[number];

type Executor = { permission: Permission; payload: z.ZodType; execute: (ctx: ServiceCtx, payload: unknown) => Promise<Record<string, unknown>> };
const executors = new Map<ProposalType, Executor>();

export function registerProposalExecutor<S extends z.ZodType>(
  type: ProposalType,
  def: { permission: Permission; payload: S; execute: (ctx: ServiceCtx, payload: z.infer<S>) => Promise<Record<string, unknown>> },
) {
  executors.set(type, def as unknown as Executor);
}

export function hasExecutor(type: ProposalType) {
  return executors.has(type);
}

registerProposalExecutor("add_note", {
  permission: "contacts.update",
  payload: z.object({ entityType: z.enum(["contact", "company", "deal", "lead"]), entityId: z.uuid(), body: z.string().min(1).max(5000) }),
  execute: async (ctx, p) => {
    const note = await addNote(ctx, p.entityType, p.entityId, p.body);
    return { noteId: note.id };
  },
});

registerProposalExecutor("add_tag", {
  permission: "contacts.update",
  payload: z.object({ contactId: z.uuid(), tagId: z.uuid() }),
  execute: async (ctx, p) => {
    const current = await ctx.run((tx) =>
      tx.select({ tagId: schema.contactTags.tagId }).from(schema.contactTags).where(eq(schema.contactTags.contactId, p.contactId)),
    );
    await setContactTags(ctx, p.contactId, [...new Set([...current.map((c) => c.tagId), p.tagId])]);
    return { tagId: p.tagId };
  },
});

export type ProposalView = {
  id: string;
  actionType: ProposalType;
  payload: Record<string, unknown>;
  rationale: string | null;
  status: string;
  createdAt: Date;
  requestedByName: string | null;
  error: string | null;
};

/** Validates the payload shape up front so humans only see executable proposals. */
export async function createProposal(
  ctx: ServiceCtx,
  input: { actionType: ProposalType; payload: Record<string, unknown>; rationale?: string; interactionId?: string | null },
) {
  assertCan(ctx, "ai.use");
  const exec = executors.get(input.actionType);
  if (!exec) throw new AppError("VALIDATION", "ai.unsupportedAction");
  const payload = exec.payload.parse(input.payload);
  return ctx.run(async (tx) => {
    const [row] = await tx
      .insert(schema.aiActionProposals)
      .values({
        tenantId: ctx.tenantId,
        interactionId: input.interactionId ?? null,
        requestedBy: ctx.userId,
        actionType: input.actionType,
        payload: payload as Record<string, unknown>,
        rationale: input.rationale?.slice(0, 2000) ?? null,
      })
      .returning();
    return row;
  });
}

export async function listProposals(ctx: ServiceCtx, opts: { status?: "pending" | "all"; limit?: number } = {}): Promise<ProposalView[]> {
  assertCan(ctx, "ai.use");
  return ctx.run(async (tx) => {
    const rows = await tx
      .select({ p: schema.aiActionProposals, by: schema.profiles.fullName })
      .from(schema.aiActionProposals)
      .leftJoin(schema.profiles, eq(schema.profiles.id, schema.aiActionProposals.requestedBy))
      .where(
        and(
          eq(schema.aiActionProposals.tenantId, ctx.tenantId),
          opts.status === "all" ? undefined : eq(schema.aiActionProposals.status, "pending"),
        ),
      )
      .orderBy(desc(schema.aiActionProposals.createdAt))
      .limit(opts.limit ?? 50);
    return rows.map((r) => ({
      id: r.p.id,
      actionType: r.p.actionType as ProposalType,
      payload: r.p.payload as Record<string, unknown>,
      rationale: r.p.rationale,
      status: r.p.status,
      createdAt: r.p.createdAt,
      requestedByName: r.by,
      error: r.p.error,
    }));
  });
}

/** Approves and executes a pending proposal as the approving user. */
export async function approveProposal(ctx: ServiceCtx, proposalId: string) {
  assertCanWrite(ctx, "ai.approve");
  // Claim atomically so double-clicks / two approvers cannot execute twice.
  const [claimed] = await ctx.run((tx) =>
    tx
      .update(schema.aiActionProposals)
      .set({ status: "approved", decidedBy: ctx.userId, decidedAt: new Date() })
      .where(
        and(
          eq(schema.aiActionProposals.id, proposalId),
          eq(schema.aiActionProposals.tenantId, ctx.tenantId),
          eq(schema.aiActionProposals.status, "pending"),
          sql`${schema.aiActionProposals.expiresAt} > now()`,
        ),
      )
      .returning(),
  );
  if (!claimed) throw new AppError("CONFLICT", "ai.proposalNotPending");
  const exec = executors.get(claimed.actionType as ProposalType);
  try {
    if (!exec) throw new AppError("VALIDATION", "ai.unsupportedAction");
    assertCanWrite(ctx, exec.permission);
    const result = await exec.execute(ctx, exec.payload.parse(claimed.payload));
    await ctx.run(async (tx) => {
      await tx.update(schema.aiActionProposals).set({ status: "executed", executedAt: new Date(), result }).where(eq(schema.aiActionProposals.id, proposalId));
      await audit(tx, ctx, { action: "ai.proposal_executed", entityType: "ai_proposal", entityId: proposalId, metadata: { actionType: claimed.actionType } });
    });
    return { status: "executed" as const, result };
  } catch (e) {
    const message = isAppError(e) ? e.message : e instanceof Error ? e.message : "failed";
    // Record the failure with system privileges (the approver may lack update rights after a permission error).
    await db().update(schema.aiActionProposals).set({ status: "failed", error: message.slice(0, 500) }).where(eq(schema.aiActionProposals.id, proposalId));
    throw e;
  }
}

export async function rejectProposal(ctx: ServiceCtx, proposalId: string) {
  assertCanWrite(ctx, "ai.approve");
  const rows = await ctx.run((tx) =>
    tx
      .update(schema.aiActionProposals)
      .set({ status: "rejected", decidedBy: ctx.userId, decidedAt: new Date() })
      .where(and(eq(schema.aiActionProposals.id, proposalId), eq(schema.aiActionProposals.tenantId, ctx.tenantId), eq(schema.aiActionProposals.status, "pending")))
      .returning(),
  );
  if (!rows.length) throw new AppError("CONFLICT", "ai.proposalNotPending");
}

registerJobHandler("ai.expire_proposals", async () => {
  await db()
    .update(schema.aiActionProposals)
    .set({ status: "expired" })
    .where(and(eq(schema.aiActionProposals.status, "pending"), lt(schema.aiActionProposals.expiresAt, new Date())));
});
registerSchedule({ name: "ai.expire_proposals", everyMinutes: 60, job: { tenantId: null, type: "ai.expire_proposals" } });

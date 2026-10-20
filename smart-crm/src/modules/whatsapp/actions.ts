"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { tenantAction, type ActionResult } from "@/server/action";
import { schema } from "@/server/db";
import { AppError } from "@/server/errors";
import {
  connectAccount,
  mockAllowed,
  setAccountStatus,
  syncTemplates,
  testAccountConnection,
  updateAccount,
  type AccountView,
} from "./accounts";
import { connectAccountSchema, simulateInboundSchema, simulateStatusSchema, updateAccountSchema } from "./schemas";
import type { ConnectionCheck } from "./provider";
import { buildInboundPayload, buildStatusPayload, postSignedWebhook } from "./simulator";
import { drainWhatsAppJobsInDev } from "./dev";

const PATH = "/settings/whatsapp";

export async function connectAccountAction(input: unknown): Promise<ActionResult<AccountView>> {
  return tenantAction(input, { schema: connectAccountSchema, permission: "integrations.manage" }, async (data, { ctx }) => {
    const account = await connectAccount(ctx, data);
    revalidatePath(PATH);
    return account;
  });
}

export async function updateAccountAction(input: unknown): Promise<ActionResult> {
  return tenantAction(input, { schema: updateAccountSchema, permission: "integrations.manage" }, async (data, { ctx }) => {
    await updateAccount(ctx, data);
    revalidatePath(PATH);
    return null;
  });
}

export async function setAccountStatusAction(input: unknown): Promise<ActionResult> {
  return tenantAction(
    input,
    { schema: z.object({ id: z.uuid(), status: z.enum(["active", "disabled"]) }), permission: "integrations.manage" },
    async ({ id, status }, { ctx }) => {
      await setAccountStatus(ctx, id, status);
      revalidatePath(PATH);
      return null;
    },
  );
}

export async function testConnectionAction(input: unknown): Promise<ActionResult<ConnectionCheck>> {
  return tenantAction(input, { schema: z.object({ id: z.uuid() }), permission: "integrations.manage" }, async ({ id }, { ctx }) => {
    const r = await testAccountConnection(ctx, id);
    revalidatePath(PATH);
    return r;
  });
}

export async function syncTemplatesAction(input: unknown): Promise<ActionResult<{ synced: number }>> {
  return tenantAction(input, { schema: z.object({ accountId: z.uuid() }), permission: "integrations.manage" }, async ({ accountId }, { ctx }) => {
    const r = await syncTemplates(ctx, accountId);
    revalidatePath(PATH);
    return r;
  });
}

/* ---------------------------------------------------- dev simulator (mock) */

function assertSimulatorEnabled() {
  if (!mockAllowed()) throw new AppError("FORBIDDEN", "whatsapp.simulatorDisabled");
}

export async function simulateInboundAction(input: unknown): Promise<ActionResult> {
  return tenantAction(input, { schema: simulateInboundSchema, permission: "integrations.manage" }, async (data, { ctx }) => {
    assertSimulatorEnabled();
    const [account] = await ctx.run((tx) =>
      tx
        .select()
        .from(schema.whatsappAccounts)
        .where(and(eq(schema.whatsappAccounts.id, data.accountId), eq(schema.whatsappAccounts.tenantId, ctx.tenantId))),
    );
    if (!account) throw new AppError("NOT_FOUND", "errors.notFound");
    const status = await postSignedWebhook(buildInboundPayload(account, { fromPhone: data.fromPhone, name: data.name, text: data.text, kind: data.kind }));
    if (status !== 200) throw new AppError("PROVIDER_ERROR", "whatsapp.simulatorFailed", undefined, { status });
    await drainWhatsAppJobsInDev();
    revalidatePath("/inbox");
    return null;
  });
}

export async function simulateStatusAction(input: unknown): Promise<ActionResult> {
  return tenantAction(input, { schema: simulateStatusSchema, permission: "inbox.reply" }, async (data, { ctx }) => {
    assertSimulatorEnabled();
    const [row] = await ctx.run((tx) =>
      tx
        .select({ m: schema.messages, account: schema.whatsappAccounts, phone: schema.contacts.phone })
        .from(schema.messages)
        .innerJoin(schema.conversations, eq(schema.conversations.id, schema.messages.conversationId))
        .innerJoin(schema.whatsappAccounts, eq(schema.whatsappAccounts.id, schema.conversations.whatsappAccountId))
        .innerJoin(schema.contacts, eq(schema.contacts.id, schema.conversations.contactId))
        .where(
          and(
            eq(schema.messages.tenantId, ctx.tenantId),
            eq(schema.messages.conversationId, data.conversationId),
            eq(schema.messages.direction, "outbound"),
            isNotNull(schema.messages.waMessageId),
          ),
        )
        .orderBy(desc(schema.messages.createdAt))
        .limit(1),
    );
    if (!row?.m.waMessageId || !row.phone) throw new AppError("PRECONDITION", "whatsapp.simulatorNoMessage");
    const status = await postSignedWebhook(buildStatusPayload(row.account, { waMessageId: row.m.waMessageId, recipientPhone: row.phone, status: data.status }));
    if (status !== 200) throw new AppError("PROVIDER_ERROR", "whatsapp.simulatorFailed", undefined, { status });
    await drainWhatsAppJobsInDev();
    return null;
  });
}

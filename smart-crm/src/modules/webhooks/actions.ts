"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { tenantAction, type ActionResult } from "@/server/action";
import {
  createWebhook,
  deleteWebhook,
  listDeliveries,
  redeliver,
  rotateWebhookSecret,
  setWebhookActive,
  updateWebhook,
  webhookInputSchema,
  type DeliveryView,
} from "./service";

const id = z.object({ id: z.uuid() });

export async function createWebhookAction(input: unknown): Promise<ActionResult<{ id: string; secret: string }>> {
  return tenantAction(input, { schema: webhookInputSchema, permission: "integrations.manage" }, async (data, { ctx }) => {
    const { webhook, secret } = await createWebhook(ctx, data);
    revalidatePath("/settings/webhooks");
    return { id: webhook.id, secret };
  });
}

export async function updateWebhookAction(input: unknown): Promise<ActionResult> {
  return tenantAction(input, { schema: webhookInputSchema.extend({ id: z.uuid() }), permission: "integrations.manage" }, async ({ id, ...data }, { ctx }) => {
    await updateWebhook(ctx, id, data);
    revalidatePath("/settings/webhooks");
    return null;
  });
}

export async function setWebhookActiveAction(input: unknown): Promise<ActionResult> {
  return tenantAction(input, { schema: id.extend({ active: z.boolean() }), permission: "integrations.manage" }, async ({ id, active }, { ctx }) => {
    await setWebhookActive(ctx, id, active);
    revalidatePath("/settings/webhooks");
    return null;
  });
}

export async function deleteWebhookAction(input: unknown): Promise<ActionResult> {
  return tenantAction(input, { schema: id, permission: "integrations.manage" }, async ({ id }, { ctx }) => {
    await deleteWebhook(ctx, id);
    revalidatePath("/settings/webhooks");
    return null;
  });
}

export async function rotateWebhookSecretAction(input: unknown): Promise<ActionResult<{ secret: string }>> {
  return tenantAction(input, { schema: id, permission: "integrations.manage" }, ({ id }, { ctx }) => rotateWebhookSecret(ctx, id));
}

export async function listDeliveriesAction(input: unknown): Promise<ActionResult<DeliveryView[]>> {
  return tenantAction(input, { schema: id, permission: "integrations.manage", write: false }, ({ id }, { ctx }) => listDeliveries(ctx, id));
}

export async function redeliverAction(input: unknown): Promise<ActionResult> {
  return tenantAction(input, { schema: id, permission: "integrations.manage" }, async ({ id }, { ctx }) => {
    await redeliver(ctx, id);
    return null;
  });
}

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { tenantAction, type ActionResult } from "@/server/action";
import { createApiKey, createApiKeySchema, revokeApiKey } from "./keys";

export async function createApiKeyAction(input: unknown): Promise<ActionResult<{ id: string; key: string }>> {
  return tenantAction(input, { schema: createApiKeySchema, permission: "api_keys.manage" }, async (data, { ctx }) => {
    const created = await createApiKey(ctx, data);
    revalidatePath("/settings/api-keys");
    return created;
  });
}

export async function revokeApiKeyAction(input: unknown): Promise<ActionResult> {
  return tenantAction(input, { schema: z.object({ id: z.uuid() }), permission: "api_keys.manage" }, async ({ id }, { ctx }) => {
    await revokeApiKey(ctx, id);
    revalidatePath("/settings/api-keys");
    return null;
  });
}

"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { tenantAction, type ActionResult } from "@/server/action";
import { TENANT_COOKIE } from "@/server/tenancy";
import { eraseContact, exportDownloadUrl, requestContactExport, requestTenantDeletion, requestTenantExport } from "./service";

export async function requestContactExportAction(input: unknown): Promise<ActionResult> {
  return tenantAction(input, { schema: z.object({ contactId: z.uuid() }), permission: "privacy.manage" }, async ({ contactId }, { ctx }) => {
    await requestContactExport(ctx, contactId);
    revalidatePath("/settings/privacy");
    return null;
  });
}

export async function requestTenantExportAction(): Promise<ActionResult> {
  return tenantAction({}, { schema: z.object({}), permission: "privacy.manage" }, async (_, { ctx }) => {
    await requestTenantExport(ctx);
    revalidatePath("/settings/privacy");
    return null;
  });
}

export async function exportDownloadAction(input: unknown): Promise<ActionResult<{ url: string }>> {
  return tenantAction(input, { schema: z.object({ id: z.uuid() }), permission: "privacy.manage", write: false }, async ({ id }, { ctx }) => {
    const { url } = await exportDownloadUrl(ctx, id);
    return { url };
  });
}

export async function eraseContactAction(input: unknown): Promise<ActionResult<{ filesDeleted: number }>> {
  return tenantAction(
    input,
    { schema: z.object({ contactId: z.uuid(), confirmation: z.string().max(300) }), permission: "privacy.manage" },
    async ({ contactId, confirmation }, { ctx }) => {
      const r = await eraseContact(ctx, contactId, confirmation);
      revalidatePath("/settings/privacy");
      return r;
    },
  );
}

export async function requestTenantDeletionAction(input: unknown): Promise<ActionResult> {
  return tenantAction(input, { schema: z.object({ confirmName: z.string().max(200) }), permission: "privacy.manage" }, async ({ confirmName }, { ctx }) => {
    await requestTenantDeletion(ctx, confirmName);
    (await cookies()).delete(TENANT_COOKIE);
    return null;
  });
}

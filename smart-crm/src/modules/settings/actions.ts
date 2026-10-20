"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { tenantAction, type ActionResult } from "@/server/action";
import { AppError } from "@/server/errors";
import { brandColorSchema, orgProfileSchema, removeLogo, updateBrandColor, updateOrgProfile, uploadLogo } from "./service";

export async function updateOrgProfileAction(input: unknown): Promise<ActionResult> {
  return tenantAction(input, { schema: orgProfileSchema, permission: "org.update" }, async (data, { ctx }) => {
    await updateOrgProfile(ctx, data);
    revalidatePath("/", "layout");
    return null;
  });
}

export async function updateBrandColorAction(input: unknown): Promise<ActionResult> {
  return tenantAction(input, { schema: brandColorSchema, permission: "org.update" }, async ({ brandColor }, { ctx }) => {
    await updateBrandColor(ctx, brandColor);
    revalidatePath("/", "layout");
    return null;
  });
}

/** Logo upload (≤ 512KB) as multipart form data. */
export async function uploadLogoAction(form: FormData): Promise<ActionResult> {
  const file = form.get("logo");
  return tenantAction({}, { schema: z.object({}), permission: "org.update" }, async (_, { ctx }) => {
    if (!(file instanceof File)) throw new AppError("VALIDATION", "orgSettings.logoType");
    await uploadLogo(ctx, { name: file.name, type: file.type, bytes: Buffer.from(await file.arrayBuffer()) });
    revalidatePath("/settings/general");
    return null;
  });
}

export async function removeLogoAction(): Promise<ActionResult> {
  return tenantAction({}, { schema: z.object({}), permission: "org.update" }, async (_, { ctx }) => {
    await removeLogo(ctx);
    revalidatePath("/settings/general");
    return null;
  });
}

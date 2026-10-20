"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { tenantAction, type ActionResult } from "@/server/action";
import { companyInputSchema } from "../schemas";
import { createCompany, deleteCompany, setCompanyTags, updateCompany } from "./service";

export async function createCompanyAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return tenantAction(input, { schema: companyInputSchema, permission: "companies.create" }, async (data, { ctx }) => {
    const c = await createCompany(ctx, data);
    revalidatePath("/companies");
    return { id: c.id };
  });
}

export async function updateCompanyAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return tenantAction(
    input,
    { schema: z.object({ id: z.uuid(), data: companyInputSchema }), permission: "companies.update" },
    async ({ id, data }, { ctx }) => {
      await updateCompany(ctx, id, data);
      revalidatePath(`/companies/${id}`);
      return { id };
    },
  );
}

export async function deleteCompanyAction(input: unknown): Promise<ActionResult> {
  return tenantAction(input, { schema: z.object({ id: z.uuid() }), permission: "companies.delete" }, async ({ id }, { ctx }) => {
    await deleteCompany(ctx, id);
    revalidatePath("/companies");
    return null;
  });
}

export async function setCompanyTagsAction(input: unknown): Promise<ActionResult> {
  return tenantAction(
    input,
    { schema: z.object({ companyId: z.uuid(), tagIds: z.array(z.uuid()).max(50) }), permission: "companies.update" },
    async ({ companyId, tagIds }, { ctx }) => {
      await setCompanyTags(ctx, companyId, tagIds);
      return null;
    },
  );
}

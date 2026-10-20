"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { tenantAction, type ActionResult } from "@/server/action";
import { dealInputSchema, loseDealSchema, moveDealSchema } from "./schemas";
import { createDeal, deleteDeal, loseDeal, moveDeal, reopenDeal, setDealTags, updateDeal, winDeal } from "./deals";

const id = z.object({ id: z.uuid() });

export async function createDealAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return tenantAction(input, { schema: dealInputSchema, permission: "deals.create" }, async (data, { ctx }) => {
    const d = await createDeal(ctx, data);
    revalidatePath("/deals");
    return { id: d.id };
  });
}

export async function updateDealAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return tenantAction(input, { schema: z.object({ id: z.uuid(), data: dealInputSchema }), permission: "deals.update" }, async ({ id, data }, { ctx }) => {
    await updateDeal(ctx, id, data);
    revalidatePath(`/deals/${id}`);
    return { id };
  });
}

export async function moveDealAction(input: unknown): Promise<ActionResult<{ status: string; stageId: string; position: number }>> {
  return tenantAction(input, { schema: moveDealSchema, permission: "deals.update" }, async (data, { ctx }) => {
    const d = await moveDeal(ctx, data);
    return { status: d.status, stageId: d.stageId, position: d.position };
  });
}

export async function winDealAction(input: unknown): Promise<ActionResult> {
  return tenantAction(input, { schema: id, permission: "deals.update" }, async ({ id }, { ctx }) => {
    await winDeal(ctx, id);
    revalidatePath(`/deals/${id}`);
    return null;
  });
}

export async function loseDealAction(input: unknown): Promise<ActionResult> {
  return tenantAction(input, { schema: loseDealSchema, permission: "deals.update" }, async ({ id, lostReasonId, lostNote }, { ctx }) => {
    await loseDeal(ctx, id, { lostReasonId, lostNote });
    revalidatePath(`/deals/${id}`);
    return null;
  });
}

export async function reopenDealAction(input: unknown): Promise<ActionResult> {
  return tenantAction(input, { schema: id, permission: "deals.update" }, async ({ id }, { ctx }) => {
    await reopenDeal(ctx, id);
    revalidatePath(`/deals/${id}`);
    return null;
  });
}

export async function deleteDealAction(input: unknown): Promise<ActionResult> {
  return tenantAction(input, { schema: id, permission: "deals.delete" }, async ({ id }, { ctx }) => {
    await deleteDeal(ctx, id);
    revalidatePath("/deals");
    return null;
  });
}

export async function setDealTagsAction(input: unknown): Promise<ActionResult> {
  return tenantAction(
    input,
    { schema: z.object({ dealId: z.uuid(), tagIds: z.array(z.uuid()).max(50) }), permission: "deals.update" },
    async ({ dealId, tagIds }, { ctx }) => {
      await setDealTags(ctx, dealId, tagIds);
      return null;
    },
  );
}

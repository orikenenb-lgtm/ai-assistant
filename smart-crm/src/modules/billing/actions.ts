"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { tenantAction, type ActionResult } from "@/server/action";
import { cancelSubscription, changePlan, openBillingPortal, resumeSubscription, type ChangePlanResult } from "./service";

const empty = z.object({});

export async function changePlanAction(input: unknown): Promise<ActionResult<ChangePlanResult>> {
  return tenantAction(
    input,
    { schema: z.object({ planId: z.string().regex(/^[a-z0-9_]{2,32}$/), interval: z.enum(["month", "year"]) }), permission: "billing.manage" },
    async (data, { ctx }) => {
      const result = await changePlan(ctx, data);
      revalidatePath("/settings/billing");
      return result;
    },
  );
}

export async function cancelSubscriptionAction(): Promise<ActionResult> {
  return tenantAction({}, { schema: empty, permission: "billing.manage" }, async (_, { ctx }) => {
    await cancelSubscription(ctx);
    revalidatePath("/settings/billing");
    return null;
  });
}

export async function resumeSubscriptionAction(): Promise<ActionResult> {
  return tenantAction({}, { schema: empty, permission: "billing.manage" }, async (_, { ctx }) => {
    await resumeSubscription(ctx);
    revalidatePath("/settings/billing");
    return null;
  });
}

export async function openBillingPortalAction(): Promise<ActionResult<{ url: string }>> {
  return tenantAction({}, { schema: empty, permission: "billing.manage" }, (_, { ctx }) => openBillingPortal(ctx));
}

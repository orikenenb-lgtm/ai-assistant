"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { tenantAction, type ActionResult } from "@/server/action";
import { convertLeadSchema, leadInputSchema, leadStatusSchema } from "./schemas";
import { convertLead, createLead, deleteLead, setLeadStatus, setLeadTags, updateLead } from "./leads";

export async function createLeadAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return tenantAction(input, { schema: leadInputSchema, permission: "leads.create" }, async (data, { ctx }) => {
    const lead = await createLead(ctx, data);
    revalidatePath("/leads");
    return { id: lead.id };
  });
}

export async function updateLeadAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return tenantAction(input, { schema: z.object({ id: z.uuid(), data: leadInputSchema }), permission: "leads.update" }, async ({ id, data }, { ctx }) => {
    await updateLead(ctx, id, data);
    revalidatePath(`/leads/${id}`);
    return { id };
  });
}

export async function setLeadStatusAction(input: unknown): Promise<ActionResult> {
  return tenantAction(input, { schema: leadStatusSchema, permission: "leads.update" }, async ({ id, status, reason }, { ctx }) => {
    await setLeadStatus(ctx, id, status, reason);
    revalidatePath(`/leads/${id}`);
    return null;
  });
}

export async function convertLeadAction(input: unknown): Promise<ActionResult<{ contactId: string; dealId: string | null }>> {
  return tenantAction(input, { schema: convertLeadSchema, permission: "leads.convert" }, async (data, { ctx }) => {
    const r = await convertLead(ctx, data);
    revalidatePath("/leads");
    return { contactId: r.contactId, dealId: r.dealId };
  });
}

export async function deleteLeadAction(input: unknown): Promise<ActionResult> {
  return tenantAction(input, { schema: z.object({ id: z.uuid() }), permission: "leads.delete" }, async ({ id }, { ctx }) => {
    await deleteLead(ctx, id);
    revalidatePath("/leads");
    return null;
  });
}

export async function setLeadTagsAction(input: unknown): Promise<ActionResult> {
  return tenantAction(
    input,
    { schema: z.object({ leadId: z.uuid(), tagIds: z.array(z.uuid()).max(50) }), permission: "leads.update" },
    async ({ leadId, tagIds }, { ctx }) => {
      await setLeadTags(ctx, leadId, tagIds);
      return null;
    },
  );
}

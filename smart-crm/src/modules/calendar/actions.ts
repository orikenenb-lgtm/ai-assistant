"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { tenantAction, type ActionResult } from "@/server/action";
import { eventInputSchema } from "./schemas";
import { createEvent, deleteEvent, updateEvent } from "./service";
import { disconnect } from "./connections";

export async function createEventAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return tenantAction(input, { schema: eventInputSchema, permission: "calendar.manage" }, async (data, { ctx }) => {
    const ev = await createEvent(ctx, data);
    revalidatePath("/calendar");
    return { id: ev.id };
  });
}

export async function updateEventAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return tenantAction(input, { schema: z.object({ id: z.uuid(), data: eventInputSchema }), permission: "calendar.manage" }, async ({ id, data }, { ctx }) => {
    await updateEvent(ctx, id, data);
    revalidatePath("/calendar");
    return { id };
  });
}

export async function deleteEventAction(input: unknown): Promise<ActionResult> {
  return tenantAction(input, { schema: z.object({ id: z.uuid() }), permission: "calendar.manage" }, async ({ id }, { ctx }) => {
    await deleteEvent(ctx, id);
    revalidatePath("/calendar");
    return null;
  });
}

export async function disconnectCalendarAction(input: unknown): Promise<ActionResult> {
  return tenantAction(input, { schema: z.object({ id: z.uuid() }), permission: "calendar.manage" }, async ({ id }, { ctx }) => {
    await disconnect(ctx, id);
    revalidatePath("/calendar");
    return null;
  });
}

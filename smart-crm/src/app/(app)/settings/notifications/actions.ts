"use server";

import { z } from "zod";
import { tenantAction, type ActionResult } from "@/server/action";
import { NOTIFICATION_EVENTS, savePreference } from "./preferences";

export async function savePreferenceAction(input: unknown): Promise<ActionResult> {
  return tenantAction(
    input,
    { schema: z.object({ eventType: z.enum(NOTIFICATION_EVENTS), inApp: z.boolean(), email: z.boolean() }) },
    async (data, { ctx }) => {
      await savePreference(ctx, data);
      return null;
    },
  );
}

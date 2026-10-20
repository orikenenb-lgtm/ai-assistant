"use server";

import { z } from "zod";
import { tenantAction, type ActionResult } from "@/server/action";
import { listNotifications, markNotificationsRead } from "./service";

export async function listNotificationsAction(): Promise<
  ActionResult<{ items: { id: string; title: string; body: string | null; link: string | null; readAt: Date | null; createdAt: Date }[]; unread: number }>
> {
  return tenantAction({}, { schema: z.object({}), write: false }, async (_, { ctx }) => {
    const { items, unread } = await listNotifications(ctx);
    return {
      unread,
      items: items.map((n) => ({ id: n.id, title: n.title, body: n.body, link: n.link, readAt: n.readAt, createdAt: n.createdAt })),
    };
  });
}

export async function markNotificationsReadAction(input: unknown): Promise<ActionResult> {
  return tenantAction(
    input,
    { schema: z.object({ ids: z.union([z.array(z.uuid()).max(100), z.literal("all")]) }), write: false },
    async ({ ids }, { ctx }) => {
      await markNotificationsRead(ctx, ids);
      return null;
    },
  );
}

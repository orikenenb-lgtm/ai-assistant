import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeDb, withUserTx, schema } from "@/server/db";
import { AppError } from "@/server/errors";
import { systemCtx } from "@/server/context";
import { listPreferences, NOTIFICATION_EVENTS, savePreference } from "@/app/(app)/settings/notifications/preferences";
import { createTeam } from "../support/factories";

afterAll(async () => {
  await closeDb();
});

describe("notification preferences", () => {
  it("defaults to in-app only and saves the user's own choices", async () => {
    const T = await createTeam("Prefs Co");
    const defaults = await listPreferences(T.agentCtx);
    expect(defaults).toHaveLength(NOTIFICATION_EVENTS.length);
    expect(defaults.map((d) => d.eventType)).toContain("quote_decision");
    expect(defaults.every((p) => p.inApp && !p.email)).toBe(true);

    await savePreference(T.agentCtx, { eventType: "deal_won", inApp: false, email: true });
    await savePreference(T.agentCtx, { eventType: "deal_won", inApp: true, email: true });
    const after = await listPreferences(T.agentCtx);
    expect(after.find((p) => p.eventType === "deal_won")).toEqual({ eventType: "deal_won", inApp: true, email: true });
    // Another member's preferences are untouched and invisible under RLS.
    expect((await listPreferences(T.managerCtx)).find((p) => p.eventType === "deal_won")).toMatchObject({ inApp: true, email: false });
    const visible = await withUserTx(T.manager.id, (tx) => tx.select().from(schema.notificationPreferences).where(sql`user_id = ${T.agent.id}`));
    expect(visible).toEqual([]);
  });

  it("refuses system contexts", async () => {
    const T = await createTeam("Prefs System Co");
    await expect(savePreference(systemCtx(T.tenant.id), { eventType: "deal_won", inApp: true, email: true })).rejects.toBeInstanceOf(AppError);
  });
});

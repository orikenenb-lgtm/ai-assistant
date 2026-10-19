import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { errorFields, logger } from "@/server/logger";
import { registerJobHandler } from "@/server/jobs/runner";
import { registerSchedule } from "@/server/jobs/scheduler";
import { calendarSyncEnabled, syncConnection } from "./connections";
import { googleProvider } from "./providers";

/**
 * Pulls external calendars every 15 minutes — a no-op until Google OAuth
 * credentials are configured AND the calendar.sync flag is enabled for the tenant.
 */
registerJobHandler("calendar.sync_all", async () => {
  const google = googleProvider();
  if (!google) return;
  const connections = await db().select().from(schema.calendarConnections).where(eq(schema.calendarConnections.status, "connected"));
  const now = Date.now();
  for (const c of connections) {
    if (c.provider !== "google" || !(await calendarSyncEnabled(c.tenantId))) continue;
    try {
      await syncConnection(c.id, google, { from: new Date(now - 7 * 86_400_000), to: new Date(now + 60 * 86_400_000) });
    } catch (e) {
      logger().warn({ connectionId: c.id, ...errorFields(e) }, "calendar sync failed");
    }
  }
});
registerSchedule({ name: "calendar.sync_all", everyMinutes: 15, job: { tenantId: null, type: "calendar.sync_all" } });

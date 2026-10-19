import { registerJobHandler } from "@/server/jobs/runner";
import { registerSchedule } from "@/server/jobs/scheduler";
import { logger } from "@/server/logger";
import { expireDueQuotes } from "./service";

registerJobHandler("documents.expire_quotes", async () => {
  const expired = await expireDueQuotes();
  if (expired) logger().info({ expired }, "quotes expired");
});

// Hourly so quotes expire soon after midnight in each tenant's time zone.
registerSchedule({ name: "documents.expire_quotes", everyMinutes: 60, job: { tenantId: null, type: "documents.expire_quotes" } });

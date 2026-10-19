import { registerJobHandler } from "@/server/jobs/runner";
import { registerSchedule } from "@/server/jobs/scheduler";
import { runBillingLifecycle } from "./lifecycle";
import { syncSeatsJob } from "./seats";
import { processBillingWebhookJob } from "./webhooks";

registerJobHandler("billing.process_webhook", processBillingWebhookJob);
registerJobHandler("billing.sync_seats", syncSeatsJob);
registerJobHandler("billing.lifecycle", async () => {
  await runBillingLifecycle();
});

// Hourly: trial expiry, dunning grace and mock renewals (all idempotent).
registerSchedule({ name: "billing.lifecycle", everyMinutes: 60, job: { tenantId: null, type: "billing.lifecycle" } });

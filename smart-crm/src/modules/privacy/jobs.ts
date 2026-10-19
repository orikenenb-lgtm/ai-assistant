import { PermanentJobError, registerJobHandler } from "@/server/jobs/runner";
import { registerSchedule } from "@/server/jobs/scheduler";
import { applyRetention, processExportRequest, purgeDeletedTenants } from "./service";

registerJobHandler("privacy.export", async (job) => {
  const requestId = job.payload.requestId;
  if (typeof requestId !== "string") throw new PermanentJobError("missing requestId");
  await processExportRequest(requestId);
});

registerJobHandler("privacy.purge_tenants", async () => {
  await purgeDeletedTenants();
});

registerJobHandler("privacy.retention", async () => {
  await applyRetention();
});

registerSchedule({ name: "privacy.purge_tenants", everyMinutes: 1440, job: { tenantId: null, type: "privacy.purge_tenants" } });
registerSchedule({ name: "privacy.retention", everyMinutes: 1440, job: { tenantId: null, type: "privacy.retention" } });

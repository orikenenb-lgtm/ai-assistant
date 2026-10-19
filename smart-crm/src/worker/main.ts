/**
 * Long-running background worker:  npm run worker
 * Claims jobs with SKIP LOCKED (run as many replicas as needed), runs the
 * recurring scheduler every minute and recovers stale locks.
 */
import { hostname } from "node:os";
import "../server/jobs/registry";
import { drainJobs, recoverStaleJobs, registeredJobTypes } from "../server/jobs/runner";
import { runScheduler } from "../server/jobs/scheduler";
import { closeDb } from "../server/db";
import { env } from "../server/env";
import { errorFields, logger } from "../server/logger";

const workerId = `${hostname()}:${process.pid}`;
let stopping = false;

async function main() {
  env(); // fail fast on bad configuration
  logger().info({ workerId, handlers: registeredJobTypes() }, "worker started");
  let lastMaintenance = 0;
  while (!stopping) {
    try {
      if (Date.now() - lastMaintenance > 60_000) {
        lastMaintenance = Date.now();
        await runScheduler();
        const recovered = await recoverStaleJobs();
        if (recovered) logger().warn({ recovered }, "recovered stale jobs");
      }
      const stats = await drainJobs({ workerId, batchSize: 10, deadlineMs: 10_000 });
      if (stats.processed === 0) await new Promise((r) => setTimeout(r, 1000));
    } catch (e) {
      logger().error(errorFields(e), "worker loop error");
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  await closeDb();
  logger().info({ workerId }, "worker stopped");
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    logger().info({ sig }, "shutting down after current batch");
    stopping = true;
  });
}

void main();

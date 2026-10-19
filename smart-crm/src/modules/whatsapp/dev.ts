/**
 * DEVELOPMENT CONVENIENCE (mock provider only): runs pending WhatsApp jobs
 * inline so the inbox works locally without `npm run worker`. Never active in
 * production or with the real Meta provider configured.
 */
import "./jobs";
import { drainJobs } from "@/server/jobs/runner";
import { errorFields, logger } from "@/server/logger";
import { mockAllowed } from "./accounts";

const WHATSAPP_JOBS = ["whatsapp.process_webhook", "whatsapp.send", "whatsapp.download_media", "whatsapp.mark_read"];

export async function drainWhatsAppJobsInDev() {
  if (!mockAllowed()) return;
  try {
    await drainJobs({ workerId: "dev-inline", types: WHATSAPP_JOBS, deadlineMs: 5000 });
  } catch (e) {
    logger().warn(errorFields(e), "inline WhatsApp job processing failed (dev only)");
  }
}

import { NextResponse, type NextRequest } from "next/server";
import "@/server/jobs/registry";
import { drainJobs, recoverStaleJobs } from "@/server/jobs/runner";
import { runScheduler } from "@/server/jobs/scheduler";
import { env } from "@/server/env";
import { safeEqual } from "@/server/crypto";

export const maxDuration = 60;

/**
 * Serverless alternative to `npm run worker` (Vercel Cron). Requires
 * `Authorization: Bearer $CRON_SECRET`.
 */
async function handle(request: NextRequest) {
  const secret = env().CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(header, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const scheduled = await runScheduler();
  const recovered = await recoverStaleJobs();
  const stats = await drainJobs({ workerId: `cron:${crypto.randomUUID().slice(0, 8)}`, deadlineMs: 45_000 });
  return NextResponse.json({ scheduled, recovered, ...stats });
}

export const GET = handle;
export const POST = handle;

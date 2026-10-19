import { NextResponse, type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { safeEqual } from "@/server/crypto";
import { errorFields, logger } from "@/server/logger";

export const dynamic = "force-dynamic";

/**
 * Liveness/readiness probe for uptime monitors and load balancers.
 * Public response: status + database reachability only. With
 * `Authorization: Bearer $CRON_SECRET` it also reports queue health
 * (queued/running jobs, dead jobs in the last 24h, oldest due job age) for alerting.
 */
export async function GET(request: NextRequest) {
  const started = Date.now();
  let dbOk = false;
  try {
    await db().execute(sql`select 1`);
    dbOk = true;
  } catch (e) {
    logger().error(errorFields(e), "health: database unreachable");
  }
  const body: Record<string, unknown> = { status: dbOk ? "ok" : "degraded", database: dbOk ? "ok" : "unreachable", time: new Date().toISOString() };

  const secret = env().CRON_SECRET;
  const auth = request.headers.get("authorization") ?? "";
  if (dbOk && secret && safeEqual(auth, `Bearer ${secret}`)) {
    const [q] = await db().execute<{ queued: number; running: number; dead: number; oldest_due_seconds: number | null }>(sql`
      select
        count(*) filter (where status = 'queued')::int as queued,
        count(*) filter (where status = 'running')::int as running,
        count(*) filter (where status = 'dead' and finished_at > now() - interval '24 hours')::int as dead,
        extract(epoch from now() - min(run_at) filter (where status = 'queued' and run_at <= now()))::int as oldest_due_seconds
      from public.jobs`);
    body.queue = q;
    body.environment = env().APP_ENV;
    body.providers = { auth: env().AUTH_PROVIDER, ai: env().AI_PROVIDER, whatsapp: env().WHATSAPP_PROVIDER, billing: env().BILLING_PROVIDER, email: env().EMAIL_PROVIDER, storage: env().STORAGE_PROVIDER };
  }
  body.latencyMs = Date.now() - started;
  return NextResponse.json(body, { status: dbOk ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}

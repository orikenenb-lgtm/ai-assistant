import { sql } from "drizzle-orm";
import { db } from "./db";
import { AppError } from "./errors";

export type RateLimitResult = { allowed: boolean; remaining: number; resetAt: Date };

/**
 * Fixed-window counter stored in Postgres, so limits hold across serverless
 * instances. One round-trip: upsert + return the new count.
 */
export async function hitRateLimit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
  const nowMs = Date.now();
  const windowStart = new Date(Math.floor(nowMs / (windowSeconds * 1000)) * windowSeconds * 1000);
  const rows = await db().execute<{ count: number }>(sql`
    insert into public.rate_limit_counters (key, window_start, count)
    values (${key}, ${windowStart.toISOString()}::timestamptz, 1)
    on conflict (key, window_start) do update set count = public.rate_limit_counters.count + 1
    returning count`);
  const count = Number(rows[0]?.count ?? 1);
  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
    resetAt: new Date(windowStart.getTime() + windowSeconds * 1000),
  };
}

export async function enforceRateLimit(key: string, limit: number, windowSeconds: number) {
  const r = await hitRateLimit(key, limit, windowSeconds);
  if (!r.allowed) {
    throw new AppError("RATE_LIMITED", "errors.rateLimited", undefined, { retryAfter: r.resetAt.toISOString() });
  }
  return r;
}

/** Deletes expired windows; called by the maintenance job. */
export async function purgeRateLimitCounters(olderThanSeconds = 86400) {
  await db().execute(sql`delete from public.rate_limit_counters where window_start < now() - make_interval(secs => ${olderThanSeconds})`);
}

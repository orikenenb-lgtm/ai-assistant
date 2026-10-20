import { sql } from "drizzle-orm";
import { db } from "../db";
import { errorFields, logger } from "../logger";

export type Job = {
  id: number;
  tenantId: string | null;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
};

export type JobHandler = (job: Job) => Promise<void>;

/** Throw to dead-letter a job immediately (retrying cannot help). */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentJobError";
  }
}

/** Throw to retry at a specific time without counting as a failure log. */
export class RetryJobLater extends Error {
  constructor(
    public readonly runAt: Date,
    message = "retry later",
  ) {
    super(message);
    this.name = "RetryJobLater";
  }
}

const handlers = new Map<string, JobHandler>();

export function registerJobHandler(type: string, handler: JobHandler) {
  handlers.set(type, handler);
}

export function registeredJobTypes(): string[] {
  return [...handlers.keys()].sort();
}

/** Exponential backoff with ±20% jitter: 30s, 60s, 2m, 4m … capped at 1h. */
export function backoffMs(attempt: number): number {
  const base = Math.min(30_000 * 2 ** Math.max(0, attempt - 1), 3_600_000);
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

type JobRow = {
  id: string;
  tenant_id: string | null;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
  priority: number;
  run_at: Date | string;
};

/** Atomically claims up to `limit` due jobs. Safe with any number of workers. */
export async function claimJobs(workerId: string, limit: number, types?: string[]): Promise<Job[]> {
  const typeFilter = types?.length ? sql`and type in (${sql.join(types.map((t) => sql`${t}`), sql`, `)})` : sql``;
  const rows = await db().execute<JobRow>(sql`
    update public.jobs j
       set status = 'running', locked_at = now(), locked_by = ${workerId}, attempts = j.attempts + 1, updated_at = now()
     where j.id in (
       select id from public.jobs
        where status = 'queued' and run_at <= now() ${typeFilter}
        order by priority desc, run_at, id
        limit ${limit}
        for update skip locked)
    returning j.id, j.tenant_id, j.type, j.payload, j.attempts, j.max_attempts, j.priority, j.run_at`);
  // RETURNING does not preserve the subquery's ORDER BY: restore FIFO order so
  // e.g. outbound messages in one batch go out in the order they were queued.
  const ordered = [...rows].sort(
    (a, b) => b.priority - a.priority || new Date(a.run_at).getTime() - new Date(b.run_at).getTime() || Number(a.id) - Number(b.id),
  );
  return ordered.map((r) => ({
    id: Number(r.id),
    tenantId: r.tenant_id,
    type: r.type,
    payload: r.payload ?? {},
    attempts: r.attempts,
    maxAttempts: r.max_attempts,
  }));
}

async function complete(job: Job) {
  await db().execute(sql`
    update public.jobs set status = 'succeeded', finished_at = now(), locked_at = null, locked_by = null, last_error = null, updated_at = now()
    where id = ${job.id}`);
}

async function fail(job: Job, error: unknown) {
  const message = (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).slice(0, 2000);
  if (error instanceof RetryJobLater) {
    // Not a failure: give the attempt back.
    await db().execute(sql`
      update public.jobs set status = 'queued', run_at = ${error.runAt.toISOString()}::timestamptz, attempts = attempts - 1,
             locked_at = null, locked_by = null, updated_at = now()
      where id = ${job.id}`);
    return "rescheduled" as const;
  }
  const permanent = error instanceof PermanentJobError;
  if (permanent || job.attempts >= job.maxAttempts) {
    await db().execute(sql`
      update public.jobs set status = 'dead', last_error = ${message}, finished_at = now(), locked_at = null, locked_by = null, updated_at = now()
      where id = ${job.id}`);
    logger().error({ jobId: job.id, type: job.type, attempts: job.attempts, error: message }, "job dead-lettered");
    return "dead" as const;
  }
  const runAt = new Date(Date.now() + backoffMs(job.attempts));
  await db().execute(sql`
    update public.jobs set status = 'queued', run_at = ${runAt.toISOString()}::timestamptz, last_error = ${message},
           locked_at = null, locked_by = null, updated_at = now()
    where id = ${job.id}`);
  logger().warn({ jobId: job.id, type: job.type, attempts: job.attempts, retryAt: runAt, error: message }, "job failed, will retry");
  return "retry" as const;
}

export async function runJob(job: Job): Promise<"succeeded" | "retry" | "dead" | "rescheduled"> {
  const handler = handlers.get(job.type);
  if (!handler) return fail(job, new PermanentJobError(`no handler registered for job type "${job.type}"`));
  // Defence in depth: a job may only act for the tenant it was enqueued under.
  const payloadTenant = (job.payload as { tenantId?: unknown }).tenantId;
  if (job.tenantId && typeof payloadTenant === "string" && payloadTenant !== job.tenantId) {
    return fail(job, new PermanentJobError("payload tenant does not match job tenant"));
  }
  const started = Date.now();
  try {
    await handler(job);
    await complete(job);
    logger().debug({ jobId: job.id, type: job.type, ms: Date.now() - started }, "job succeeded");
    return "succeeded";
  } catch (e) {
    if (!(e instanceof RetryJobLater)) logger().warn({ jobId: job.id, type: job.type, ...errorFields(e) }, "job handler threw");
    return fail(job, e);
  }
}

/** Requeues jobs whose worker died mid-run (lock older than `staleMinutes`). */
export async function recoverStaleJobs(staleMinutes = 10): Promise<number> {
  const rows = await db().execute(sql`
    update public.jobs set status = 'queued', locked_at = null, locked_by = null, updated_at = now(),
           last_error = coalesce(last_error, '') || ' [recovered stale lock]'
    where status = 'running' and locked_at < now() - make_interval(mins => ${staleMinutes})
    returning id`);
  return rows.length;
}

export type WorkerStats = { processed: number; succeeded: number; retried: number; dead: number };

/** Processes due jobs until none are left or the deadline passes. */
export async function drainJobs(opts: { workerId: string; batchSize?: number; deadlineMs?: number; types?: string[] }): Promise<WorkerStats> {
  const stats: WorkerStats = { processed: 0, succeeded: 0, retried: 0, dead: 0 };
  const deadline = Date.now() + (opts.deadlineMs ?? 25_000);
  while (Date.now() < deadline) {
    const jobs = await claimJobs(opts.workerId, opts.batchSize ?? 10, opts.types);
    if (jobs.length === 0) break;
    for (const job of jobs) {
      const result = await runJob(job);
      stats.processed++;
      if (result === "succeeded") stats.succeeded++;
      else if (result === "dead") stats.dead++;
      else stats.retried++;
    }
  }
  return stats;
}

/** Re-queues a dead job (admin "retry" from the dead-letter queue). */
export async function requeueDeadJob(jobId: number): Promise<boolean> {
  const rows = await db().execute(sql`
    update public.jobs set status = 'queued', run_at = now(), attempts = 0, finished_at = null, updated_at = now()
    where id = ${jobId} and status = 'dead' returning id`);
  return rows.length > 0;
}

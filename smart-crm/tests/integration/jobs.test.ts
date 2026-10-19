import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeDb, db } from "@/server/db";
import { enqueueJob } from "@/server/jobs/queue";
import { PermanentJobError, RetryJobLater, drainJobs, recoverStaleJobs, registerJobHandler, requeueDeadJob, claimJobs, runJob } from "@/server/jobs/runner";
import { registerSchedule, runScheduler } from "@/server/jobs/scheduler";
import { emitEvent, subscribeToEvents, type DomainEvent } from "@/server/events";
import { systemCtx } from "@/server/context";
import { createTeam } from "../support/factories";

const calls: string[] = [];
registerJobHandler("test.ok", async (job) => void calls.push(`ok:${job.payload.n}`));
registerJobHandler("test.flaky", async (job) => {
  if (job.attempts < 2) throw new Error("transient");
  calls.push("flaky:done");
});
registerJobHandler("test.always_fails", async () => {
  throw new Error("boom");
});
registerJobHandler("test.permanent", async () => {
  throw new PermanentJobError("bad input");
});
registerJobHandler("test.later", async () => {
  throw new RetryJobLater(new Date(Date.now() + 3600_000));
});

const TYPES = ["test.ok", "test.flaky", "test.always_fails", "test.permanent", "test.later", "events.dispatch"];

async function job(id: number) {
  const [row] = await db().execute<{ status: string; attempts: number; last_error: string | null; run_at: Date }>(
    sql`select status, attempts, last_error, run_at from public.jobs where id = ${id}`,
  );
  return row;
}

async function makeDue(id: number) {
  await db().execute(sql`update public.jobs set run_at = now() where id = ${id}`);
}

beforeEach(async () => {
  calls.length = 0;
  await db().execute(sql`delete from public.jobs where type like 'test.%' or type = 'events.dispatch'`);
});

afterAll(async () => {
  await closeDb();
});

describe("durable job queue", () => {
  it("runs queued jobs once", async () => {
    const id = (await enqueueJob(db(), { tenantId: null, type: "test.ok", payload: { n: 1 } }))!;
    const stats = await drainJobs({ workerId: "t1", types: TYPES });
    expect(stats).toMatchObject({ processed: 1, succeeded: 1 });
    expect(calls).toEqual(["ok:1"]);
    expect((await job(id)).status).toBe("succeeded");
    expect((await drainJobs({ workerId: "t1", types: TYPES })).processed).toBe(0);
  });

  it("deduplicates by idempotency key", async () => {
    const a = await enqueueJob(db(), { tenantId: null, type: "test.ok", payload: { n: 2 }, idempotencyKey: "test:dupe" });
    const b = await enqueueJob(db(), { tenantId: null, type: "test.ok", payload: { n: 3 }, idempotencyKey: "test:dupe" });
    expect(a).not.toBeNull();
    expect(b).toBeNull();
    await drainJobs({ workerId: "t1", types: TYPES });
    expect(calls).toEqual(["ok:2"]);
    await db().execute(sql`delete from public.jobs where idempotency_key = 'test:dupe'`);
  });

  it("retries transient failures with backoff, then succeeds", async () => {
    const id = (await enqueueJob(db(), { tenantId: null, type: "test.flaky" }))!;
    await drainJobs({ workerId: "t1", types: TYPES });
    const afterFirst = await job(id);
    expect(afterFirst.status).toBe("queued");
    expect(afterFirst.attempts).toBe(1);
    expect(afterFirst.last_error).toContain("transient");
    expect(new Date(afterFirst.run_at).getTime()).toBeGreaterThan(Date.now() + 10_000);
    await makeDue(id);
    await drainJobs({ workerId: "t1", types: TYPES });
    expect((await job(id)).status).toBe("succeeded");
    expect(calls).toEqual(["flaky:done"]);
  });

  it("dead-letters after max attempts and can be re-queued", async () => {
    const id = (await enqueueJob(db(), { tenantId: null, type: "test.always_fails", maxAttempts: 2 }))!;
    await drainJobs({ workerId: "t1", types: TYPES });
    await makeDue(id);
    await drainJobs({ workerId: "t1", types: TYPES });
    expect(await job(id)).toMatchObject({ status: "dead", attempts: 2 });
    expect(await requeueDeadJob(id)).toBe(true);
    expect(await job(id)).toMatchObject({ status: "queued", attempts: 0 });
  });

  it("dead-letters permanent errors and unknown job types immediately", async () => {
    const p = (await enqueueJob(db(), { tenantId: null, type: "test.permanent" }))!;
    const u = (await enqueueJob(db(), { tenantId: null, type: "test.unknown_type" }))!;
    await drainJobs({ workerId: "t1", types: [...TYPES, "test.unknown_type"] });
    expect(await job(p)).toMatchObject({ status: "dead", attempts: 1 });
    expect((await job(u)).status).toBe("dead");
    expect((await job(u)).last_error).toContain("no handler");
  });

  it("RetryJobLater reschedules without consuming an attempt", async () => {
    const id = (await enqueueJob(db(), { tenantId: null, type: "test.later" }))!;
    await drainJobs({ workerId: "t1", types: TYPES });
    const row = await job(id);
    expect(row).toMatchObject({ status: "queued", attempts: 0 });
    expect(new Date(row.run_at).getTime()).toBeGreaterThan(Date.now() + 3000_000);
  });

  it("two workers never claim the same job (SKIP LOCKED)", async () => {
    for (let n = 0; n < 20; n++) await enqueueJob(db(), { tenantId: null, type: "test.ok", payload: { n } });
    const [a, b] = await Promise.all([claimJobs("w-a", 15, TYPES), claimJobs("w-b", 15, TYPES)]);
    const ids = [...a, ...b].map((j) => j.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(20);
    for (const j of [...a, ...b]) await runJob(j);
    expect(calls).toHaveLength(20);
  });

  it("recovers jobs whose worker died", async () => {
    const id = (await enqueueJob(db(), { tenantId: null, type: "test.ok", payload: { n: 9 } }))!;
    await claimJobs("dead-worker", 1, ["test.ok"]);
    await db().execute(sql`update public.jobs set locked_at = now() - interval '30 minutes' where id = ${id}`);
    expect(await recoverStaleJobs(10)).toBeGreaterThanOrEqual(1);
    await drainJobs({ workerId: "t1", types: TYPES });
    expect((await job(id)).status).toBe("succeeded");
  });

  it("enqueues a recurring schedule once per time bucket", async () => {
    registerSchedule({ name: "test.sched", everyMinutes: 5, job: { tenantId: null, type: "test.ok", payload: { n: "s" } } });
    const now = new Date();
    await runScheduler(now);
    await runScheduler(now);
    const [{ n }] = await db().execute<{ n: number }>(sql`select count(*)::int as n from public.jobs where idempotency_key like 'sched:test.sched:%'`);
    expect(n).toBe(1);
    await db().execute(sql`delete from public.jobs where idempotency_key like 'sched:%'`);
  });
});

describe("domain events", () => {
  it("dispatches events to subscribers through the queue and drops runaway chains", async () => {
    const team = await createTeam();
    const seen: DomainEvent[] = [];
    subscribeToEvents({ name: "test-sub", handle: async (e) => void seen.push(e) });
    const ctx = systemCtx(team.tenant.id);
    await ctx.run((tx) => emitEvent(tx, ctx, { type: "contact.created", entityType: "contact", entityId: team.tenant.id, data: { x: 1 } }));
    const deep = systemCtx(team.tenant.id, { eventDepth: 99 });
    await deep.run((tx) => emitEvent(tx, deep, { type: "contact.created", entityType: "contact", entityId: team.tenant.id }));
    await drainJobs({ workerId: "t1", types: TYPES });
    const mine = seen.filter((e) => e.tenantId === team.tenant.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ type: "contact.created", depth: 0, data: { x: 1 } });
  });
});

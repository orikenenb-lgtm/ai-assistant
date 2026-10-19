import { db } from "../db";
import { enqueueJob, type EnqueueInput } from "./queue";

export type Schedule = {
  name: string;
  everyMinutes: number;
  job: Omit<EnqueueInput, "idempotencyKey" | "runAt">;
};

const schedules: Schedule[] = [];

export function registerSchedule(s: Schedule) {
  if (!schedules.some((x) => x.name === s.name)) schedules.push(s);
}

export function registeredSchedules(): readonly Schedule[] {
  return schedules;
}

/**
 * Enqueues each recurring job at most once per time bucket. Safe to call from
 * many workers or cron invocations: the bucket idempotency key dedupes.
 */
export async function runScheduler(now = new Date()): Promise<number> {
  let enqueued = 0;
  const minute = Math.floor(now.getTime() / 60_000);
  for (const s of schedules) {
    const bucket = Math.floor(minute / s.everyMinutes);
    const id = await enqueueJob(db(), { ...s.job, idempotencyKey: `sched:${s.name}:${bucket}` });
    if (id !== null) enqueued++;
  }
  return enqueued;
}

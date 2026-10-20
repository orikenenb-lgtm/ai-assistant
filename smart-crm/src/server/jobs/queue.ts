import { sql } from "drizzle-orm";
import { schema, type Executor } from "../db";

export type EnqueueInput = {
  tenantId: string | null;
  type: string;
  payload?: Record<string, unknown>;
  runAt?: Date;
  priority?: number;
  maxAttempts?: number;
  /** Duplicate enqueues with the same key are ignored (exactly-once intent). */
  idempotencyKey?: string;
};

/**
 * Enqueues a job in the caller's transaction (transactional outbox): the job
 * exists if and only if the business change committed.
 */
export async function enqueueJob(tx: Executor, input: EnqueueInput): Promise<number | null> {
  const rows = await tx
    .insert(schema.jobs)
    .values({
      tenantId: input.tenantId,
      type: input.type,
      payload: input.payload ?? {},
      runAt: input.runAt ?? new Date(),
      priority: input.priority ?? 0,
      maxAttempts: input.maxAttempts ?? 5,
      idempotencyKey: input.idempotencyKey ?? null,
    })
    .onConflictDoNothing({ target: schema.jobs.idempotencyKey, where: sql`idempotency_key is not null` })
    .returning({ id: schema.jobs.id });
  return rows[0]?.id ?? null;
}

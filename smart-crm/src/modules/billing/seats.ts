import { eq } from "drizzle-orm";
import { schema, withSystemTx, type Executor } from "@/server/db";
import { enqueueJob } from "@/server/jobs/queue";
import { PermanentJobError, type Job } from "@/server/jobs/runner";
import { billingProvider } from "./providers";
import { activeMemberCount } from "./service";

const BUCKET_MS = 30_000;

/**
 * Schedules a seat recount after membership changes. Changes within the same
 * 30-second window coalesce into one job (idempotency key) that runs after the
 * window closes, so it always sees the final member count.
 */
export async function queueSeatSync(tx: Executor, tenantId: string, now = Date.now()) {
  const bucket = Math.floor(now / BUCKET_MS);
  await enqueueJob(tx, {
    tenantId,
    type: "billing.sync_seats",
    payload: { tenantId },
    runAt: new Date((bucket + 1) * BUCKET_MS + 1000),
    idempotencyKey: `billing.seats:${tenantId}:${bucket}`,
  });
}

/** Sets subscription.seats to the active member count and pushes it to the provider. Idempotent. */
export async function syncSeatsNow(tenantId: string): Promise<{ seats: number; changed: boolean }> {
  const provider = billingProvider();
  return withSystemTx(async (tx) => {
    const [sub] = await tx.select().from(schema.subscriptions).where(eq(schema.subscriptions.tenantId, tenantId)).for("update");
    if (!sub) return { seats: 0, changed: false };
    const seats = Math.max(1, await activeMemberCount(tx, tenantId));
    if (seats === sub.seats) return { seats, changed: false };
    await tx.update(schema.subscriptions).set({ seats }).where(eq(schema.subscriptions.id, sub.id));
    if (provider.kind === "stripe" && sub.provider === "stripe" && sub.providerSubscriptionId && sub.status !== "canceled") {
      await provider.syncSeats({ subscriptionId: sub.providerSubscriptionId, seats });
    }
    await tx.insert(schema.auditLogs).values({
      tenantId,
      actorUserId: null,
      actorType: "system",
      action: "billing.seats_synced",
      entityType: "subscription",
      entityId: sub.id,
      metadata: { from: sub.seats, to: seats },
    });
    return { seats, changed: true };
  });
}

export async function syncSeatsJob(job: Job) {
  const tenantId = job.payload.tenantId ?? job.tenantId;
  if (typeof tenantId !== "string") throw new PermanentJobError("missing tenantId");
  await syncSeatsNow(tenantId);
}

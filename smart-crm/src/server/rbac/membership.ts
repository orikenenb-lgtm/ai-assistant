import { and, eq } from "drizzle-orm";
import { db, schema, type Executor } from "../db";

/** True when `userId` is an active member of `tenantId` (guards notifications, emails and automation targets). */
export async function isActiveMember(tenantId: string, userId: string, executor: Executor = db()): Promise<boolean> {
  const [m] = await executor
    .select({ status: schema.memberships.status })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.tenantId, tenantId), eq(schema.memberships.userId, userId)));
  return m?.status === "active";
}

/** Suspended or deleted organizations must not start background work (automations, outbound webhooks). */
export async function isTenantLive(tenantId: string, executor: Executor = db()): Promise<boolean> {
  const [t] = await executor.select({ status: schema.tenants.status, deletedAt: schema.tenants.deletedAt }).from(schema.tenants).where(eq(schema.tenants.id, tenantId));
  return Boolean(t && t.status === "active" && !t.deletedAt);
}

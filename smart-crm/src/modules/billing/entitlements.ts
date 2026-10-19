import { and, eq, gte, sql } from "drizzle-orm";
import { schema, type Executor } from "@/server/db";
import { AppError } from "@/server/errors";

export const FEATURES = [
  "crm",
  "tasks",
  "documents",
  "whatsapp",
  "ai",
  "automation",
  "analytics",
  "api",
  "custom_fields",
  "webhooks",
  "audit_export",
  "priority_support",
] as const;
export type Feature = (typeof FEATURES)[number];

export type LimitKey = "max_contacts" | "ai_tokens_monthly" | "whatsapp_messages_monthly" | "max_workflows" | "storage_mb";

export type Entitlements = {
  planId: string;
  status: string;
  trialEndsAt: Date | null;
  features: Set<Feature>;
  limits: Partial<Record<LimitKey, number>>;
  seatLimit: number | null;
};

/** Plan features ∪ admin overrides, minus removals. Enforced on the server only. */
export async function getEntitlements(tx: Executor, tenantId: string): Promise<Entitlements> {
  const [row] = await tx
    .select({ sub: schema.subscriptions, plan: schema.plans, ov: schema.tenantPlanOverrides })
    .from(schema.subscriptions)
    .innerJoin(schema.plans, eq(schema.plans.id, schema.subscriptions.planId))
    .leftJoin(schema.tenantPlanOverrides, eq(schema.tenantPlanOverrides.tenantId, schema.subscriptions.tenantId))
    .where(eq(schema.subscriptions.tenantId, tenantId))
    .limit(1);
  if (!row) {
    return { planId: "none", status: "none", trialEndsAt: null, features: new Set(), limits: {}, seatLimit: 1 };
  }
  const features = new Set<Feature>(row.plan.features as Feature[]);
  for (const f of (row.ov?.featuresAdd ?? []) as Feature[]) features.add(f);
  for (const f of (row.ov?.featuresRemove ?? []) as Feature[]) features.delete(f);
  // Lapsed subscriptions keep read access but lose paid features.
  if (row.sub.status === "canceled" || row.sub.status === "incomplete") {
    for (const f of [...features]) if (!["crm", "tasks", "documents"].includes(f)) features.delete(f);
  }
  const limits = { ...(row.plan.limits as Record<string, number>), ...((row.ov?.limits ?? {}) as Record<string, number>) };
  const seatOverride = (row.ov?.limits as Record<string, number> | undefined)?.seats;
  return {
    planId: row.plan.id,
    status: row.sub.status,
    trialEndsAt: row.sub.trialEndsAt,
    features,
    limits,
    seatLimit: seatOverride ?? row.plan.seatLimit ?? null,
  };
}

export function assertFeature(ent: Entitlements, feature: Feature) {
  if (!ent.features.has(feature)) throw new AppError("PLAN_REQUIRED", "errors.planRequired", undefined, { feature });
}

export function startOfMonth(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/** Sum of a usage metric in the current calendar month (UTC). */
export async function monthlyUsage(tx: Executor, tenantId: string, metric: string): Promise<number> {
  const [r] = await tx
    .select({ total: sql<string>`coalesce(sum(${schema.usageEvents.quantity}), 0)` })
    .from(schema.usageEvents)
    .where(and(eq(schema.usageEvents.tenantId, tenantId), eq(schema.usageEvents.metric, metric), gte(schema.usageEvents.occurredAt, startOfMonth())));
  return Number(r?.total ?? 0);
}

/** Active members + pending invitations count against the seat limit. */
export async function seatsInUse(tx: Executor, tenantId: string): Promise<number> {
  const [r] = await tx.execute<{ n: number }>(sql`
    select (select count(*) from public.memberships where tenant_id = ${tenantId} and status = 'active')
         + (select count(*) from public.invitations where tenant_id = ${tenantId}
              and accepted_at is null and revoked_at is null and expires_at > now()) as n`);
  return Number(r?.n ?? 0);
}

export async function assertSeatAvailable(tx: Executor, tenantId: string, extra = 1) {
  const ent = await getEntitlements(tx, tenantId);
  if (ent.seatLimit === null) return;
  if ((await seatsInUse(tx, tenantId)) + extra > ent.seatLimit) {
    throw new AppError("QUOTA_EXCEEDED", "errors.seatLimit", undefined, { limit: ent.seatLimit });
  }
}

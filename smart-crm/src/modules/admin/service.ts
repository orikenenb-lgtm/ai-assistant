import { and, asc, count, desc, eq, gt, ilike, isNotNull, isNull, like, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, schema, withSystemTx, type Tx } from "@/server/db";
import { auditPlatform } from "@/server/audit";
import { AppError } from "@/server/errors";
import { requeueDeadJob } from "@/server/jobs/runner";
import { likePattern } from "@/modules/search/service";
import { FEATURES, monthlyUsage, type LimitKey } from "@/modules/billing/entitlements";
import { listPlans, monthlyRecurringCents, toPlanView, getPlan, BILLING_INTERVALS, type BillingInterval, type PlanView } from "@/modules/billing/plans";
import { applyPlanLocally, assertPlanFits } from "@/modules/billing/service";
import { assertSuperAdmin, type AdminActor } from "./guard";

const LIMIT_KEYS: LimitKey[] = ["max_contacts", "ai_tokens_monthly", "whatsapp_messages_monthly", "max_workflows", "storage_mb"];
export const OVERRIDE_LIMIT_KEYS = [...LIMIT_KEYS, "seats"] as const;

async function adminAudit(tx: Tx, actor: AdminActor, entry: { action: string; tenantId?: string | null; entityType?: string; entityId?: string | null; metadata?: Record<string, unknown> }) {
  await auditPlatform(tx, { ...entry, actorUserId: actor.userId, ip: actor.ip, userAgent: actor.userAgent });
}

/* ------------------------------------------------------------ overview */

export type PlatformStats = {
  tenants: { total: number; byStatus: Record<string, number>; byPlan: { planId: string; name: string; count: number }[]; deleted: number };
  mrr: { currency: string; cents: number }[];
  users: { total: number; activeMembers: number; active30d: number };
  jobs: { byStatus: Record<string, number>; byType: { type: string; queued: number; running: number; dead: number }[] };
  webhookFailures: { last24h: number; last7d: number };
  emailFailures7d: number;
  activeSupportSessions: number;
  dbLatencyMs: number;
};

export async function getPlatformStats(actor: AdminActor): Promise<PlatformStats> {
  await assertSuperAdmin(actor.userId);
  const started = performance.now();
  await db().execute(sql`select 1`);
  const dbLatencyMs = Math.round((performance.now() - started) * 10) / 10;

  const tenantRows = await db()
    .select({ status: schema.tenants.status, deletedAt: schema.tenants.deletedAt, planId: schema.subscriptions.planId, subStatus: schema.subscriptions.status, interval: schema.subscriptions.billingInterval, seats: schema.subscriptions.seats })
    .from(schema.tenants)
    .leftJoin(schema.subscriptions, eq(schema.subscriptions.tenantId, schema.tenants.id));
  const plans = await listPlans(db(), { includeInactive: true });
  const planById = new Map(plans.map((p) => [p.id, p]));
  const byStatus: Record<string, number> = {};
  const byPlanCount = new Map<string, number>();
  const mrr = new Map<string, number>();
  let deleted = 0;
  for (const r of tenantRows) {
    if (r.deletedAt) {
      deleted++;
      continue;
    }
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    if (r.planId) byPlanCount.set(r.planId, (byPlanCount.get(r.planId) ?? 0) + 1);
    const plan = r.planId ? planById.get(r.planId) : undefined;
    if (plan && (r.subStatus === "active" || r.subStatus === "past_due")) {
      mrr.set(plan.currency, (mrr.get(plan.currency) ?? 0) + monthlyRecurringCents(plan, (r.interval ?? "month") as BillingInterval, r.seats ?? 1));
    }
  }
  const [users] = await db().execute<{ total: number; active_members: number; active_30d: number }>(sql`
    select (select count(*)::int from public.profiles) as total,
           (select count(distinct user_id)::int from public.memberships where status = 'active') as active_members,
           (select count(distinct actor_user_id)::int from public.audit_logs where actor_user_id is not null and created_at > now() - interval '30 days') as active_30d`);
  const jobStatus = await db().execute<{ status: string; n: number }>(sql`select status, count(*)::int as n from public.jobs group by status`);
  const jobTypes = await db().execute<{ type: string; queued: number; running: number; dead: number }>(sql`
    select type,
      count(*) filter (where status = 'queued')::int as queued,
      count(*) filter (where status = 'running')::int as running,
      count(*) filter (where status = 'dead')::int as dead
    from public.jobs where status in ('queued', 'running', 'dead')
    group by type order by count(*) desc limit 20`);
  const [wh] = await db().execute<{ d1: number; d7: number }>(sql`
    select count(*) filter (where received_at > now() - interval '1 day')::int as d1,
           count(*)::int as d7
    from public.webhook_events
    where (status = 'failed' or signature_valid = false) and received_at > now() - interval '7 days'`);
  const [em] = await db().execute<{ n: number }>(sql`select count(*)::int as n from public.email_outbox where status = 'failed' and created_at > now() - interval '7 days'`);
  const [ss] = await db().execute<{ n: number }>(sql`select count(*)::int as n from public.support_sessions where ended_at is null and expires_at > now()`);
  return {
    tenants: {
      total: tenantRows.length - deleted,
      byStatus,
      byPlan: [...byPlanCount.entries()].map(([planId, c]) => ({ planId, name: planById.get(planId)?.name.en ?? planId, count: c })).sort((a, b) => b.count - a.count),
      deleted,
    },
    mrr: [...mrr.entries()].map(([currency, cents]) => ({ currency, cents })),
    users: { total: Number(users?.total ?? 0), activeMembers: Number(users?.active_members ?? 0), active30d: Number(users?.active_30d ?? 0) },
    jobs: { byStatus: Object.fromEntries(jobStatus.map((r) => [r.status, Number(r.n)])), byType: jobTypes.map((r) => ({ ...r, queued: Number(r.queued), running: Number(r.running), dead: Number(r.dead) })) },
    webhookFailures: { last24h: Number(wh?.d1 ?? 0), last7d: Number(wh?.d7 ?? 0) },
    emailFailures7d: Number(em?.n ?? 0),
    activeSupportSessions: Number(ss?.n ?? 0),
    dbLatencyMs,
  };
}

/* ------------------------------------------------------------- tenants */

export const tenantListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  plan: z.string().regex(/^[a-z0-9_]{2,32}$/).optional(),
  status: z.enum(["active", "suspended", "deleted"]).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(25),
});
export type TenantListQuery = z.infer<typeof tenantListQuerySchema>;

export type TenantListItem = {
  id: string;
  name: string;
  slug: string;
  status: string;
  deletedAt: Date | null;
  planId: string | null;
  subscriptionStatus: string | null;
  members: number;
  createdAt: Date;
};

export async function listTenants(actor: AdminActor, q: TenantListQuery): Promise<{ rows: TenantListItem[]; total: number }> {
  await assertSuperAdmin(actor.userId);
  const conds: (SQL | undefined)[] = [];
  if (q.q) {
    const pattern = likePattern(q.q);
    conds.push(or(ilike(schema.tenants.name, pattern), ilike(schema.tenants.slug, pattern), /^[0-9a-f-]{36}$/i.test(q.q) ? eq(schema.tenants.id, q.q) : undefined));
  }
  if (q.plan) conds.push(eq(schema.subscriptions.planId, q.plan));
  if (q.status === "deleted") conds.push(isNotNull(schema.tenants.deletedAt));
  else {
    conds.push(isNull(schema.tenants.deletedAt));
    if (q.status) conds.push(eq(schema.tenants.status, q.status));
  }
  const where = and(...conds);
  const [{ total }] = await db()
    .select({ total: count() })
    .from(schema.tenants)
    .leftJoin(schema.subscriptions, eq(schema.subscriptions.tenantId, schema.tenants.id))
    .where(where);
  const rows = await db()
    .select({
      t: schema.tenants,
      planId: schema.subscriptions.planId,
      subStatus: schema.subscriptions.status,
      members: sql<number>`(select count(*)::int from public.memberships m where m.tenant_id = ${schema.tenants.id} and m.status = 'active')`,
    })
    .from(schema.tenants)
    .leftJoin(schema.subscriptions, eq(schema.subscriptions.tenantId, schema.tenants.id))
    .where(where)
    .orderBy(desc(schema.tenants.createdAt))
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);
  return {
    total,
    rows: rows.map((r) => ({
      id: r.t.id,
      name: r.t.name,
      slug: r.t.slug,
      status: r.t.status,
      deletedAt: r.t.deletedAt,
      planId: r.planId,
      subscriptionStatus: r.subStatus,
      members: Number(r.members),
      createdAt: r.t.createdAt,
    })),
  };
}

export async function getTenantDetail(actor: AdminActor, tenantId: string) {
  await assertSuperAdmin(actor.userId);
  const [tenant] = await db().select().from(schema.tenants).where(eq(schema.tenants.id, tenantId));
  if (!tenant) throw new AppError("NOT_FOUND", "errors.notFound");
  const [sub] = await db().select().from(schema.subscriptions).where(eq(schema.subscriptions.tenantId, tenantId));
  const plan = sub ? await getPlan(db(), sub.planId) : undefined;
  const [override] = await db().select().from(schema.tenantPlanOverrides).where(eq(schema.tenantPlanOverrides.tenantId, tenantId));
  const members = await db()
    .select({ userId: schema.profiles.id, fullName: schema.profiles.fullName, email: schema.profiles.email, role: schema.memberships.role, status: schema.memberships.status, joinedAt: schema.memberships.createdAt })
    .from(schema.memberships)
    .innerJoin(schema.profiles, eq(schema.profiles.id, schema.memberships.userId))
    .where(eq(schema.memberships.tenantId, tenantId))
    .orderBy(asc(schema.memberships.role), asc(schema.profiles.fullName));
  const [counts] = await db().execute<{ contacts: number; workflows: number; storage: string; conversations: number }>(sql`
    select (select count(*)::int from public.contacts where tenant_id = ${tenantId} and deleted_at is null) as contacts,
           (select count(*)::int from public.automation_workflows where tenant_id = ${tenantId} and status <> 'archived') as workflows,
           (select coalesce(sum(size_bytes), 0)::text from public.attachments where tenant_id = ${tenantId} and deleted_at is null) as storage,
           (select count(*)::int from public.conversations where tenant_id = ${tenantId}) as conversations`);
  const flags = await db().select().from(schema.tenantFeatureFlags).where(eq(schema.tenantFeatureFlags.tenantId, tenantId));
  const sessions = await db()
    .select({ s: schema.supportSessions, adminName: schema.profiles.fullName })
    .from(schema.supportSessions)
    .leftJoin(schema.profiles, eq(schema.profiles.id, schema.supportSessions.adminUserId))
    .where(eq(schema.supportSessions.tenantId, tenantId))
    .orderBy(desc(schema.supportSessions.startedAt))
    .limit(10);
  return {
    tenant,
    subscription: sub ?? null,
    plan: plan ? toPlanView(plan) : null,
    override: override ?? null,
    members,
    usage: {
      contacts: Number(counts?.contacts ?? 0),
      workflows: Number(counts?.workflows ?? 0),
      storageMb: Math.ceil(Number(counts?.storage ?? 0) / (1024 * 1024)),
      conversations: Number(counts?.conversations ?? 0),
      aiTokens: await monthlyUsage(db(), tenantId, "ai_tokens"),
      whatsappMessages: await monthlyUsage(db(), tenantId, "whatsapp_messages"),
    },
    flags,
    sessions: sessions.map((r) => ({ ...r.s, adminName: r.adminName })),
  };
}

export const overrideSchema = z.object({
  limits: z.partialRecord(z.enum(OVERRIDE_LIMIT_KEYS), z.number().int().min(0).max(1_000_000_000).nullable()).default({}),
  featuresAdd: z.array(z.enum(FEATURES)).max(FEATURES.length).default([]),
  featuresRemove: z.array(z.enum(FEATURES)).max(FEATURES.length).default([]),
  note: z.string().trim().max(500).optional(),
});

export async function setTenantOverride(actor: AdminActor, tenantId: string, input: z.infer<typeof overrideSchema>) {
  await assertSuperAdmin(actor.userId);
  const data = overrideSchema.parse(input);
  const both = data.featuresAdd.filter((f) => data.featuresRemove.includes(f));
  if (both.length) throw new AppError("VALIDATION", "admin.featureConflict");
  const limits = Object.fromEntries(Object.entries(data.limits).filter(([, v]) => v !== null && v !== undefined)) as Record<string, number>;
  await withSystemTx(async (tx) => {
    await assertTenant(tx, tenantId);
    const [before] = await tx.select().from(schema.tenantPlanOverrides).where(eq(schema.tenantPlanOverrides.tenantId, tenantId));
    await tx
      .insert(schema.tenantPlanOverrides)
      .values({ tenantId, limits, featuresAdd: data.featuresAdd, featuresRemove: data.featuresRemove, note: data.note ?? null, updatedBy: actor.userId })
      .onConflictDoUpdate({
        target: schema.tenantPlanOverrides.tenantId,
        set: { limits, featuresAdd: data.featuresAdd, featuresRemove: data.featuresRemove, note: data.note ?? null, updatedBy: actor.userId, updatedAt: new Date() },
      });
    await adminAudit(tx, actor, {
      action: "billing.admin_override_updated",
      tenantId,
      entityType: "tenant",
      entityId: tenantId,
      metadata: { before: before ? { limits: before.limits, featuresAdd: before.featuresAdd, featuresRemove: before.featuresRemove } : null, after: { limits, featuresAdd: data.featuresAdd, featuresRemove: data.featuresRemove }, note: data.note ?? null },
    });
  });
}

async function assertTenant(tx: Tx, tenantId: string) {
  const [t] = await tx.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).for("update");
  if (!t) throw new AppError("NOT_FOUND", "errors.notFound");
  return t;
}

/** Admin plan change (no provider round-trip). Stripe-managed subscriptions must be changed in Stripe. */
export async function adminChangePlan(actor: AdminActor, tenantId: string, planId: string, interval: BillingInterval, opts: { force?: boolean } = {}) {
  await assertSuperAdmin(actor.userId);
  if (!BILLING_INTERVALS.includes(interval)) throw new AppError("VALIDATION", "errors.validation");
  await withSystemTx(async (tx) => {
    await assertTenant(tx, tenantId);
    const plan = await getPlan(tx, planId);
    if (!plan) throw new AppError("NOT_FOUND", "billing.planUnavailable");
    const [sub] = await tx.select().from(schema.subscriptions).where(eq(schema.subscriptions.tenantId, tenantId)).for("update");
    if (!sub) throw new AppError("NOT_FOUND", "billing.noSubscription");
    if (sub.provider === "stripe" && sub.providerSubscriptionId && sub.status !== "canceled") throw new AppError("PRECONDITION", "admin.stripeManaged");
    if (!opts.force) await assertPlanFits(tx, tenantId, plan);
    await applyPlanLocally(tx, sub, plan, interval);
    await adminAudit(tx, actor, { action: "billing.admin_plan_changed", tenantId, entityType: "subscription", entityId: sub.id, metadata: { from: sub.planId, to: planId, interval, forced: Boolean(opts.force) } });
  });
}

export async function setTenantStatus(actor: AdminActor, tenantId: string, status: "active" | "suspended", reason: string) {
  await assertSuperAdmin(actor.userId);
  if (reason.trim().length < 5) throw new AppError("VALIDATION", "admin.reasonRequired");
  await withSystemTx(async (tx) => {
    const t = await assertTenant(tx, tenantId);
    if (t.status === status) return;
    await tx.update(schema.tenants).set({ status }).where(eq(schema.tenants.id, tenantId));
    await adminAudit(tx, actor, { action: status === "suspended" ? "admin.tenant_suspended" : "admin.tenant_reactivated", tenantId, entityType: "tenant", entityId: tenantId, metadata: { reason: reason.trim() } });
  });
}

export const TENANT_PURGE_DAYS = 30;

/** Soft-deletes the tenant (it disappears for members immediately); data is purged after the grace period. */
export async function scheduleTenantDeletion(actor: AdminActor, tenantId: string, confirmSlug: string, reason: string) {
  await assertSuperAdmin(actor.userId);
  await withSystemTx(async (tx) => {
    const t = await assertTenant(tx, tenantId);
    if (t.slug !== confirmSlug.trim()) throw new AppError("VALIDATION", "admin.confirmSlugMismatch");
    if (reason.trim().length < 5) throw new AppError("VALIDATION", "admin.reasonRequired");
    if (t.deletedAt) return;
    const purgeAfter = new Date(Date.now() + TENANT_PURGE_DAYS * 86400_000);
    await tx.update(schema.tenants).set({ deletedAt: new Date(), purgeAfter }).where(eq(schema.tenants.id, tenantId));
    await tx.update(schema.supportSessions).set({ endedAt: new Date() }).where(and(eq(schema.supportSessions.tenantId, tenantId), isNull(schema.supportSessions.endedAt)));
    await adminAudit(tx, actor, { action: "admin.tenant_deletion_scheduled", tenantId, entityType: "tenant", entityId: tenantId, metadata: { reason: reason.trim(), purgeAfter: purgeAfter.toISOString() } });
  });
}

export async function cancelTenantDeletion(actor: AdminActor, tenantId: string) {
  await assertSuperAdmin(actor.userId);
  await withSystemTx(async (tx) => {
    const t = await assertTenant(tx, tenantId);
    if (!t.deletedAt) return;
    await tx.update(schema.tenants).set({ deletedAt: null, purgeAfter: null }).where(eq(schema.tenants.id, tenantId));
    await adminAudit(tx, actor, { action: "admin.tenant_deletion_canceled", tenantId, entityType: "tenant", entityId: tenantId });
  });
}

/* --------------------------------------------------------------- plans */

export async function listPlansAdmin(actor: AdminActor): Promise<(PlanView & { providerPriceIds: unknown; subscribers: number })[]> {
  await assertSuperAdmin(actor.userId);
  const rows = await db().select().from(schema.plans).orderBy(asc(schema.plans.sort));
  const subs = await db().execute<{ plan_id: string; n: number }>(sql`select plan_id, count(*)::int as n from public.subscriptions group by plan_id`);
  const counts = new Map(subs.map((s) => [s.plan_id, Number(s.n)]));
  return rows.map((p) => ({ ...toPlanView(p), providerPriceIds: p.providerPriceIds, subscribers: counts.get(p.id) ?? 0 }));
}

const priceIdSchema = z
  .string()
  .trim()
  .regex(/^price_[A-Za-z0-9]+$/)
  .or(z.literal(""));

export const planUpdateSchema = z.object({
  nameHe: z.string().trim().min(1).max(60),
  nameEn: z.string().trim().min(1).max(60),
  descriptionHe: z.string().trim().max(300).default(""),
  descriptionEn: z.string().trim().max(300).default(""),
  priceMonthlyCents: z.number().int().min(0).max(100_000_000),
  priceYearlyCents: z.number().int().min(0).max(1_000_000_000),
  trialDays: z.number().int().min(0).max(90),
  seatLimit: z.number().int().min(1).max(100_000).nullable(),
  limits: z.partialRecord(z.enum(LIMIT_KEYS as [LimitKey, ...LimitKey[]]), z.number().int().min(0).max(1_000_000_000)),
  features: z.array(z.enum(FEATURES)).min(1),
  isPublic: z.boolean(),
  active: z.boolean(),
  stripePriceMonth: priceIdSchema.default(""),
  stripePriceYear: priceIdSchema.default(""),
});

export async function updatePlan(actor: AdminActor, planId: string, input: z.infer<typeof planUpdateSchema>) {
  await assertSuperAdmin(actor.userId);
  const d = planUpdateSchema.parse(input);
  if (!d.features.includes("crm")) throw new AppError("VALIDATION", "admin.crmRequired");
  await withSystemTx(async (tx) => {
    const before = await getPlan(tx, planId);
    if (!before) throw new AppError("NOT_FOUND", "errors.notFound");
    if (!d.active) {
      const [{ n }] = await tx.select({ n: count() }).from(schema.subscriptions).where(eq(schema.subscriptions.planId, planId));
      if (planId === "free" || n > 0) throw new AppError("PRECONDITION", "admin.planInUse");
    }
    const providerPriceIds = { ...(before.providerPriceIds as Record<string, unknown>), stripe: { ...(d.stripePriceMonth ? { month: d.stripePriceMonth } : {}), ...(d.stripePriceYear ? { year: d.stripePriceYear } : {}) } };
    await tx
      .update(schema.plans)
      .set({
        nameHe: d.nameHe,
        nameEn: d.nameEn,
        descriptionHe: d.descriptionHe,
        descriptionEn: d.descriptionEn,
        priceMonthlyCents: d.priceMonthlyCents,
        priceYearlyCents: d.priceYearlyCents,
        trialDays: d.trialDays,
        seatLimit: d.seatLimit,
        limits: d.limits as Record<string, number>,
        features: d.features,
        isPublic: d.isPublic,
        active: d.active,
        providerPriceIds,
      })
      .where(eq(schema.plans.id, planId));
    await adminAudit(tx, actor, {
      action: "admin.plan_updated",
      entityType: "plan",
      entityId: planId,
      metadata: { before: { price: before.priceMonthlyCents, features: before.features, limits: before.limits, active: before.active }, after: { price: d.priceMonthlyCents, features: d.features, limits: d.limits, active: d.active } },
    });
  });
}

/* ------------------------------------------------------- feature flags */

export async function listFeatureFlags(actor: AdminActor) {
  await assertSuperAdmin(actor.userId);
  const flags = await db().select().from(schema.featureFlags).orderBy(asc(schema.featureFlags.key));
  const overrides = await db()
    .select({ o: schema.tenantFeatureFlags, tenantName: schema.tenants.name })
    .from(schema.tenantFeatureFlags)
    .innerJoin(schema.tenants, eq(schema.tenants.id, schema.tenantFeatureFlags.tenantId))
    .orderBy(asc(schema.tenantFeatureFlags.flagKey), asc(schema.tenants.name));
  return flags.map((f) => ({
    ...f,
    overrides: overrides.filter((o) => o.o.flagKey === f.key).map((o) => ({ tenantId: o.o.tenantId, tenantName: o.tenantName, enabled: o.o.enabled })),
  }));
}

export const flagKeySchema = z.string().regex(/^[a-z0-9_.-]{2,64}$/);

export async function createFeatureFlag(actor: AdminActor, key: string, description: string) {
  await assertSuperAdmin(actor.userId);
  const k = flagKeySchema.parse(key);
  await withSystemTx(async (tx) => {
    const inserted = await tx.insert(schema.featureFlags).values({ key: k, description: description.trim().slice(0, 300) }).onConflictDoNothing().returning();
    if (!inserted.length) throw new AppError("CONFLICT", "admin.flagExists");
    await adminAudit(tx, actor, { action: "admin.flag_created", entityType: "feature_flag", entityId: k });
  });
}

export async function setFeatureFlag(actor: AdminActor, key: string, enabled: boolean) {
  await assertSuperAdmin(actor.userId);
  await withSystemTx(async (tx) => {
    const [f] = await tx.update(schema.featureFlags).set({ enabled }).where(eq(schema.featureFlags.key, key)).returning();
    if (!f) throw new AppError("NOT_FOUND", "errors.notFound");
    await adminAudit(tx, actor, { action: "admin.flag_toggled", entityType: "feature_flag", entityId: key, metadata: { enabled } });
  });
}

/** enabled=null removes the tenant override (falls back to the global value). */
export async function setTenantFeatureFlag(actor: AdminActor, tenantId: string, key: string, enabled: boolean | null) {
  await assertSuperAdmin(actor.userId);
  await withSystemTx(async (tx) => {
    await assertTenant(tx, tenantId);
    const [f] = await tx.select().from(schema.featureFlags).where(eq(schema.featureFlags.key, key));
    if (!f) throw new AppError("NOT_FOUND", "errors.notFound");
    if (enabled === null) {
      await tx.delete(schema.tenantFeatureFlags).where(and(eq(schema.tenantFeatureFlags.tenantId, tenantId), eq(schema.tenantFeatureFlags.flagKey, key)));
    } else {
      await tx
        .insert(schema.tenantFeatureFlags)
        .values({ tenantId, flagKey: key, enabled })
        .onConflictDoUpdate({ target: [schema.tenantFeatureFlags.tenantId, schema.tenantFeatureFlags.flagKey], set: { enabled, updatedAt: new Date() } });
    }
    await adminAudit(tx, actor, { action: "admin.tenant_flag_set", tenantId, entityType: "feature_flag", entityId: key, metadata: { enabled } });
  });
}

/* ------------------------------------------------------ dead-letter queue */

export async function listDeadJobs(actor: AdminActor, opts: { page?: number; pageSize?: number } = {}) {
  await assertSuperAdmin(actor.userId);
  const pageSize = Math.min(opts.pageSize ?? 25, 100);
  const page = Math.max(1, opts.page ?? 1);
  const [{ total }] = await db().select({ total: count() }).from(schema.jobs).where(eq(schema.jobs.status, "dead"));
  const rows = await db()
    .select({ j: schema.jobs, tenantName: schema.tenants.name })
    .from(schema.jobs)
    .leftJoin(schema.tenants, eq(schema.tenants.id, schema.jobs.tenantId))
    .where(eq(schema.jobs.status, "dead"))
    .orderBy(desc(schema.jobs.finishedAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return {
    total,
    rows: rows.map((r) => ({
      id: r.j.id,
      type: r.j.type,
      tenantId: r.j.tenantId,
      tenantName: r.tenantName,
      attempts: r.j.attempts,
      maxAttempts: r.j.maxAttempts,
      lastError: r.j.lastError,
      finishedAt: r.j.finishedAt,
      createdAt: r.j.createdAt,
    })),
  };
}

export async function retryDeadJob(actor: AdminActor, jobId: number) {
  await assertSuperAdmin(actor.userId);
  const ok = await requeueDeadJob(jobId);
  if (!ok) throw new AppError("NOT_FOUND", "errors.notFound");
  await withSystemTx((tx) => adminAudit(tx, actor, { action: "admin.job_retried", entityType: "job", entityId: String(jobId) }));
}

export async function cancelDeadJob(actor: AdminActor, jobId: number) {
  await assertSuperAdmin(actor.userId);
  await withSystemTx(async (tx) => {
    const rows = await tx
      .update(schema.jobs)
      .set({ status: "canceled", finishedAt: new Date() })
      .where(and(eq(schema.jobs.id, jobId), eq(schema.jobs.status, "dead")))
      .returning({ id: schema.jobs.id });
    if (!rows.length) throw new AppError("NOT_FOUND", "errors.notFound");
    await adminAudit(tx, actor, { action: "admin.job_canceled", entityType: "job", entityId: String(jobId) });
  });
}

/* --------------------------------------------------------- support mode */

export const SUPPORT_DURATIONS = [15, 30, 60, 120, 240] as const;

export const supportStartSchema = z.object({
  tenantId: z.uuid(),
  reason: z.string().trim().min(10).max(500),
  minutes: z.coerce.number().refine((m) => (SUPPORT_DURATIONS as readonly number[]).includes(m), { message: "validation.invalidOption" }),
});

/**
 * Opens a time-boxed, read-only support session into a tenant the admin is not
 * a member of. RLS grants read access only while the session is active; the
 * start, end and every page view are audit-logged under the tenant.
 */
export async function startSupportSession(actor: AdminActor, input: z.infer<typeof supportStartSchema>) {
  await assertSuperAdmin(actor.userId);
  const d = supportStartSchema.parse(input);
  return withSystemTx(async (tx) => {
    const t = await assertTenant(tx, d.tenantId);
    if (t.deletedAt) throw new AppError("PRECONDITION", "admin.tenantDeleted");
    const [member] = await tx
      .select({ id: schema.memberships.id })
      .from(schema.memberships)
      .where(and(eq(schema.memberships.tenantId, d.tenantId), eq(schema.memberships.userId, actor.userId)));
    if (member) throw new AppError("PRECONDITION", "admin.alreadyMember");
    const now = new Date();
    // One session at a time per admin.
    await tx
      .update(schema.supportSessions)
      .set({ endedAt: now })
      .where(and(eq(schema.supportSessions.adminUserId, actor.userId), isNull(schema.supportSessions.endedAt)));
    const [session] = await tx
      .insert(schema.supportSessions)
      .values({ adminUserId: actor.userId, tenantId: d.tenantId, reason: d.reason, startedAt: now, expiresAt: new Date(now.getTime() + d.minutes * 60_000) })
      .returning();
    await adminAudit(tx, actor, { action: "admin.support_started", tenantId: d.tenantId, entityType: "support_session", entityId: session.id, metadata: { reason: d.reason, minutes: d.minutes } });
    return session;
  });
}

/** Ends the admin's active session(s); returns the tenant ids that were left. */
export async function endSupportSession(actor: AdminActor, sessionId?: string): Promise<string[]> {
  await assertSuperAdmin(actor.userId);
  return withSystemTx(async (tx) => {
    const rows = await tx
      .update(schema.supportSessions)
      .set({ endedAt: new Date() })
      .where(
        and(
          eq(schema.supportSessions.adminUserId, actor.userId),
          isNull(schema.supportSessions.endedAt),
          sessionId ? eq(schema.supportSessions.id, sessionId) : undefined,
        ),
      )
      .returning();
    for (const s of rows) {
      await adminAudit(tx, actor, { action: "admin.support_ended", tenantId: s.tenantId, entityType: "support_session", entityId: s.id });
    }
    return rows.map((r) => r.tenantId);
  });
}

export async function listSupportSessions(actor: AdminActor) {
  await assertSuperAdmin(actor.userId);
  const rows = await db()
    .select({ s: schema.supportSessions, tenantName: schema.tenants.name, adminName: schema.profiles.fullName, adminEmail: schema.profiles.email })
    .from(schema.supportSessions)
    .innerJoin(schema.tenants, eq(schema.tenants.id, schema.supportSessions.tenantId))
    .leftJoin(schema.profiles, eq(schema.profiles.id, schema.supportSessions.adminUserId))
    .orderBy(desc(schema.supportSessions.startedAt))
    .limit(50);
  const now = new Date();
  return rows.map((r) => ({
    ...r.s,
    tenantName: r.tenantName,
    adminName: r.adminName || r.adminEmail,
    active: !r.s.endedAt && r.s.expiresAt > now,
    mine: r.s.adminUserId === actor.userId,
  }));
}

/* ----------------------------------------------------------- audit log */

export const auditQuerySchema = z.object({
  action: z.string().trim().max(100).optional(),
  tenant: z.uuid().optional(),
  scope: z.enum(["all", "platform", "admin"]).default("all"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(50),
});

export async function listPlatformAudit(actor: AdminActor, q: z.infer<typeof auditQuerySchema>) {
  await assertSuperAdmin(actor.userId);
  const conds: (SQL | undefined)[] = [];
  if (q.action) conds.push(like(schema.auditLogs.action, `${q.action.replace(/[\\%_]/g, (c) => `\\${c}`)}%`));
  if (q.tenant) conds.push(eq(schema.auditLogs.tenantId, q.tenant));
  if (q.scope === "platform") conds.push(isNull(schema.auditLogs.tenantId));
  if (q.scope === "admin") conds.push(eq(schema.auditLogs.actorType, "admin"));
  const where = and(...conds);
  const [{ total }] = await db().select({ total: count() }).from(schema.auditLogs).where(where);
  const rows = await db()
    .select({ a: schema.auditLogs, actorName: schema.profiles.fullName, actorEmail: schema.profiles.email, tenantName: schema.tenants.name })
    .from(schema.auditLogs)
    .leftJoin(schema.profiles, eq(schema.profiles.id, schema.auditLogs.actorUserId))
    .leftJoin(schema.tenants, eq(schema.tenants.id, schema.auditLogs.tenantId))
    .where(where)
    .orderBy(desc(schema.auditLogs.createdAt))
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);
  return { total, rows: rows.map((r) => ({ ...r.a, actorName: r.actorName || r.actorEmail, tenantName: r.tenantName })) };
}

/** Tenants with an active support session for this admin (for the "back to support" link). */
export async function activeSupportFor(actor: AdminActor) {
  await assertSuperAdmin(actor.userId);
  const [s] = await db()
    .select({ s: schema.supportSessions, tenantName: schema.tenants.name })
    .from(schema.supportSessions)
    .innerJoin(schema.tenants, eq(schema.tenants.id, schema.supportSessions.tenantId))
    .where(and(eq(schema.supportSessions.adminUserId, actor.userId), isNull(schema.supportSessions.endedAt), gt(schema.supportSessions.expiresAt, new Date())))
    .limit(1);
  return s ? { ...s.s, tenantName: s.tenantName } : null;
}



import { and, count, desc, eq, like, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, schema, withSystemTx, type Executor, type Tx } from "@/server/db";
import { assertCan, assertCanWrite, type ServiceCtx } from "@/server/context";
import { audit } from "@/server/audit";
import { AppError } from "@/server/errors";
import { env } from "@/server/env";
import { errorFields, logger } from "@/server/logger";
import { getEntitlements, monthlyUsage, type Feature, type LimitKey } from "./entitlements";
import { addInterval, getPlan, isPaidPlan, listPlans, planPriceCents, providerPriceId, toPlanView, type BillingInterval, type PlanRow, type PlanView } from "./plans";
import { billingProvider, BillingProviderError, LiveModeDisabledError, type InvoiceView, type ProviderSubscriptionState } from "./providers";

export type SubscriptionRow = typeof schema.subscriptions.$inferSelect;

export type UsageMeter = { key: "contacts" | "ai_tokens" | "whatsapp_messages" | "workflows" | "storage_mb"; used: number; limit: number | null };

export type BillingOverview = {
  providerKind: "mock" | "stripe";
  subscription: {
    planId: string;
    status: string;
    interval: BillingInterval;
    seats: number;
    provider: string;
    cancelAtPeriodEnd: boolean;
    trialEndsAt: Date | null;
    currentPeriodStart: Date | null;
    currentPeriodEnd: Date | null;
    pastDueSince: Date | null;
    hasProviderSubscription: boolean;
  };
  plan: PlanView;
  plans: PlanView[];
  features: Feature[];
  seatsUsed: number;
  seatLimit: number | null;
  usage: UsageMeter[];
  history: { id: number; action: string; actorName: string | null; createdAt: Date; metadata: Record<string, unknown> }[];
};

async function loadSubscription(tx: Executor, tenantId: string, opts: { lock?: boolean } = {}): Promise<SubscriptionRow> {
  const q = tx.select().from(schema.subscriptions).where(eq(schema.subscriptions.tenantId, tenantId)).limit(1);
  const [sub] = opts.lock ? await q.for("update") : await q;
  if (!sub) throw new AppError("NOT_FOUND", "billing.noSubscription");
  return sub;
}

export async function activeMemberCount(tx: Executor, tenantId: string): Promise<number> {
  const [r] = await tx
    .select({ n: count() })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.tenantId, tenantId), eq(schema.memberships.status, "active")));
  return Number(r?.n ?? 0);
}

async function usageCounts(tx: Executor, tenantId: string) {
  const [row] = await tx.execute<{ contacts: number; workflows: number; storage_bytes: string }>(sql`
    select
      (select count(*)::int from public.contacts where tenant_id = ${tenantId} and deleted_at is null) as contacts,
      (select count(*)::int from public.automation_workflows where tenant_id = ${tenantId} and status <> 'archived') as workflows,
      (select coalesce(sum(size_bytes), 0)::text from public.attachments where tenant_id = ${tenantId} and deleted_at is null) as storage_bytes`);
  return { contacts: Number(row?.contacts ?? 0), workflows: Number(row?.workflows ?? 0), storageBytes: Number(row?.storage_bytes ?? 0) };
}

export async function getBillingOverview(ctx: ServiceCtx): Promise<BillingOverview> {
  assertCan(ctx, "billing.view");
  // Plan catalog and subscription are read with system privileges (inactive plans
  // are hidden from app users by RLS, but a tenant may still be on one).
  const [sub, ent, plans] = await Promise.all([loadSubscription(db(), ctx.tenantId), getEntitlements(db(), ctx.tenantId), listPlans(db())]);
  const currentPlan = (await getPlan(db(), sub.planId))!;
  const { counts, seatsUsed, aiTokens, waMessages, history } = await ctx.run(async (tx) => ({
    counts: await usageCounts(tx, ctx.tenantId),
    seatsUsed: await activeMemberCount(tx, ctx.tenantId),
    aiTokens: await monthlyUsage(tx, ctx.tenantId, "ai_tokens"),
    waMessages: await monthlyUsage(tx, ctx.tenantId, "whatsapp_messages"),
    history: await tx
      .select({ a: schema.auditLogs, actorName: schema.profiles.fullName })
      .from(schema.auditLogs)
      .leftJoin(schema.profiles, eq(schema.profiles.id, schema.auditLogs.actorUserId))
      .where(and(eq(schema.auditLogs.tenantId, ctx.tenantId), like(schema.auditLogs.action, "billing.%")))
      .orderBy(desc(schema.auditLogs.createdAt))
      .limit(20),
  }));
  const limit = (k: LimitKey) => ent.limits[k] ?? null;
  return {
    providerKind: billingProvider().kind,
    subscription: {
      planId: sub.planId,
      status: sub.status,
      interval: sub.billingInterval as BillingInterval,
      seats: sub.seats,
      provider: sub.provider,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      trialEndsAt: sub.trialEndsAt,
      currentPeriodStart: sub.currentPeriodStart,
      currentPeriodEnd: sub.currentPeriodEnd,
      pastDueSince: sub.pastDueSince,
      hasProviderSubscription: Boolean(sub.providerSubscriptionId),
    },
    plan: toPlanView(currentPlan),
    plans: plans.filter((p) => p.isPublic || p.id === sub.planId),
    features: [...ent.features],
    seatsUsed,
    seatLimit: ent.seatLimit,
    usage: [
      { key: "contacts", used: counts.contacts, limit: limit("max_contacts") },
      { key: "ai_tokens", used: aiTokens, limit: limit("ai_tokens_monthly") },
      { key: "whatsapp_messages", used: waMessages, limit: limit("whatsapp_messages_monthly") },
      { key: "workflows", used: counts.workflows, limit: limit("max_workflows") },
      { key: "storage_mb", used: Math.ceil(counts.storageBytes / (1024 * 1024)), limit: limit("storage_mb") },
    ],
    history: history.map((h) => ({ id: h.a.id, action: h.a.action, actorName: h.actorName, createdAt: h.a.createdAt, metadata: h.a.metadata })),
  };
}

/** A downgrade must not strand data: seats, contacts and workflows must fit the new plan. */
export async function assertPlanFits(tx: Executor, tenantId: string, plan: PlanRow) {
  const seats = await activeMemberCount(tx, tenantId);
  const [ov] = await tx.select().from(schema.tenantPlanOverrides).where(eq(schema.tenantPlanOverrides.tenantId, tenantId));
  const overrideLimits = (ov?.limits ?? {}) as Record<string, number>;
  const seatLimit = overrideLimits.seats ?? plan.seatLimit;
  if (seatLimit !== null && seatLimit !== undefined && seats > seatLimit) {
    throw new AppError("PRECONDITION", "billing.tooManyMembers", undefined, { limit: seatLimit, current: seats });
  }
  const limits = { ...(plan.limits as Record<string, number>), ...overrideLimits };
  const counts = await usageCounts(tx, tenantId);
  if (limits.max_contacts !== undefined && counts.contacts > limits.max_contacts) {
    throw new AppError("PRECONDITION", "billing.tooManyContacts", undefined, { limit: limits.max_contacts, current: counts.contacts });
  }
  if (limits.max_workflows !== undefined && counts.workflows > limits.max_workflows) {
    throw new AppError("PRECONDITION", "billing.tooManyWorkflows", undefined, { limit: limits.max_workflows, current: counts.workflows });
  }
}

/**
 * Applies a plan in our database (mock provider, admin overrides, free plan).
 * Starts a fresh billing period and clears trial/cancellation/dunning state.
 */
export async function applyPlanLocally(tx: Tx, sub: SubscriptionRow, plan: PlanRow, interval: BillingInterval, now = new Date()) {
  const paid = isPaidPlan(toPlanView(plan));
  const [updated] = await tx
    .update(schema.subscriptions)
    .set({
      planId: plan.id,
      billingInterval: interval,
      status: "active",
      trialEndsAt: null,
      currentPeriodStart: now,
      currentPeriodEnd: addInterval(now, interval),
      cancelAtPeriodEnd: false,
      canceledAt: null,
      pastDueSince: null,
      providerCustomerId: sub.providerCustomerId ?? (sub.provider === "mock" ? `mock_cus_${sub.tenantId.slice(0, 8)}` : null),
      providerSubscriptionId: paid ? (sub.provider === "mock" ? (sub.providerSubscriptionId ?? `mock_sub_${randomUUID()}`) : sub.providerSubscriptionId) : null,
    })
    .where(eq(schema.subscriptions.id, sub.id))
    .returning();
  return updated;
}

/** Writes provider-reported state onto the subscription (Stripe API responses and webhooks). */
export async function applyProviderState(tx: Tx, sub: SubscriptionRow, state: ProviderSubscriptionState, mapped: { planId: string; interval: BillingInterval } | null) {
  const status = state.status;
  const [updated] = await tx
    .update(schema.subscriptions)
    .set({
      provider: "stripe",
      providerSubscriptionId: state.providerSubscriptionId,
      providerCustomerId: state.providerCustomerId ?? sub.providerCustomerId,
      status,
      planId: mapped?.planId ?? sub.planId,
      billingInterval: mapped?.interval ?? sub.billingInterval,
      currentPeriodStart: state.currentPeriodStart ?? sub.currentPeriodStart,
      currentPeriodEnd: state.currentPeriodEnd ?? sub.currentPeriodEnd,
      cancelAtPeriodEnd: state.cancelAtPeriodEnd,
      canceledAt: state.canceledAt,
      trialEndsAt: status === "trialing" ? (state.trialEndsAt ?? sub.trialEndsAt) : sub.trialEndsAt,
      pastDueSince: status === "past_due" ? (sub.pastDueSince ?? new Date()) : null,
    })
    .where(eq(schema.subscriptions.id, sub.id))
    .returning();
  return updated;
}

function providerError(e: unknown): never {
  if (e instanceof LiveModeDisabledError) throw new AppError("PROVIDER_ERROR", "billing.liveDisabled");
  if (e instanceof BillingProviderError) {
    logger().error({ ...errorFields(e), status: e.status, code: e.code }, "billing provider error");
    throw new AppError("PROVIDER_ERROR", "billing.providerError");
  }
  throw e;
}

export type ChangePlanResult = { type: "applied" } | { type: "redirect"; url: string };

export async function changePlan(ctx: ServiceCtx, input: { planId: string; interval: BillingInterval }): Promise<ChangePlanResult> {
  assertCanWrite(ctx, "billing.manage");
  const provider = billingProvider();
  return withSystemTx(async (tx) => {
    const plan = await getPlan(tx, input.planId);
    if (!plan || !plan.active || !plan.isPublic) throw new AppError("NOT_FOUND", "billing.planUnavailable");
    const sub = await loadSubscription(tx, ctx.tenantId, { lock: true });
    const sameAsNow = sub.planId === plan.id && sub.billingInterval === input.interval && sub.status === "active" && !sub.cancelAtPeriodEnd;
    if (sameAsNow) throw new AppError("CONFLICT", "billing.alreadyOnPlan");
    await assertPlanFits(tx, ctx.tenantId, plan);
    const meta = { from: sub.planId, to: plan.id, interval: input.interval, fromStatus: sub.status };
    const paid = isPaidPlan(toPlanView(plan));
    const hasRemote = provider.kind === "stripe" && sub.provider === "stripe" && Boolean(sub.providerSubscriptionId) && sub.status !== "canceled";

    if (provider.kind === "mock" || (!paid && !hasRemote)) {
      await applyPlanLocally(tx, sub, plan, input.interval);
      await audit(tx, ctx, { action: "billing.plan_changed", entityType: "subscription", entityId: sub.id, metadata: { ...meta, provider: provider.kind } });
      return { type: "applied" };
    }

    if (!paid) {
      // Downgrading a Stripe subscription to free = cancel at period end.
      const state = await provider.cancel({ subscriptionId: sub.providerSubscriptionId! }).catch(providerError);
      if (state) await applyProviderState(tx, sub, state, null);
      await audit(tx, ctx, { action: "billing.downgrade_scheduled", entityType: "subscription", entityId: sub.id, metadata: meta });
      return { type: "applied" };
    }

    const priceId = providerPriceId(plan, "stripe", input.interval);
    if (!priceId) throw new AppError("PRECONDITION", "billing.priceNotConfigured");
    const seats = Math.max(1, await activeMemberCount(tx, ctx.tenantId));

    if (hasRemote) {
      const state = await provider
        .changePlan({ subscriptionId: sub.providerSubscriptionId!, priceId, planId: plan.id, interval: input.interval, seats })
        .catch(providerError);
      if (state) await applyProviderState(tx, sub, state, { planId: plan.id, interval: input.interval });
      await audit(tx, ctx, { action: "billing.plan_changed", entityType: "subscription", entityId: sub.id, metadata: { ...meta, provider: "stripe" } });
      return { type: "applied" };
    }

    const [owner] = ctx.userId
      ? await tx.select({ email: schema.profiles.email }).from(schema.profiles).where(eq(schema.profiles.id, ctx.userId))
      : [];
    const base = env().APP_URL;
    const result = await provider
      .createCheckout({
        tenantId: ctx.tenantId,
        planId: plan.id,
        interval: input.interval,
        priceId,
        seats,
        customerId: sub.provider === "stripe" ? sub.providerCustomerId : null,
        customerEmail: owner?.email ?? null,
        successUrl: `${base}/settings/billing?checkout=success`,
        cancelUrl: `${base}/settings/billing?checkout=canceled`,
      })
      .catch(providerError);
    await audit(tx, ctx, { action: "billing.checkout_started", entityType: "subscription", entityId: sub.id, metadata: meta });
    return result.type === "redirect" ? result : { type: "applied" };
  });
}

export async function cancelSubscription(ctx: ServiceCtx) {
  assertCanWrite(ctx, "billing.manage");
  const provider = billingProvider();
  await withSystemTx(async (tx) => {
    const sub = await loadSubscription(tx, ctx.tenantId, { lock: true });
    const plan = (await getPlan(tx, sub.planId))!;
    if (!isPaidPlan(toPlanView(plan)) || sub.cancelAtPeriodEnd || sub.status === "canceled") throw new AppError("CONFLICT", "billing.nothingToCancel");
    if (provider.kind === "stripe" && sub.provider === "stripe" && sub.providerSubscriptionId) {
      const state = await provider.cancel({ subscriptionId: sub.providerSubscriptionId }).catch(providerError);
      if (state) await applyProviderState(tx, sub, state, null);
    } else {
      await tx.update(schema.subscriptions).set({ cancelAtPeriodEnd: true }).where(eq(schema.subscriptions.id, sub.id));
    }
    await audit(tx, ctx, {
      action: "billing.cancel_scheduled",
      entityType: "subscription",
      entityId: sub.id,
      metadata: { planId: sub.planId, effectiveAt: (sub.status === "trialing" ? sub.trialEndsAt : sub.currentPeriodEnd)?.toISOString() ?? null },
    });
  });
}

export async function resumeSubscription(ctx: ServiceCtx) {
  assertCanWrite(ctx, "billing.manage");
  const provider = billingProvider();
  await withSystemTx(async (tx) => {
    const sub = await loadSubscription(tx, ctx.tenantId, { lock: true });
    if (!sub.cancelAtPeriodEnd) throw new AppError("CONFLICT", "billing.notCanceling");
    if (provider.kind === "stripe" && sub.provider === "stripe" && sub.providerSubscriptionId) {
      const state = await provider.resume({ subscriptionId: sub.providerSubscriptionId }).catch(providerError);
      if (state) await applyProviderState(tx, sub, state, null);
    } else {
      await tx.update(schema.subscriptions).set({ cancelAtPeriodEnd: false }).where(eq(schema.subscriptions.id, sub.id));
    }
    await audit(tx, ctx, { action: "billing.resumed", entityType: "subscription", entityId: sub.id, metadata: { planId: sub.planId } });
  });
}

export async function openBillingPortal(ctx: ServiceCtx): Promise<{ url: string }> {
  assertCanWrite(ctx, "billing.manage");
  const sub = await loadSubscription(db(), ctx.tenantId);
  const provider = billingProvider();
  return provider
    .createPortal({ customerId: sub.provider === provider.kind ? sub.providerCustomerId : null, returnUrl: `${env().APP_URL}/settings/billing` })
    .catch(providerError);
}

export async function listInvoices(ctx: ServiceCtx): Promise<InvoiceView[]> {
  assertCan(ctx, "billing.view");
  const sub = await loadSubscription(db(), ctx.tenantId);
  const plan = (await getPlan(db(), sub.planId))!;
  const provider = billingProvider();
  if (sub.status === "trialing") return [];
  try {
    return await provider.listInvoices({
      customerId: sub.provider === provider.kind ? sub.providerCustomerId : null,
      amountCents: planPriceCents(toPlanView(plan), sub.billingInterval as BillingInterval) * Math.max(1, sub.seats),
      currency: plan.currency,
      interval: sub.billingInterval as BillingInterval,
      periodStart: sub.currentPeriodStart,
    });
  } catch (e) {
    logger().warn(errorFields(e), "could not list invoices");
    return [];
  }
}

/** Members currently using a seat vs. the cap (used by the team page). */
export async function seatSummary(tx: Executor, tenantId: string) {
  const ent = await getEntitlements(tx, tenantId);
  return { used: await activeMemberCount(tx, tenantId), limit: ent.seatLimit };
}


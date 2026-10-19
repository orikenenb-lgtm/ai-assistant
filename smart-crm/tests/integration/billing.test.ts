import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { closeDb, db, schema } from "@/server/db";
import { AppError } from "@/server/errors";
import { drainJobs, type Job } from "@/server/jobs/runner";
import { getEntitlements } from "@/modules/billing/entitlements";
import { cancelSubscription, changePlan, getBillingOverview, listInvoices, openBillingPortal, resumeSubscription } from "@/modules/billing/service";
import { setBillingProviderForTests, StripeBillingProvider, type BillingProvider, type ProviderSubscriptionState } from "@/modules/billing/providers";
import { signStripePayload } from "@/modules/billing/stripe-signature";
import { ingestBillingWebhook, processBillingWebhookJob } from "@/modules/billing/webhooks";
import { queueSeatSync, syncSeatsNow } from "@/modules/billing/seats";
import { cancelLapsedPastDue, expireTrials, rollMockPeriods } from "@/modules/billing/lifecycle";
import { removeMember } from "@/modules/org/members";
import { adminChangePlan } from "@/modules/admin/service";
import "@/modules/billing/jobs";
import { createTeam, createUser } from "../support/factories";

const WHSEC = "whsec_integration_test";
const stripe = new StripeBillingProvider("sk_test_integration", WHSEC, { liveMode: false });

async function expectAppError(p: Promise<unknown>, code: string, message?: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code && (!message || e.message === message));
}

async function sub(tenantId: string) {
  const [s] = await db().select().from(schema.subscriptions).where(eq(schema.subscriptions.tenantId, tenantId));
  return s;
}

async function auditCount(tenantId: string, action: string) {
  const [r] = await db().execute<{ n: number }>(sql`select count(*)::int as n from public.audit_logs where tenant_id = ${tenantId} and action = ${action}`);
  return Number(r.n);
}

let seq = 0;
function stripeEvent(type: string, object: Record<string, unknown>, id = `evt_${Date.now()}_${++seq}`) {
  return { id, body: JSON.stringify({ id, object: "event", type, created: Math.floor(Date.now() / 1000), data: { object } }) };
}

/** Delivers a signed event through ingest + the durable job, like production. */
async function deliver(type: string, object: Record<string, unknown>, id?: string) {
  const e = stripeEvent(type, object, id);
  const res = await ingestBillingWebhook(e.body, signStripePayload(e.body, WHSEC), stripe);
  await drainJobs({ workerId: "billing-test", types: ["billing.process_webhook"] });
  return { ...res, eventId: e.id };
}

async function webhookRow(eventKey: string) {
  const [row] = await db()
    .select()
    .from(schema.webhookEvents)
    .where(and(eq(schema.webhookEvents.provider, "billing"), eq(schema.webhookEvents.eventKey, eventKey)));
  return row;
}

function stripeSub(id: string, tenantId: string, priceId: string, extra: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    id,
    object: "subscription",
    customer: "cus_test_1",
    status: "active",
    cancel_at_period_end: false,
    metadata: { tenantId },
    items: { data: [{ id: "si_1", quantity: 3, price: { id: priceId }, current_period_start: now, current_period_end: now + 30 * 86400 }] },
    ...extra,
  };
}

/** A stand-in for the Stripe API (no network): records calls and returns realistic state. */
function fakeStripe() {
  const calls: { method: string; input: Record<string, unknown> }[] = [];
  const state = (o: Partial<ProviderSubscriptionState> & { providerSubscriptionId: string }): ProviderSubscriptionState => ({
    providerCustomerId: "cus_test_1",
    status: "active",
    priceId: null,
    quantity: 3,
    currentPeriodStart: new Date(),
    currentPeriodEnd: new Date(Date.now() + 30 * 86400_000),
    cancelAtPeriodEnd: false,
    canceledAt: null,
    trialEndsAt: null,
    tenantId: null,
    ...o,
  });
  const provider: BillingProvider = {
    kind: "stripe",
    async createCheckout(input) {
      calls.push({ method: "createCheckout", input });
      return { type: "redirect", url: "https://checkout.stripe.test/c/cs_test_1" };
    },
    async createPortal(input) {
      calls.push({ method: "createPortal", input });
      return { url: "https://billing.stripe.test/p/session_1" };
    },
    async changePlan(input) {
      calls.push({ method: "changePlan", input });
      return state({ providerSubscriptionId: input.subscriptionId, priceId: input.priceId });
    },
    async cancel(input) {
      calls.push({ method: "cancel", input });
      return state({ providerSubscriptionId: input.subscriptionId, cancelAtPeriodEnd: true });
    },
    async resume(input) {
      calls.push({ method: "resume", input });
      return state({ providerSubscriptionId: input.subscriptionId });
    },
    async syncSeats(input) {
      calls.push({ method: "syncSeats", input });
    },
    async listInvoices() {
      return [];
    },
    parseWebhook() {
      throw new Error("not used");
    },
  };
  return { provider, calls };
}

beforeAll(async () => {
  await db().execute(sql`update public.plans set provider_price_ids = '{"stripe": {"month": "price_starter_m", "year": "price_starter_y"}}'::jsonb where id = 'starter'`);
  await db().execute(sql`update public.plans set provider_price_ids = '{"stripe": {"month": "price_pro_m"}}'::jsonb where id = 'pro'`);
});

afterEach(() => setBillingProviderForTests(undefined));

afterAll(async () => {
  await db().execute(sql`update public.plans set provider_price_ids = '{}'::jsonb where id in ('starter', 'pro')`);
  await closeDb();
});

describe("billing overview and permissions (mock provider)", () => {
  it("owners and managers can view billing; agents cannot; only owners can change it", async () => {
    const T = await createTeam("Billing View Co");
    const overview = await getBillingOverview(T.ownerCtx);
    expect(overview.providerKind).toBe("mock");
    expect(overview.subscription).toMatchObject({ planId: "pro", status: "trialing" });
    expect(overview.seatsUsed).toBe(3);
    expect(overview.usage.map((u) => u.key)).toEqual(["contacts", "ai_tokens", "whatsapp_messages", "workflows", "storage_mb"]);
    expect((await getBillingOverview(T.managerCtx)).plan.id).toBe("pro");
    await expectAppError(getBillingOverview(T.agentCtx), "FORBIDDEN");
    await expectAppError(changePlan(T.managerCtx, { planId: "starter", interval: "month" }), "FORBIDDEN");
    await expectAppError(cancelSubscription(T.managerCtx), "FORBIDDEN");
    await expectAppError(openBillingPortal(T.agentCtx), "FORBIDDEN");
    expect(await listInvoices(T.ownerCtx)).toEqual([]); // trial: nothing billed yet
  });
});

describe("plan changes (mock provider)", () => {
  it("applies a plan immediately, updates entitlements and records history", async () => {
    const T = await createTeam("Mock Change Co");
    expect(await changePlan(T.ownerCtx, { planId: "starter", interval: "year" })).toEqual({ type: "applied" });
    const s = await sub(T.tenant.id);
    expect(s).toMatchObject({ planId: "starter", status: "active", billingInterval: "year", trialEndsAt: null, cancelAtPeriodEnd: false });
    expect(s.providerSubscriptionId).toMatch(/^mock_sub_/);
    expect(s.currentPeriodEnd!.getTime() - s.currentPeriodStart!.getTime()).toBeGreaterThan(364 * 86400_000);
    const ent = await getEntitlements(db(), T.tenant.id);
    expect(ent.planId).toBe("starter");
    expect(ent.features.has("api")).toBe(false);
    expect(ent.limits.max_contacts).toBe(5000);
    expect(ent.seatLimit).toBe(5);
    expect(await auditCount(T.tenant.id, "billing.plan_changed")).toBe(1);
    const invoices = await listInvoices(T.ownerCtx);
    expect(invoices.length).toBeGreaterThan(0);
    expect(invoices.every((i) => i.sample)).toBe(true);
    expect(invoices[0].amountCents).toBe(149000 * s.seats);
    expect((await getBillingOverview(T.ownerCtx)).history[0].action).toBe("billing.plan_changed");
  });

  it("rejects no-op changes, unknown plans and downgrades that would strand members", async () => {
    const T = await createTeam("Mock Reject Co");
    await changePlan(T.ownerCtx, { planId: "starter", interval: "month" });
    await expectAppError(changePlan(T.ownerCtx, { planId: "starter", interval: "month" }), "CONFLICT", "billing.alreadyOnPlan");
    await expectAppError(changePlan(T.ownerCtx, { planId: "nope", interval: "month" }), "NOT_FOUND", "billing.planUnavailable");
    // Free allows 2 users; the team has 3 active members.
    await expectAppError(changePlan(T.ownerCtx, { planId: "free", interval: "month" }), "PRECONDITION", "billing.tooManyMembers");
    await removeMember(T.ownerCtx, T.agent.id);
    expect(await changePlan(T.ownerCtx, { planId: "free", interval: "month" })).toEqual({ type: "applied" });
    expect((await sub(T.tenant.id)).providerSubscriptionId).toBeNull();
  });

  it("cancels at period end, resumes, and the mock renewal job ends canceled subscriptions", async () => {
    const T = await createTeam("Mock Cancel Co");
    await changePlan(T.ownerCtx, { planId: "starter", interval: "month" });
    await expectAppError(resumeSubscription(T.ownerCtx), "CONFLICT", "billing.notCanceling");
    await cancelSubscription(T.ownerCtx);
    expect((await sub(T.tenant.id)).cancelAtPeriodEnd).toBe(true);
    await expectAppError(cancelSubscription(T.ownerCtx), "CONFLICT", "billing.nothingToCancel");
    await resumeSubscription(T.ownerCtx);
    expect((await sub(T.tenant.id)).cancelAtPeriodEnd).toBe(false);
    expect(await auditCount(T.tenant.id, "billing.cancel_scheduled")).toBe(1);
    expect(await auditCount(T.tenant.id, "billing.resumed")).toBe(1);

    // Renewal: an uncanceled period rolls forward.
    const before = await sub(T.tenant.id);
    const later = new Date(before.currentPeriodEnd!.getTime() + 86400_000);
    await rollMockPeriods(later);
    const rolled = await sub(T.tenant.id);
    expect(rolled.planId).toBe("starter");
    expect(rolled.currentPeriodStart!.getTime()).toBe(before.currentPeriodEnd!.getTime());
    expect(rolled.currentPeriodEnd!.getTime()).toBeGreaterThan(later.getTime());

    // Cancellation takes effect at the end of the period.
    await cancelSubscription(T.ownerCtx);
    await rollMockPeriods(new Date(rolled.currentPeriodEnd!.getTime() + 1000));
    const ended = await sub(T.tenant.id);
    expect(ended).toMatchObject({ planId: "free", status: "active", cancelAtPeriodEnd: false, providerSubscriptionId: null });
    expect(await auditCount(T.tenant.id, "billing.subscription_ended")).toBe(1);
  });
});

describe("plan changes (Stripe provider, no network)", () => {
  it("starts Checkout for a new paid subscription without changing local state", async () => {
    const T = await createTeam("Stripe Checkout Co");
    const fake = fakeStripe();
    setBillingProviderForTests(fake.provider);
    const res = await changePlan(T.ownerCtx, { planId: "starter", interval: "month" });
    expect(res).toEqual({ type: "redirect", url: "https://checkout.stripe.test/c/cs_test_1" });
    expect(fake.calls[0]).toMatchObject({ method: "createCheckout", input: { tenantId: T.tenant.id, planId: "starter", priceId: "price_starter_m", seats: 3, customerId: null } });
    expect(fake.calls[0].input.customerEmail).toBe(T.owner.email);
    expect(await sub(T.tenant.id)).toMatchObject({ planId: "pro", status: "trialing", provider: "mock" });
    expect(await auditCount(T.tenant.id, "billing.checkout_started")).toBe(1);
    await expectAppError(changePlan(T.ownerCtx, { planId: "pro", interval: "year" }), "PRECONDITION", "billing.priceNotConfigured");
  });

  it("webhooks activate the subscription; later changes go through the Stripe API", async () => {
    const T = await createTeam("Stripe Lifecycle Co");
    const tenantId = T.tenant.id;
    const done = await deliver("checkout.session.completed", {
      id: "cs_test_1",
      object: "checkout.session",
      mode: "subscription",
      client_reference_id: tenantId,
      customer: "cus_test_1",
      subscription: "sub_A",
      metadata: { tenantId, planId: "starter", interval: "month" },
    });
    expect(done.status).toBe("accepted");
    expect((await webhookRow(done.eventId)).status).toBe("processed");
    expect(await sub(tenantId)).toMatchObject({ provider: "stripe", providerSubscriptionId: "sub_A", providerCustomerId: "cus_test_1", planId: "starter", status: "active", trialEndsAt: null });

    const fake = fakeStripe();
    setBillingProviderForTests(fake.provider);
    expect(await changePlan(T.ownerCtx, { planId: "pro", interval: "month" })).toEqual({ type: "applied" });
    expect(fake.calls.at(-1)).toMatchObject({ method: "changePlan", input: { subscriptionId: "sub_A", priceId: "price_pro_m", planId: "pro", seats: 3 } });
    expect((await sub(tenantId)).planId).toBe("pro");

    await cancelSubscription(T.ownerCtx);
    expect(fake.calls.at(-1)).toMatchObject({ method: "cancel", input: { subscriptionId: "sub_A" } });
    expect((await sub(tenantId)).cancelAtPeriodEnd).toBe(true);
    await resumeSubscription(T.ownerCtx);
    expect(fake.calls.at(-1)?.method).toBe("resume");
    expect((await sub(tenantId)).cancelAtPeriodEnd).toBe(false);
    expect(await openBillingPortal(T.ownerCtx)).toEqual({ url: "https://billing.stripe.test/p/session_1" });
    expect(fake.calls.at(-1)).toMatchObject({ method: "createPortal", input: { customerId: "cus_test_1" } });

    // Seat changes are pushed to Stripe.
    await removeMember(T.ownerCtx, T.agent.id);
    expect(await syncSeatsNow(tenantId)).toEqual({ seats: 2, changed: true });
    expect(fake.calls.at(-1)).toMatchObject({ method: "syncSeats", input: { subscriptionId: "sub_A", seats: 2 } });

    // Platform admins can't silently override a Stripe-managed subscription.
    const admin = await createUser({ superAdmin: true });
    await expectAppError(adminChangePlan({ userId: admin.id, ip: null, userAgent: null }, tenantId, "business", "month"), "PRECONDITION", "admin.stripeManaged");
  });
});

describe("Stripe webhooks", () => {
  it("are idempotent: a redelivered event is stored and applied once", async () => {
    const T = await createTeam("Webhook Idem Co");
    const tenantId = T.tenant.id;
    await db().update(schema.subscriptions).set({ provider: "stripe", providerSubscriptionId: "sub_I", providerCustomerId: "cus_I", planId: "starter", status: "active" }).where(eq(schema.subscriptions.tenantId, tenantId));
    const e = stripeEvent("invoice.paid", { id: "in_1", object: "invoice", subscription: "sub_I", customer: "cus_I", amount_paid: 44700, currency: "ils" });
    const header = signStripePayload(e.body, WHSEC);
    const first = await ingestBillingWebhook(e.body, header, stripe);
    const second = await ingestBillingWebhook(e.body, header, stripe);
    expect(first.status).toBe("accepted");
    expect(second).toEqual({ status: "duplicate", webhookEventId: null });
    const [{ n: jobs }] = await db().execute<{ n: number }>(sql`select count(*)::int as n from public.jobs where type = 'billing.process_webhook' and payload->>'webhookEventId' = ${first.webhookEventId}`);
    expect(Number(jobs)).toBe(1);
    await drainJobs({ workerId: "billing-test", types: ["billing.process_webhook"] });
    // Even if the job ran again (e.g. a worker crash after commit), nothing is applied twice.
    await processBillingWebhookJob({ payload: { webhookEventId: first.webhookEventId } } as unknown as Job);
    expect(await auditCount(tenantId, "billing.invoice_paid")).toBe(1);
    expect((await webhookRow(e.id)).status).toBe("processed");
  });

  it("rejects bad signatures before storing anything", async () => {
    const e = stripeEvent("invoice.paid", { id: "in_x", object: "invoice", subscription: "sub_x" });
    await expect(ingestBillingWebhook(e.body, signStripePayload(e.body, "whsec_wrong"), stripe)).rejects.toThrow(/signature/);
    await expect(ingestBillingWebhook(e.body, null, stripe)).rejects.toThrow(/signature/);
    const old = signStripePayload(e.body, WHSEC, Math.floor(Date.now() / 1000) - 3600);
    await expect(ingestBillingWebhook(e.body, old, stripe)).rejects.toThrow(/tolerance/);
    expect(await webhookRow(e.id)).toBeUndefined();
  });

  it("handles payment failure, recovery, plan updates and deletion", async () => {
    const T = await createTeam("Webhook Flow Co");
    const tenantId = T.tenant.id;
    await db().update(schema.subscriptions).set({ provider: "stripe", providerSubscriptionId: "sub_F", providerCustomerId: "cus_F", planId: "starter", status: "active" }).where(eq(schema.subscriptions.tenantId, tenantId));

    await deliver("invoice.payment_failed", { id: "in_f1", object: "invoice", subscription: "sub_F", customer: "cus_F", attempt_count: 1 });
    const failed = await sub(tenantId);
    expect(failed.status).toBe("past_due");
    expect(failed.pastDueSince).toBeInstanceOf(Date);
    const notes = await db().select().from(schema.notifications).where(and(eq(schema.notifications.tenantId, tenantId), eq(schema.notifications.type, "billing")));
    expect(notes.map((n) => n.userId)).toEqual([T.owner.id]);
    const [{ n: emails }] = await db().execute<{ n: number }>(sql`select count(*)::int as n from public.jobs where type = 'email.notification' and tenant_id = ${tenantId}`);
    expect(Number(emails)).toBeGreaterThanOrEqual(1);

    // A second failure keeps the original dunning start.
    await deliver("invoice.payment_failed", { id: "in_f2", object: "invoice", subscription: "sub_F", customer: "cus_F", attempt_count: 2 });
    expect((await sub(tenantId)).pastDueSince?.getTime()).toBe(failed.pastDueSince!.getTime());

    await deliver("invoice.paid", { id: "in_f3", object: "invoice", subscription: "sub_F", customer: "cus_F", amount_paid: 1000 });
    expect(await sub(tenantId)).toMatchObject({ status: "active", pastDueSince: null });

    await deliver("customer.subscription.updated", stripeSub("sub_F", tenantId, "price_pro_m", { customer: "cus_F", cancel_at_period_end: true }));
    expect(await sub(tenantId)).toMatchObject({ planId: "pro", billingInterval: "month", cancelAtPeriodEnd: true });
    expect(await auditCount(tenantId, "billing.subscription_updated")).toBe(1);

    // Events about an older, replaced subscription are ignored.
    const stale = await deliver("customer.subscription.deleted", stripeSub("sub_OLD", tenantId, "price_starter_m", { status: "canceled" }));
    expect((await webhookRow(stale.eventId)).status).toBe("ignored");
    expect((await sub(tenantId)).planId).toBe("pro");

    // Unhandled event types are stored but ignored.
    const other = await deliver("customer.created", { id: "cus_F", object: "customer" });
    expect((await webhookRow(other.eventId)).status).toBe("ignored");

    await deliver("customer.subscription.deleted", stripeSub("sub_F", tenantId, "price_pro_m", { customer: "cus_F", status: "canceled" }));
    expect(await sub(tenantId)).toMatchObject({ planId: "free", status: "active", providerSubscriptionId: null, cancelAtPeriodEnd: false });
    expect(await auditCount(tenantId, "billing.subscription_ended")).toBe(1);
  });
});

describe("lifecycle jobs", () => {
  it("expires an ended trial exactly once, even when runs overlap", async () => {
    const T = await createTeam("Trial Expiry Co");
    await db().update(schema.subscriptions).set({ trialEndsAt: new Date(Date.now() - 3600_000) }).where(eq(schema.subscriptions.tenantId, T.tenant.id));
    const now = new Date();
    await Promise.all([expireTrials(now), expireTrials(now)]);
    await expireTrials(now);
    expect(await sub(T.tenant.id)).toMatchObject({ planId: "free", status: "active", providerSubscriptionId: null });
    expect(await auditCount(T.tenant.id, "billing.trial_expired")).toBe(1);
    const notes = await db().select().from(schema.notifications).where(and(eq(schema.notifications.tenantId, T.tenant.id), eq(schema.notifications.type, "billing")));
    expect(notes).toHaveLength(1);
  });

  it("leaves active trials alone", async () => {
    const T = await createTeam("Trial Active Co");
    await expireTrials(new Date());
    expect(await sub(T.tenant.id)).toMatchObject({ planId: "pro", status: "trialing" });
  });

  it("cancels past-due subscriptions only after the 14-day grace period", async () => {
    const lapsed = await createTeam("Lapsed Co");
    const grace = await createTeam("Grace Co");
    const day = 86400_000;
    await db().update(schema.subscriptions).set({ planId: "pro", status: "past_due", pastDueSince: new Date(Date.now() - 15 * day) }).where(eq(schema.subscriptions.tenantId, lapsed.tenant.id));
    await db().update(schema.subscriptions).set({ planId: "pro", status: "past_due", pastDueSince: new Date(Date.now() - 13 * day) }).where(eq(schema.subscriptions.tenantId, grace.tenant.id));
    await cancelLapsedPastDue(new Date());
    await cancelLapsedPastDue(new Date());
    expect((await sub(lapsed.tenant.id)).status).toBe("canceled");
    expect((await sub(grace.tenant.id)).status).toBe("past_due");
    expect(await auditCount(lapsed.tenant.id, "billing.past_due_canceled")).toBe(1);
    // Lapsed tenants keep core features (and their data) but lose paid ones.
    const ent = await getEntitlements(db(), lapsed.tenant.id);
    expect([...ent.features].sort()).toEqual(["crm", "documents", "tasks"]);
    expect((await getEntitlements(db(), grace.tenant.id)).features.has("whatsapp")).toBe(true);
  });
});

describe("seat billing sync", () => {
  it("coalesces membership changes into one job and syncs the seat count idempotently", async () => {
    const T = await createTeam("Seats Co");
    const tenantId = T.tenant.id;
    await db().execute(sql`delete from public.jobs where type = 'billing.sync_seats' and tenant_id = ${tenantId}`);
    const t0 = Date.UTC(2026, 9, 19, 12, 0, 5);
    await queueSeatSync(db(), tenantId, t0);
    await queueSeatSync(db(), tenantId, t0 + 10_000);
    await queueSeatSync(db(), tenantId, t0 + 40_000); // next 30-second window
    const jobs = await db().select().from(schema.jobs).where(and(eq(schema.jobs.type, "billing.sync_seats"), eq(schema.jobs.tenantId, tenantId)));
    expect(jobs).toHaveLength(2);
    expect(jobs.every((j) => j.runAt.getTime() > t0)).toBe(true);

    expect(await syncSeatsNow(tenantId)).toEqual({ seats: 3, changed: true });
    expect(await syncSeatsNow(tenantId)).toEqual({ seats: 3, changed: false });
    expect((await sub(tenantId)).seats).toBe(3);
    expect(await auditCount(tenantId, "billing.seats_synced")).toBe(1);
  });

  it("member removal queues a sync that the worker applies", async () => {
    const T = await createTeam("Seats Worker Co");
    const tenantId = T.tenant.id;
    await syncSeatsNow(tenantId);
    await removeMember(T.ownerCtx, T.agent.id);
    const [job] = await db().select().from(schema.jobs).where(and(eq(schema.jobs.type, "billing.sync_seats"), eq(schema.jobs.tenantId, tenantId), eq(schema.jobs.status, "queued")));
    expect(job).toBeDefined();
    await db().update(schema.jobs).set({ runAt: new Date() }).where(eq(schema.jobs.id, job.id));
    await drainJobs({ workerId: "billing-test", types: ["billing.sync_seats"] });
    expect((await sub(tenantId)).seats).toBe(2);
  });
});

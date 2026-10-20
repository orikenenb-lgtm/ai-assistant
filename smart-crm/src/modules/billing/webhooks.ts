import { eq, sql } from "drizzle-orm";
import { db, schema, withSystemTx, type Tx } from "@/server/db";
import { enqueueJob } from "@/server/jobs/queue";
import { PermanentJobError, type Job } from "@/server/jobs/runner";
import { logger } from "@/server/logger";
import { addInterval, planForPriceId, type BillingInterval } from "./plans";
import { billingProvider, stripeSubscriptionState, type BillingProvider, type BillingWebhookEvent } from "./providers";
import { applyProviderState, type SubscriptionRow } from "./service";
import { notifyOwners } from "./notify";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type IngestResult = { status: "accepted" | "duplicate"; webhookEventId: string | null };

/**
 * Verifies, persists and queues a provider webhook. Persisting before
 * acknowledging means nothing is lost; the unique (provider, event_key) row
 * makes Stripe's retries no-ops.
 */
export async function ingestBillingWebhook(rawBody: string, signatureHeader: string | null, provider: BillingProvider = billingProvider()): Promise<IngestResult> {
  const event = provider.parseWebhook(rawBody, signatureHeader); // throws on bad signature
  return withSystemTx(async (tx) => {
    const tenantHint = tenantIdHint(event);
    const [row] = await tx
      .insert(schema.webhookEvents)
      .values({
        provider: "billing",
        eventKey: event.id,
        tenantId: tenantHint && (await tenantExists(tx, tenantHint)) ? tenantHint : null,
        signatureValid: true,
        payload: { id: event.id, type: event.type, created: event.createdAt.toISOString(), object: event.object },
      })
      .onConflictDoNothing({ target: [schema.webhookEvents.provider, schema.webhookEvents.eventKey] })
      .returning({ id: schema.webhookEvents.id });
    if (!row) return { status: "duplicate" as const, webhookEventId: null };
    await enqueueJob(tx, {
      tenantId: null,
      type: "billing.process_webhook",
      payload: { webhookEventId: row.id },
      idempotencyKey: `billing-webhook:${row.id}`,
      priority: 5,
    });
    return { status: "accepted" as const, webhookEventId: row.id };
  });
}

function tenantIdHint(event: BillingWebhookEvent): string | null {
  const o = event.object;
  const metadata = (o.metadata as Record<string, unknown> | undefined) ?? {};
  const candidate = (o.client_reference_id as string | undefined) ?? (metadata.tenantId as string | undefined);
  return typeof candidate === "string" && UUID.test(candidate) ? candidate : null;
}

async function tenantExists(tx: Tx, id: string) {
  const [t] = await tx.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.id, id));
  return Boolean(t);
}

/** Finds the subscription an event belongs to (metadata → subscription id → customer id). */
async function findSubscription(tx: Tx, event: BillingWebhookEvent): Promise<SubscriptionRow | undefined> {
  const o = event.object;
  const hint = tenantIdHint(event);
  if (hint) {
    const [s] = await tx.select().from(schema.subscriptions).where(eq(schema.subscriptions.tenantId, hint)).for("update");
    if (s) return s;
  }
  const subId = event.type.startsWith("customer.subscription.") ? (o.id as string) : (o.subscription as string | undefined);
  if (typeof subId === "string" && subId) {
    const [s] = await tx.select().from(schema.subscriptions).where(eq(schema.subscriptions.providerSubscriptionId, subId)).for("update");
    if (s) return s;
  }
  const customer = typeof o.customer === "string" ? o.customer : undefined;
  if (customer) {
    const [s] = await tx
      .select()
      .from(schema.subscriptions)
      .where(sql`${schema.subscriptions.provider} = 'stripe' and ${schema.subscriptions.providerCustomerId} = ${customer}`)
      .for("update");
    if (s) return s;
  }
  return undefined;
}

async function auditBilling(tx: Tx, tenantId: string, action: string, entityId: string, metadata: Record<string, unknown>) {
  await tx.insert(schema.auditLogs).values({ tenantId, actorUserId: null, actorType: "webhook", action, entityType: "subscription", entityId, metadata });
}

/**
 * Applies one Stripe event. Every update writes absolute state, so replaying an
 * event is harmless; the webhook_events status prevents double side effects.
 * Returns false for events this app ignores.
 */
export async function applyStripeEvent(tx: Tx, event: BillingWebhookEvent): Promise<boolean> {
  const o = event.object;
  const handled = [
    "checkout.session.completed",
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "invoice.paid",
    "invoice.payment_failed",
  ];
  if (!handled.includes(event.type)) return false;
  const sub = await findSubscription(tx, event);
  if (!sub) {
    logger().warn({ eventId: event.id, type: event.type }, "billing webhook for unknown subscription");
    return false;
  }
  // Events about an older Stripe subscription (e.g. one replaced by a new checkout) must not touch the current one.
  const eventSubId = event.type.startsWith("customer.subscription.") ? o.id : event.type.startsWith("invoice.") ? o.subscription : null;
  if (typeof eventSubId === "string" && sub.provider === "stripe" && sub.providerSubscriptionId && sub.providerSubscriptionId !== eventSubId) {
    logger().warn({ eventId: event.id, type: event.type }, "billing webhook for a superseded subscription");
    return false;
  }
  const plans = await tx.select({ id: schema.plans.id, providerPriceIds: schema.plans.providerPriceIds }).from(schema.plans);

  switch (event.type) {
    case "checkout.session.completed": {
      if (o.mode !== "subscription") return false;
      const metadata = (o.metadata as Record<string, unknown> | undefined) ?? {};
      const planId = typeof metadata.planId === "string" && plans.some((p) => p.id === metadata.planId) ? metadata.planId : sub.planId;
      const interval: BillingInterval = metadata.interval === "year" ? "year" : "month";
      await tx
        .update(schema.subscriptions)
        .set({
          provider: "stripe",
          providerCustomerId: typeof o.customer === "string" ? o.customer : sub.providerCustomerId,
          providerSubscriptionId: typeof o.subscription === "string" ? o.subscription : sub.providerSubscriptionId,
          planId,
          billingInterval: interval,
          status: "active",
          trialEndsAt: null,
          cancelAtPeriodEnd: false,
          canceledAt: null,
          pastDueSince: null,
        })
        .where(eq(schema.subscriptions.id, sub.id));
      await auditBilling(tx, sub.tenantId, "billing.checkout_completed", sub.id, { planId, interval, eventId: event.id });
      return true;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const state = stripeSubscriptionState(o);
      if (state.status === "canceled") return endSubscription(tx, sub, event);
      const mapped = state.priceId ? planForPriceId(plans, "stripe", state.priceId) : null;
      const updated = await applyProviderState(tx, sub, state, mapped);
      const changed = updated.status !== sub.status || updated.planId !== sub.planId || updated.cancelAtPeriodEnd !== sub.cancelAtPeriodEnd;
      if (changed) {
        await auditBilling(tx, sub.tenantId, "billing.subscription_updated", sub.id, {
          eventId: event.id,
          status: updated.status,
          planId: updated.planId,
          cancelAtPeriodEnd: updated.cancelAtPeriodEnd,
        });
      }
      return true;
    }
    case "customer.subscription.deleted":
      return endSubscription(tx, sub, event);
    case "invoice.paid": {
      if (sub.status === "past_due") {
        await tx.update(schema.subscriptions).set({ status: "active", pastDueSince: null }).where(eq(schema.subscriptions.id, sub.id));
      }
      await auditBilling(tx, sub.tenantId, "billing.invoice_paid", sub.id, {
        eventId: event.id,
        invoiceId: o.id,
        amount: o.amount_paid ?? null,
        currency: o.currency ?? null,
      });
      return true;
    }
    case "invoice.payment_failed": {
      await tx
        .update(schema.subscriptions)
        .set({ status: "past_due", pastDueSince: sub.pastDueSince ?? new Date() })
        .where(eq(schema.subscriptions.id, sub.id));
      await auditBilling(tx, sub.tenantId, "billing.payment_failed", sub.id, { eventId: event.id, invoiceId: o.id, attempt: o.attempt_count ?? null });
      await notifyOwners(
        tx,
        sub.tenantId,
        {
          title: { he: "התשלום על המנוי נכשל", en: "Subscription payment failed" },
          body: {
            he: "לא הצלחנו לחייב את אמצעי התשלום. עדכנו אותו תוך 14 יום כדי לשמור על התכונות בתשלום.",
            en: "We couldn't charge your payment method. Update it within 14 days to keep paid features.",
          },
        },
        { email: true },
      );
      return true;
    }
  }
  return false;
}

async function endSubscription(tx: Tx, sub: SubscriptionRow, event: BillingWebhookEvent): Promise<boolean> {
  const now = new Date();
  await tx
    .update(schema.subscriptions)
    .set({
      planId: "free",
      status: "active",
      billingInterval: "month",
      providerSubscriptionId: null,
      cancelAtPeriodEnd: false,
      canceledAt: now,
      currentPeriodStart: now,
      currentPeriodEnd: addInterval(now, "month"),
      pastDueSince: null,
    })
    .where(eq(schema.subscriptions.id, sub.id));
  await auditBilling(tx, sub.tenantId, "billing.subscription_ended", sub.id, { eventId: event.id, previousPlan: sub.planId });
  await notifyOwners(tx, sub.tenantId, {
    title: { he: "המנוי הסתיים — עברתם לתוכנית החינמית", en: "Subscription ended — you're on the Free plan" },
    body: { he: "הנתונים שלכם נשמרו. אפשר לחדש מנוי בכל עת.", en: "Your data is kept. You can subscribe again at any time." },
  });
  return true;
}

/** Job: process one stored webhook event exactly once. */
export async function processBillingWebhookJob(job: Job) {
  const id = job.payload.webhookEventId;
  if (typeof id !== "string") throw new PermanentJobError("missing webhookEventId");
  await withSystemTx(async (tx) => {
    const [row] = await tx.select().from(schema.webhookEvents).where(eq(schema.webhookEvents.id, id)).for("update");
    if (!row) throw new PermanentJobError("webhook event not found");
    if (row.status === "processed" || row.status === "ignored") return;
    const p = row.payload as { id: string; type: string; created: string; object: Record<string, unknown> };
    const event: BillingWebhookEvent = { id: p.id, type: p.type, object: p.object, createdAt: new Date(p.created) };
    const handled = await applyStripeEvent(tx, event);
    await tx
      .update(schema.webhookEvents)
      .set({ status: handled ? "processed" : "ignored", processedAt: new Date(), attempts: row.attempts + 1, error: null })
      .where(eq(schema.webhookEvents.id, id));
  }).catch(async (e) => {
    await db()
      .update(schema.webhookEvents)
      .set({ status: "failed", attempts: sql`${schema.webhookEvents.attempts} + 1`, error: e instanceof Error ? e.message.slice(0, 1000) : String(e) })
      .where(eq(schema.webhookEvents.id, id));
    throw e;
  });
}

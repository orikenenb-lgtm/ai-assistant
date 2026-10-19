import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import { db, schema, withSystemTx } from "@/server/db";
import { addInterval, type BillingInterval } from "./plans";
import { notifyOwners } from "./notify";

/** Days a past_due subscription keeps paid features before it is canceled. */
export const PAST_DUE_GRACE_DAYS = 14;

async function auditSystem(tx: Parameters<Parameters<typeof withSystemTx>[0]>[0], tenantId: string, action: string, entityId: string, metadata: Record<string, unknown>) {
  await tx.insert(schema.auditLogs).values({ tenantId, actorUserId: null, actorType: "system", action, entityType: "subscription", entityId, metadata });
}

/** Trials that ended without a paid subscription move to the Free plan — exactly once. */
export async function expireTrials(now = new Date()): Promise<number> {
  const candidates = await db()
    .select({ id: schema.subscriptions.id })
    .from(schema.subscriptions)
    .where(
      and(
        eq(schema.subscriptions.status, "trialing"),
        lte(schema.subscriptions.trialEndsAt, now),
        or(isNull(schema.subscriptions.providerSubscriptionId), eq(schema.subscriptions.provider, "mock")),
      ),
    );
  let expired = 0;
  for (const { id } of candidates) {
    const done = await withSystemTx(async (tx) => {
      // The status guard makes concurrent runs safe: only one UPDATE matches.
      const [sub] = await tx
        .update(schema.subscriptions)
        .set({
          planId: "free",
          status: "active",
          billingInterval: "month",
          currentPeriodStart: now,
          currentPeriodEnd: addInterval(now, "month"),
          cancelAtPeriodEnd: false,
          providerSubscriptionId: null,
        })
        .where(and(eq(schema.subscriptions.id, id), eq(schema.subscriptions.status, "trialing")))
        .returning();
      if (!sub) return false;
      await auditSystem(tx, sub.tenantId, "billing.trial_expired", sub.id, { downgradedTo: "free" });
      await notifyOwners(
        tx,
        sub.tenantId,
        {
          title: { he: "תקופת הניסיון הסתיימה", en: "Your trial has ended" },
          body: {
            he: "הארגון עבר לתוכנית החינמית. כל הנתונים נשמרו — בחרו תוכנית כדי להמשיך עם כל התכונות.",
            en: "Your organization moved to the Free plan. All data is kept — choose a plan to keep every feature.",
          },
        },
        { email: true },
      );
      return true;
    });
    if (done) expired++;
  }
  return expired;
}

/** Past-due subscriptions beyond the grace period lose paid features (status canceled). */
export async function cancelLapsedPastDue(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - PAST_DUE_GRACE_DAYS * 86400_000);
  const rows = await db()
    .select({ id: schema.subscriptions.id })
    .from(schema.subscriptions)
    .where(and(eq(schema.subscriptions.status, "past_due"), lte(schema.subscriptions.pastDueSince, cutoff)));
  let canceled = 0;
  for (const { id } of rows) {
    const done = await withSystemTx(async (tx) => {
      const [sub] = await tx
        .update(schema.subscriptions)
        .set({ status: "canceled", canceledAt: now })
        .where(and(eq(schema.subscriptions.id, id), eq(schema.subscriptions.status, "past_due")))
        .returning();
      if (!sub) return false;
      await auditSystem(tx, sub.tenantId, "billing.past_due_canceled", sub.id, { graceDays: PAST_DUE_GRACE_DAYS });
      await notifyOwners(
        tx,
        sub.tenantId,
        {
          title: { he: "המנוי בוטל בשל תשלום שלא הוסדר", en: "Subscription canceled for non-payment" },
          body: {
            he: "התכונות בתשלום הושבתו. הנתונים נשמרו — חדשו מנוי כדי להפעיל אותן מחדש.",
            en: "Paid features are now disabled. Your data is kept — subscribe again to re-enable them.",
          },
        },
        { email: true },
      );
      return true;
    });
    if (done) canceled++;
  }
  return canceled;
}

/**
 * Mock provider only (no money involved): ends subscriptions scheduled to
 * cancel and rolls active periods forward, mimicking what Stripe does.
 */
export async function rollMockPeriods(now = new Date()): Promise<number> {
  const due = await db()
    .select()
    .from(schema.subscriptions)
    .where(and(eq(schema.subscriptions.provider, "mock"), eq(schema.subscriptions.status, "active"), lte(schema.subscriptions.currentPeriodEnd, now)));
  let changed = 0;
  for (const sub of due) {
    await withSystemTx(async (tx) => {
      if (sub.cancelAtPeriodEnd) {
        const [row] = await tx
          .update(schema.subscriptions)
          .set({
            planId: "free",
            billingInterval: "month",
            cancelAtPeriodEnd: false,
            canceledAt: now,
            providerSubscriptionId: null,
            currentPeriodStart: now,
            currentPeriodEnd: addInterval(now, "month"),
          })
          .where(and(eq(schema.subscriptions.id, sub.id), eq(schema.subscriptions.cancelAtPeriodEnd, true)))
          .returning();
        if (row) await auditSystem(tx, sub.tenantId, "billing.subscription_ended", sub.id, { previousPlan: sub.planId, provider: "mock" });
      } else {
        let end = sub.currentPeriodEnd ?? now;
        let start = sub.currentPeriodStart ?? now;
        while (end <= now) {
          start = end;
          end = addInterval(end, sub.billingInterval as BillingInterval);
        }
        await tx
          .update(schema.subscriptions)
          .set({ currentPeriodStart: start, currentPeriodEnd: end })
          .where(and(eq(schema.subscriptions.id, sub.id), sql`${schema.subscriptions.currentPeriodEnd} <= ${now.toISOString()}::timestamptz`));
      }
    });
    changed++;
  }
  return changed;
}

export async function runBillingLifecycle(now = new Date()) {
  return {
    trialsExpired: await expireTrials(now),
    pastDueCanceled: await cancelLapsedPastDue(now),
    mockPeriodsRolled: await rollMockPeriods(now),
  };
}

import { asc, eq } from "drizzle-orm";
import { schema, type Executor } from "@/server/db";
import type { Feature, LimitKey } from "./entitlements";

export type BillingInterval = "month" | "year";
export const BILLING_INTERVALS: BillingInterval[] = ["month", "year"];

export type PlanRow = typeof schema.plans.$inferSelect;

export type PlanView = {
  id: string;
  name: { he: string; en: string };
  description: { he: string; en: string };
  priceMonthlyCents: number;
  priceYearlyCents: number;
  currency: string;
  trialDays: number;
  seatLimit: number | null;
  limits: Partial<Record<LimitKey, number>>;
  features: Feature[];
  isPublic: boolean;
  active: boolean;
  sort: number;
};

export function toPlanView(p: PlanRow): PlanView {
  return {
    id: p.id,
    name: { he: p.nameHe, en: p.nameEn },
    description: { he: p.descriptionHe, en: p.descriptionEn },
    priceMonthlyCents: p.priceMonthlyCents,
    priceYearlyCents: p.priceYearlyCents,
    currency: p.currency,
    trialDays: p.trialDays,
    seatLimit: p.seatLimit,
    limits: p.limits as PlanView["limits"],
    features: p.features as Feature[],
    isPublic: p.isPublic,
    active: p.active,
    sort: p.sort,
  };
}

export async function listPlans(tx: Executor, opts: { includeInactive?: boolean } = {}): Promise<PlanView[]> {
  const rows = await tx.select().from(schema.plans).orderBy(asc(schema.plans.sort), asc(schema.plans.id));
  return rows.filter((p) => opts.includeInactive || p.active).map(toPlanView);
}

export async function getPlan(tx: Executor, planId: string): Promise<PlanRow | undefined> {
  const [p] = await tx.select().from(schema.plans).where(eq(schema.plans.id, planId)).limit(1);
  return p;
}

/** Price per seat for the interval, in minor units (agorot). */
export function planPriceCents(p: Pick<PlanView, "priceMonthlyCents" | "priceYearlyCents">, interval: BillingInterval): number {
  return interval === "year" ? p.priceYearlyCents : p.priceMonthlyCents;
}

/** Monthly-equivalent recurring revenue of one subscription. */
export function monthlyRecurringCents(p: Pick<PlanView, "priceMonthlyCents" | "priceYearlyCents">, interval: BillingInterval, seats: number): number {
  const perSeat = interval === "year" ? p.priceYearlyCents / 12 : p.priceMonthlyCents;
  return Math.round(perSeat * Math.max(1, seats));
}

export const isPaidPlan = (p: Pick<PlanView, "priceMonthlyCents" | "priceYearlyCents">) => p.priceMonthlyCents > 0 || p.priceYearlyCents > 0;

/**
 * plans.provider_price_ids shape: { "stripe": { "month": "price_…", "year": "price_…" } }.
 * Returns null when the plan has no price configured for that interval.
 */
export function providerPriceId(plan: Pick<PlanRow, "providerPriceIds">, provider: "stripe", interval: BillingInterval): string | null {
  const ids = plan.providerPriceIds as Record<string, Record<string, unknown>> | null;
  const value = ids?.[provider]?.[interval];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Reverse lookup: which plan/interval a provider price id belongs to. */
export function planForPriceId(
  plans: Pick<PlanRow, "id" | "providerPriceIds">[],
  provider: "stripe",
  priceId: string,
): { planId: string; interval: BillingInterval } | null {
  for (const p of plans) {
    for (const interval of BILLING_INTERVALS) {
      if (providerPriceId(p, provider, interval) === priceId) return { planId: p.id, interval };
    }
  }
  return null;
}

/** Adds one billing interval to a date (calendar months, clamped to month end). */
export function addInterval(from: Date, interval: BillingInterval, count = 1): Date {
  const d = new Date(from);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + (interval === "year" ? 12 * count : count));
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

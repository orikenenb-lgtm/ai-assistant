import { plans as defaultPlans, pricing, type Plan } from "@/config/site";

/**
 * Talk minutes a full-time phone employee actually spends on calls in a month.
 * Most of a shift goes to dialing, waiting, logging and breaks; ~2,750 minutes
 * (~46 hours) of real talk time is a common planning figure for call centers.
 */
export const HUMAN_TALK_MINUTES_PER_MONTH = 2750;

export type RoiInput = {
  callsPerMonth: number;
  avgCallMinutes: number;
  /** Fully loaded monthly employer cost of one phone employee, ILS. */
  employeeMonthlyCost: number;
  /** Share of calls that go unanswered today, 0–1. */
  missedRate: number;
  /** Average revenue from a new customer, ILS. */
  avgCustomerValue: number;
  /** Share of missed callers that would have become customers, 0–1. */
  missedConversionRate: number;
};

export type PlanQuote = {
  plan: Plan;
  extraMinutes: number;
  cost: number;
};

/** Cheapest way to cover `minutes`: a plan plus per-minute overage when needed. */
export function quoteForMinutes(minutes: number, plans: Plan[] = defaultPlans): PlanQuote {
  const needed = Math.max(0, Math.ceil(minutes));
  let best: PlanQuote | undefined;
  for (const plan of plans) {
    const extraMinutes = Math.max(0, needed - plan.minutes);
    const cost = plan.price + extraMinutes * pricing.extraMinutePrice;
    if (!best || cost < best.cost || (cost === best.cost && plan.minutes > best.plan.minutes)) {
      best = { plan, extraMinutes, cost };
    }
  }
  if (!best) throw new Error("No plans configured");
  return best;
}

export type RoiResult = {
  totalMinutes: number;
  talkHours: number;
  employeesNeeded: number;
  humanCost: number;
  quote: PlanQuote;
  agentCost: number;
  monthlySavings: number;
  yearlySavings: number;
  missedCalls: number;
  recoveredCustomers: number;
  recoveredRevenue: number;
};

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

export function computeRoi(raw: RoiInput, plans: Plan[] = defaultPlans): RoiResult {
  const calls = clamp(Math.round(raw.callsPerMonth), 0, 1_000_000);
  const avg = clamp(raw.avgCallMinutes, 0.5, 60);
  const employeeCost = clamp(raw.employeeMonthlyCost, 0, 1_000_000);
  const missedRate = clamp(raw.missedRate, 0, 1);
  const customerValue = clamp(raw.avgCustomerValue, 0, 10_000_000);
  const conversion = clamp(raw.missedConversionRate, 0, 1);

  const totalMinutes = Math.round(calls * avg);
  const employeesNeeded = calls === 0 ? 0 : Math.max(1, Math.ceil(totalMinutes / HUMAN_TALK_MINUTES_PER_MONTH));
  const humanCost = employeesNeeded * employeeCost;
  const quote = quoteForMinutes(totalMinutes, plans);
  const agentCost = calls === 0 ? 0 : quote.cost;
  const monthlySavings = humanCost - agentCost;
  const missedCalls = Math.round(calls * missedRate);
  const recoveredCustomers = Math.round(missedCalls * conversion * 10) / 10;
  const recoveredRevenue = Math.round(missedCalls * conversion * customerValue);

  return {
    totalMinutes,
    talkHours: Math.round((totalMinutes / 60) * 10) / 10,
    employeesNeeded,
    humanCost,
    quote,
    agentCost,
    monthlySavings,
    yearlySavings: monthlySavings * 12,
    missedCalls,
    recoveredCustomers,
    recoveredRevenue,
  };
}

import { describe, expect, it } from "vitest";
import { plans, pricing } from "@/config/site";
import { HUMAN_TALK_MINUTES_PER_MONTH, computeRoi, quoteForMinutes } from "@/lib/roi";

const base = {
  callsPerMonth: 300,
  avgCallMinutes: 3,
  employeeMonthlyCost: 12500,
  missedRate: 0.2,
  avgCustomerValue: 800,
  missedConversionRate: 0.25,
};

describe("quoteForMinutes", () => {
  it("picks the cheapest plan that covers small volumes", () => {
    const q = quoteForMinutes(50);
    expect(q.plan.id).toBe("start");
    expect(q.extraMinutes).toBe(0);
    expect(q.cost).toBe(plans[0].price);
  });

  it("adds overage when that is cheaper than upgrading", () => {
    const start = plans.find((p) => p.id === "start")!;
    const q = quoteForMinutes(start.minutes + 10);
    expect(q.plan.id).toBe("start");
    expect(q.extraMinutes).toBe(10);
    expect(q.cost).toBeCloseTo(start.price + 10 * pricing.extraMinutePrice);
  });

  it("is never more expensive than any single plan option", () => {
    for (const minutes of [0, 1, 99, 120, 121, 300, 450, 600, 900, 2000, 10000]) {
      const q = quoteForMinutes(minutes);
      for (const p of plans) {
        const alt = p.price + Math.max(0, minutes - p.minutes) * pricing.extraMinutePrice;
        expect(q.cost).toBeLessThanOrEqual(alt + 1e-9);
      }
    }
  });
});

describe("computeRoi", () => {
  it("computes the default scenario shown on the page", () => {
    const r = computeRoi(base);
    expect(r.totalMinutes).toBe(900);
    expect(r.talkHours).toBe(15);
    expect(r.employeesNeeded).toBe(1);
    expect(r.humanCost).toBe(12500);
    expect(r.agentCost).toBe(r.quote.cost);
    expect(r.monthlySavings).toBe(12500 - r.agentCost);
    expect(r.yearlySavings).toBe(r.monthlySavings * 12);
    expect(r.missedCalls).toBe(60);
    expect(r.recoveredRevenue).toBe(60 * 0.25 * 800);
  });

  it("needs more employees when talk time exceeds one person's capacity", () => {
    const calls = Math.ceil((HUMAN_TALK_MINUTES_PER_MONTH * 2.5) / 3);
    const r = computeRoi({ ...base, callsPerMonth: calls });
    expect(r.employeesNeeded).toBe(3);
    expect(r.humanCost).toBe(3 * base.employeeMonthlyCost);
  });

  it("clamps nonsense input instead of returning NaN", () => {
    const r = computeRoi({ ...base, callsPerMonth: Number.NaN, missedRate: 5, avgCallMinutes: -1 });
    expect(Number.isFinite(r.monthlySavings)).toBe(true);
    expect(r.missedCalls).toBe(0);
  });

  it("reports negative savings honestly when the agent costs more", () => {
    const r = computeRoi({ ...base, callsPerMonth: 2000, employeeMonthlyCost: 1000 });
    expect(r.monthlySavings).toBeLessThan(0);
  });
});

import { describe, expect, it } from "vitest";
import { addInterval, isPaidPlan, monthlyRecurringCents, planForPriceId, planPriceCents, providerPriceId } from "@/modules/billing/plans";
import { MockBillingProvider } from "@/modules/billing/providers";

const plans = [
  { id: "free", providerPriceIds: {} },
  { id: "starter", providerPriceIds: { stripe: { month: "price_starter_m", year: " price_starter_y " } } },
  { id: "pro", providerPriceIds: { stripe: { month: "price_pro_m" } } },
  { id: "broken", providerPriceIds: { stripe: { month: 42, year: "" } } },
  { id: "nullish", providerPriceIds: null },
];

describe("plan price mapping", () => {
  it("maps plan + interval to the configured Stripe price", () => {
    expect(providerPriceId(plans[1], "stripe", "month")).toBe("price_starter_m");
    expect(providerPriceId(plans[1], "stripe", "year")).toBe("price_starter_y");
    expect(providerPriceId(plans[2], "stripe", "year")).toBeNull();
    expect(providerPriceId(plans[0], "stripe", "month")).toBeNull();
    expect(providerPriceId(plans[3], "stripe", "month")).toBeNull();
    expect(providerPriceId(plans[3], "stripe", "year")).toBeNull();
    expect(providerPriceId(plans[4], "stripe", "month")).toBeNull();
  });

  it("maps a Stripe price back to its plan and interval", () => {
    expect(planForPriceId(plans, "stripe", "price_pro_m")).toEqual({ planId: "pro", interval: "month" });
    expect(planForPriceId(plans, "stripe", "price_starter_y")).toEqual({ planId: "starter", interval: "year" });
    expect(planForPriceId(plans, "stripe", "price_unknown")).toBeNull();
  });

  it("computes per-seat prices and monthly recurring revenue", () => {
    const pro = { priceMonthlyCents: 14900, priceYearlyCents: 149000 };
    expect(planPriceCents(pro, "month")).toBe(14900);
    expect(planPriceCents(pro, "year")).toBe(149000);
    expect(monthlyRecurringCents(pro, "month", 3)).toBe(44700);
    expect(monthlyRecurringCents(pro, "year", 3)).toBe(Math.round((149000 / 12) * 3));
    expect(monthlyRecurringCents(pro, "month", 0)).toBe(14900);
    expect(isPaidPlan(pro)).toBe(true);
    expect(isPaidPlan({ priceMonthlyCents: 0, priceYearlyCents: 0 })).toBe(false);
  });

  it("adds calendar billing intervals, clamped to month end", () => {
    expect(addInterval(new Date("2026-01-31T10:00:00Z"), "month").toISOString()).toBe("2026-02-28T10:00:00.000Z");
    expect(addInterval(new Date("2028-01-31T10:00:00Z"), "month").toISOString()).toBe("2028-02-29T10:00:00.000Z");
    expect(addInterval(new Date("2026-03-15T00:00:00Z"), "year").toISOString()).toBe("2027-03-15T00:00:00.000Z");
    expect(addInterval(new Date("2026-03-31T00:00:00Z"), "month", -1).toISOString()).toBe("2026-02-28T00:00:00.000Z");
    expect(addInterval(new Date("2026-12-10T00:00:00Z"), "month").toISOString()).toBe("2027-01-10T00:00:00.000Z");
  });
});

describe("mock billing provider", () => {
  it("never redirects to a payment page and labels invoices as samples", async () => {
    const p = new MockBillingProvider();
    expect(await p.createCheckout()).toEqual({ type: "applied" });
    expect((await p.createPortal()).url).toBe("/settings/billing/portal");
    const invoices = await p.listInvoices({ amountCents: 10000, currency: "ILS", interval: "month", periodStart: new Date("2026-10-01T00:00:00Z") });
    expect(invoices).toHaveLength(3);
    expect(invoices.every((i) => i.sample && i.number?.startsWith("DEMO-"))).toBe(true);
    expect(invoices[1].periodStart?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(await p.listInvoices({ amountCents: 0, currency: "ILS", interval: "month", periodStart: null })).toEqual([]);
    expect(() => p.parseWebhook()).toThrow();
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  STRIPE_SIGNATURE_TOLERANCE_SECONDS,
  StripeSignatureError,
  computeStripeSignature,
  parseSignatureHeader,
  signStripePayload,
  verifyStripeSignature,
} from "@/modules/billing/stripe-signature";
import { BillingProviderError, LiveModeDisabledError, STRIPE_API_VERSION, StripeBillingProvider, formEncode, stripeSubscriptionState } from "@/modules/billing/providers";

const SECRET = "whsec_test_secret";
const payload = JSON.stringify({ id: "evt_1", type: "invoice.paid", data: { object: { id: "in_1" } } });
const now = 1_760_000_000;

describe("Stripe webhook signature verification", () => {
  it("accepts a valid signature", () => {
    const header = signStripePayload(payload, SECRET, now);
    expect(() => verifyStripeSignature(payload, header, SECRET, { nowSeconds: now + 10 })).not.toThrow();
  });

  it("matches Stripe's documented scheme: HMAC-SHA256 of '<t>.<payload>'", async () => {
    const { createHmac } = await import("node:crypto");
    const expected = createHmac("sha256", SECRET).update(`${now}.${payload}`).digest("hex");
    expect(computeStripeSignature(payload, now, SECRET)).toBe(expected);
  });

  it("rejects a tampered payload", () => {
    const header = signStripePayload(payload, SECRET, now);
    const tampered = payload.replace("in_1", "in_2");
    expect(() => verifyStripeSignature(tampered, header, SECRET, { nowSeconds: now })).toThrow(/mismatch/);
  });

  it("rejects a signature made with another secret", () => {
    const header = signStripePayload(payload, "whsec_other", now);
    expect(() => verifyStripeSignature(payload, header, SECRET, { nowSeconds: now })).toThrow(StripeSignatureError);
  });

  it("rejects timestamps outside the 5-minute tolerance (replay protection)", () => {
    expect(STRIPE_SIGNATURE_TOLERANCE_SECONDS).toBe(300);
    const header = signStripePayload(payload, SECRET, now);
    expect(() => verifyStripeSignature(payload, header, SECRET, { nowSeconds: now + 301 })).toThrow(/tolerance/);
    expect(() => verifyStripeSignature(payload, header, SECRET, { nowSeconds: now - 301 })).toThrow(/tolerance/);
    expect(() => verifyStripeSignature(payload, header, SECRET, { nowSeconds: now + 299 })).not.toThrow();
  });

  it("accepts any of multiple v1 signatures (secret rotation) and ignores v0", () => {
    const good = computeStripeSignature(payload, now, SECRET);
    const header = `t=${now},v1=${"0".repeat(64)},v0=${"f".repeat(64)},v1=${good}`;
    expect(parseSignatureHeader(header).signatures).toHaveLength(2);
    expect(() => verifyStripeSignature(payload, header, SECRET, { nowSeconds: now })).not.toThrow();
  });

  it("rejects headers with only v0 / no timestamp / nothing", () => {
    const good = computeStripeSignature(payload, now, SECRET);
    expect(() => verifyStripeSignature(payload, `t=${now},v0=${good}`, SECRET, { nowSeconds: now })).toThrow(/no v1/);
    expect(() => verifyStripeSignature(payload, `v1=${good}`, SECRET, { nowSeconds: now })).toThrow(/timestamp/);
    expect(() => verifyStripeSignature(payload, null, SECRET)).toThrow(/missing signature/);
    expect(() => verifyStripeSignature(payload, "t=1,v1=zz", SECRET)).toThrow(StripeSignatureError);
    expect(() => verifyStripeSignature(payload, signStripePayload(payload, SECRET, now), "", { nowSeconds: now })).toThrow(/secret/);
  });

  it("rejects truncated signatures without throwing a length error from timingSafeEqual", () => {
    const good = computeStripeSignature(payload, now, SECRET);
    expect(() => verifyStripeSignature(payload, `t=${now},v1=${good.slice(0, 32)}`, SECRET, { nowSeconds: now })).toThrow(/mismatch/);
  });
});

describe("StripeBillingProvider safety", () => {
  it("refuses live keys unless live mode is explicitly enabled", () => {
    expect(() => new StripeBillingProvider("sk_live_abc", SECRET, { liveMode: false })).toThrow(LiveModeDisabledError);
    expect(() => new StripeBillingProvider("rk_live_abc", SECRET, { liveMode: false })).toThrow(LiveModeDisabledError);
    expect(() => new StripeBillingProvider("sk_test_abc", SECRET, { liveMode: false })).not.toThrow();
    expect(() => new StripeBillingProvider("", SECRET, { liveMode: false })).toThrow(BillingProviderError);
  });

  it("parses a signed event and rejects an unsigned one", () => {
    const p = new StripeBillingProvider("sk_test_abc", SECRET, { liveMode: false });
    const event = p.parseWebhook(payload, signStripePayload(payload, SECRET));
    expect(event).toMatchObject({ id: "evt_1", type: "invoice.paid", object: { id: "in_1" } });
    expect(() => p.parseWebhook(payload, null)).toThrow(StripeSignatureError);
    const bad = JSON.stringify({ id: "evt_2" });
    expect(() => p.parseWebhook(bad, signStripePayload(bad, SECRET))).toThrow(/malformed/);
  });

  it("creates Checkout sessions with form encoding, version pin, idempotency key and tenant metadata", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: "cs_1", url: "https://checkout.stripe.com/c/cs_1" }), { status: 200 }));
    const p = new StripeBillingProvider("sk_test_abc", SECRET, { liveMode: false, fetchImpl: fetchImpl as unknown as typeof fetch });
    const res = await p.createCheckout({
      tenantId: "t-1",
      planId: "pro",
      interval: "month",
      priceId: "price_pro_m",
      seats: 3,
      customerId: null,
      customerEmail: "owner@example.test",
      successUrl: "http://localhost/settings/billing?checkout=success",
      cancelUrl: "http://localhost/settings/billing?checkout=canceled",
    });
    expect(res).toEqual({ type: "redirect", url: "https://checkout.stripe.com/c/cs_1" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.stripe.com/v1/checkout/sessions");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk_test_abc");
    expect(headers["Stripe-Version"]).toBe(STRIPE_API_VERSION);
    expect(headers["Idempotency-Key"]).toMatch(/^checkout:t-1:pro:month:/);
    const body = new URLSearchParams(String(init.body));
    expect(body.get("mode")).toBe("subscription");
    expect(body.get("line_items[0][price]")).toBe("price_pro_m");
    expect(body.get("line_items[0][quantity]")).toBe("3");
    expect(body.get("client_reference_id")).toBe("t-1");
    expect(body.get("metadata[tenantId]")).toBe("t-1");
    expect(body.get("subscription_data[metadata][planId]")).toBe("pro");
    expect(body.get("customer_email")).toBe("owner@example.test");
    expect(body.has("customer")).toBe(false);
  });

  it("surfaces Stripe API errors as BillingProviderError", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { message: "No such price", code: "resource_missing" } }), { status: 400 }));
    const p = new StripeBillingProvider("sk_test_abc", SECRET, { liveMode: false, fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(p.createPortal({ customerId: "cus_1", returnUrl: "http://localhost" })).rejects.toMatchObject({
      name: "BillingProviderError",
      status: 400,
      code: "resource_missing",
    });
  });

  it("refuses to start checkout without a configured price", async () => {
    const fetchImpl = vi.fn();
    const p = new StripeBillingProvider("sk_test_abc", SECRET, { liveMode: false, fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(
      p.createCheckout({ tenantId: "t", planId: "pro", interval: "year", priceId: null, seats: 1, customerId: null, customerEmail: null, successUrl: "x", cancelUrl: "y" }),
    ).rejects.toThrow(BillingProviderError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("Stripe helpers", () => {
  it("form-encodes nested objects and arrays like Stripe expects", () => {
    expect(formEncode({ a: { b: 1 }, c: ["x", "y"], d: undefined, e: null, f: true, g: "ש ם" })).toBe(
      "a%5Bb%5D=1&c%5B0%5D=x&c%5B1%5D=y&f=true&g=%D7%A9%20%D7%9D",
    );
    expect(formEncode({ items: [{ id: "si_1", quantity: 2 }] })).toBe("items%5B0%5D%5Bid%5D=si_1&items%5B0%5D%5Bquantity%5D=2");
  });

  it("normalizes subscription objects (old and new API shapes, status mapping)", () => {
    const base = {
      id: "sub_1",
      customer: "cus_1",
      status: "active",
      cancel_at_period_end: false,
      metadata: { tenantId: "t-1" },
      items: { data: [{ id: "si_1", quantity: 4, price: { id: "price_pro_m" } }] },
    };
    const oldShape = stripeSubscriptionState({ ...base, current_period_start: 1_700_000_000, current_period_end: 1_702_592_000 });
    expect(oldShape).toMatchObject({ providerSubscriptionId: "sub_1", providerCustomerId: "cus_1", status: "active", priceId: "price_pro_m", quantity: 4, tenantId: "t-1" });
    expect(oldShape.currentPeriodEnd?.toISOString()).toBe(new Date(1_702_592_000_000).toISOString());
    const newShape = stripeSubscriptionState({
      ...base,
      customer: { id: "cus_2" },
      items: { data: [{ id: "si_1", quantity: 1, price: { id: "price_x" }, current_period_start: 1_700_000_000, current_period_end: 1_702_592_000 }] },
    });
    expect(newShape.providerCustomerId).toBe("cus_2");
    expect(newShape.currentPeriodStart?.getTime()).toBe(1_700_000_000_000);
    expect(stripeSubscriptionState({ ...base, status: "unpaid" }).status).toBe("past_due");
    expect(stripeSubscriptionState({ ...base, status: "incomplete_expired" }).status).toBe("canceled");
    expect(stripeSubscriptionState({ ...base, status: "something_new" }).status).toBe("incomplete");
  });
});

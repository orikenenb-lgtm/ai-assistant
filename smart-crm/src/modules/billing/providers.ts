import { randomUUID } from "node:crypto";
import { env } from "@/server/env";
import { addInterval, type BillingInterval } from "./plans";
import { verifyStripeSignature } from "./stripe-signature";

/**
 * Billing provider abstraction. The database (`subscriptions`) is the source of
 * truth the app reads; providers only move money and report state back.
 *
 *  - MockBillingProvider (default): no network, no money. Plan changes apply
 *    immediately; invoices shown are clearly-labelled samples.
 *  - StripeBillingProvider: Stripe REST API (Checkout, Billing Portal, signed
 *    webhooks). Refuses live keys unless BILLING_LIVE_MODE=true.
 */

export type SubscriptionStatus = "trialing" | "active" | "past_due" | "canceled" | "incomplete" | "paused";

export type ProviderSubscriptionState = {
  providerSubscriptionId: string;
  providerCustomerId: string | null;
  status: SubscriptionStatus;
  priceId: string | null;
  quantity: number | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date | null;
  trialEndsAt: Date | null;
  tenantId: string | null;
};

export type InvoiceView = {
  id: string;
  number: string | null;
  status: "paid" | "open" | "void" | "uncollectible" | "draft";
  amountCents: number;
  currency: string;
  periodStart: Date | null;
  periodEnd: Date | null;
  createdAt: Date;
  hostedUrl: string | null;
  pdfUrl: string | null;
  /** True for generated demo rows (mock provider) — never real charges. */
  sample: boolean;
};

export type BillingWebhookEvent = { id: string; type: string; object: Record<string, unknown>; createdAt: Date };

export type CheckoutInput = {
  tenantId: string;
  planId: string;
  interval: BillingInterval;
  priceId: string | null;
  seats: number;
  customerId: string | null;
  customerEmail: string | null;
  successUrl: string;
  cancelUrl: string;
};

export type CheckoutResult = { type: "redirect"; url: string } | { type: "applied" };

export interface BillingProvider {
  readonly kind: "mock" | "stripe";
  createCheckout(input: CheckoutInput): Promise<CheckoutResult>;
  createPortal(input: { customerId: string | null; returnUrl: string }): Promise<{ url: string }>;
  /** Returns the provider's new state, or null when the provider keeps no remote state (mock). */
  changePlan(input: { subscriptionId: string; priceId: string | null; planId: string; interval: BillingInterval; seats: number }): Promise<ProviderSubscriptionState | null>;
  cancel(input: { subscriptionId: string }): Promise<ProviderSubscriptionState | null>;
  resume(input: { subscriptionId: string }): Promise<ProviderSubscriptionState | null>;
  syncSeats(input: { subscriptionId: string; seats: number }): Promise<void>;
  listInvoices(input: {
    customerId: string | null;
    amountCents: number;
    currency: string;
    interval: BillingInterval;
    periodStart: Date | null;
  }): Promise<InvoiceView[]>;
  /** Verifies the signature and parses the event. Throws on invalid input. */
  parseWebhook(rawBody: string, signatureHeader: string | null): BillingWebhookEvent;
}

export class BillingProviderError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "BillingProviderError";
  }
}

export class LiveModeDisabledError extends Error {
  constructor() {
    super("Live billing is disabled: set BILLING_LIVE_MODE=true (requires explicit approval) to use a live Stripe key");
    this.name = "LiveModeDisabledError";
  }
}

/* --------------------------------------------------------------- mock */

export class MockBillingProvider implements BillingProvider {
  readonly kind = "mock" as const;

  async createCheckout(): Promise<CheckoutResult> {
    return { type: "applied" };
  }

  async createPortal(): Promise<{ url: string }> {
    return { url: "/settings/billing/portal" };
  }

  async changePlan() {
    return null;
  }

  async cancel() {
    return null;
  }

  async resume() {
    return null;
  }

  async syncSeats() {}

  /** Up to three demo invoices for the current paid plan, clearly marked as samples. */
  async listInvoices(input: { amountCents: number; currency: string; interval: BillingInterval; periodStart: Date | null }): Promise<InvoiceView[]> {
    if (input.amountCents <= 0) return [];
    const anchor = input.periodStart ?? new Date();
    return [0, 1, 2].map((i) => {
      const start = addInterval(anchor, input.interval, -i);
      const end = addInterval(start, input.interval);
      return {
        id: `mock_in_${i}`,
        number: `DEMO-${start.getUTCFullYear()}${String(start.getUTCMonth() + 1).padStart(2, "0")}`,
        status: "paid" as const,
        amountCents: input.amountCents,
        currency: input.currency,
        periodStart: start,
        periodEnd: end,
        createdAt: start,
        hostedUrl: null,
        pdfUrl: null,
        sample: true,
      };
    });
  }

  parseWebhook(): BillingWebhookEvent {
    throw new BillingProviderError("the mock billing provider does not receive webhooks", 404);
  }
}

/* ------------------------------------------------------------- stripe */

export const STRIPE_API_BASE = "https://api.stripe.com/v1";
/** Requests are pinned to this API version; webhook payloads may use the account default (both shapes handled). */
export const STRIPE_API_VERSION = "2024-06-20";

type FormValue = string | number | boolean | null | undefined | FormValue[] | { [k: string]: FormValue };

/** Stripe's bracket form encoding: {a:{b:1}, c:[x]} → a[b]=1&c[0]=x */
export function formEncode(params: Record<string, FormValue>, prefix = ""): string {
  const parts: string[] = [];
  const walk = (value: FormValue, key: string) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${key}[${i}]`));
    else if (typeof value === "object") for (const [k, v] of Object.entries(value)) walk(v, `${key}[${k}]`);
    else parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  };
  for (const [k, v] of Object.entries(params)) walk(v, prefix ? `${prefix}[${k}]` : k);
  return parts.join("&");
}

const STATUS_MAP: Record<string, SubscriptionStatus> = {
  active: "active",
  trialing: "trialing",
  past_due: "past_due",
  unpaid: "past_due",
  canceled: "canceled",
  incomplete: "incomplete",
  incomplete_expired: "canceled",
  paused: "paused",
};

const unix = (v: unknown): Date | null => (typeof v === "number" && v > 0 ? new Date(v * 1000) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** Normalizes a Stripe Subscription object (old and new API shapes). */
export function stripeSubscriptionState(obj: Record<string, unknown>): ProviderSubscriptionState {
  const items = ((obj.items as { data?: Record<string, unknown>[] } | undefined)?.data ?? []) as Record<string, unknown>[];
  const item = items[0] ?? {};
  const price = (item.price as Record<string, unknown> | undefined) ?? {};
  const metadata = (obj.metadata as Record<string, unknown> | undefined) ?? {};
  const customer = obj.customer;
  return {
    providerSubscriptionId: String(obj.id),
    providerCustomerId: typeof customer === "string" ? customer : str((customer as Record<string, unknown> | undefined)?.id),
    status: STATUS_MAP[String(obj.status)] ?? "incomplete",
    priceId: str(price.id),
    quantity: typeof item.quantity === "number" ? item.quantity : null,
    currentPeriodStart: unix(obj.current_period_start) ?? unix(item.current_period_start),
    currentPeriodEnd: unix(obj.current_period_end) ?? unix(item.current_period_end),
    cancelAtPeriodEnd: obj.cancel_at_period_end === true,
    canceledAt: unix(obj.canceled_at),
    trialEndsAt: unix(obj.trial_end),
    tenantId: str(metadata.tenantId),
  };
}

export class StripeBillingProvider implements BillingProvider {
  readonly kind = "stripe" as const;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly secretKey: string,
    private readonly webhookSecret: string,
    opts: { liveMode: boolean; fetchImpl?: typeof fetch },
  ) {
    if (!secretKey) throw new BillingProviderError("STRIPE_SECRET_KEY is not configured");
    // Defense in depth (env.ts validates too): live keys require the explicit live-mode switch.
    if (/^(sk|rk)_live_/.test(secretKey) && !opts.liveMode) throw new LiveModeDisabledError();
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async request<T = Record<string, unknown>>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    params: Record<string, FormValue> = {},
    idempotencyKey?: string,
  ): Promise<T> {
    const query = method === "GET" && Object.keys(params).length ? `?${formEncode(params)}` : "";
    const res = await this.fetchImpl(`${STRIPE_API_BASE}${path}${query}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Stripe-Version": STRIPE_API_VERSION,
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: method === "GET" ? undefined : formEncode(params),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const err = (body.error as Record<string, unknown> | undefined) ?? {};
      throw new BillingProviderError(String(err.message ?? `Stripe responded ${res.status}`), res.status, str(err.code) ?? undefined);
    }
    return body as T;
  }

  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    if (!input.priceId) throw new BillingProviderError("no Stripe price configured for this plan");
    const session = await this.request(
      "POST",
      "/checkout/sessions",
      {
        mode: "subscription",
        client_reference_id: input.tenantId,
        customer: input.customerId ?? undefined,
        customer_email: input.customerId ? undefined : (input.customerEmail ?? undefined),
        line_items: [{ price: input.priceId, quantity: Math.max(1, input.seats) }],
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        allow_promotion_codes: true,
        metadata: { tenantId: input.tenantId, planId: input.planId, interval: input.interval },
        subscription_data: { metadata: { tenantId: input.tenantId, planId: input.planId, interval: input.interval } },
      },
      `checkout:${input.tenantId}:${input.planId}:${input.interval}:${randomUUID()}`,
    );
    const url = str(session.url);
    if (!url) throw new BillingProviderError("Stripe did not return a checkout URL");
    return { type: "redirect", url };
  }

  async createPortal(input: { customerId: string | null; returnUrl: string }) {
    if (!input.customerId) throw new BillingProviderError("no Stripe customer for this organization yet");
    const session = await this.request("POST", "/billing_portal/sessions", { customer: input.customerId, return_url: input.returnUrl });
    const url = str(session.url);
    if (!url) throw new BillingProviderError("Stripe did not return a portal URL");
    return { url };
  }

  private async firstItemId(subscriptionId: string): Promise<string> {
    const sub = await this.request("GET", `/subscriptions/${encodeURIComponent(subscriptionId)}`);
    const id = str(((sub.items as { data?: Record<string, unknown>[] } | undefined)?.data ?? [])[0]?.id);
    if (!id) throw new BillingProviderError("subscription has no items");
    return id;
  }

  async changePlan(input: { subscriptionId: string; priceId: string | null; planId: string; interval: BillingInterval; seats: number }) {
    if (!input.priceId) throw new BillingProviderError("no Stripe price configured for this plan");
    const itemId = await this.firstItemId(input.subscriptionId);
    const sub = await this.request(
      "POST",
      `/subscriptions/${encodeURIComponent(input.subscriptionId)}`,
      {
        items: [{ id: itemId, price: input.priceId, quantity: Math.max(1, input.seats) }],
        proration_behavior: "create_prorations",
        cancel_at_period_end: false,
        metadata: { planId: input.planId, interval: input.interval },
      },
      `change:${input.subscriptionId}:${input.priceId}:${randomUUID()}`,
    );
    return stripeSubscriptionState(sub);
  }

  async cancel(input: { subscriptionId: string }) {
    const sub = await this.request("POST", `/subscriptions/${encodeURIComponent(input.subscriptionId)}`, { cancel_at_period_end: true });
    return stripeSubscriptionState(sub);
  }

  async resume(input: { subscriptionId: string }) {
    const sub = await this.request("POST", `/subscriptions/${encodeURIComponent(input.subscriptionId)}`, { cancel_at_period_end: false });
    return stripeSubscriptionState(sub);
  }

  async syncSeats(input: { subscriptionId: string; seats: number }) {
    const itemId = await this.firstItemId(input.subscriptionId);
    await this.request(
      "POST",
      `/subscriptions/${encodeURIComponent(input.subscriptionId)}`,
      { items: [{ id: itemId, quantity: Math.max(1, input.seats) }], proration_behavior: "create_prorations" },
      `seats:${input.subscriptionId}:${input.seats}:${randomUUID()}`,
    );
  }

  async listInvoices(input: { customerId: string | null }): Promise<InvoiceView[]> {
    if (!input.customerId) return [];
    const list = await this.request<{ data?: Record<string, unknown>[] }>("GET", "/invoices", { customer: input.customerId, limit: 12 });
    return (list.data ?? []).map((inv) => ({
      id: String(inv.id),
      number: str(inv.number),
      status: (["paid", "open", "void", "uncollectible", "draft"].includes(String(inv.status)) ? inv.status : "open") as InvoiceView["status"],
      amountCents: Number(inv.amount_paid ?? inv.amount_due ?? 0),
      currency: String(inv.currency ?? "ils").toUpperCase(),
      periodStart: unix(inv.period_start),
      periodEnd: unix(inv.period_end),
      createdAt: unix(inv.created) ?? new Date(),
      hostedUrl: str(inv.hosted_invoice_url),
      pdfUrl: str(inv.invoice_pdf),
      sample: false,
    }));
  }

  parseWebhook(rawBody: string, signatureHeader: string | null): BillingWebhookEvent {
    verifyStripeSignature(rawBody, signatureHeader, this.webhookSecret);
    const event = JSON.parse(rawBody) as { id?: unknown; type?: unknown; created?: unknown; data?: { object?: Record<string, unknown> } };
    if (typeof event.id !== "string" || typeof event.type !== "string" || !event.data?.object) {
      throw new BillingProviderError("malformed Stripe event");
    }
    return { id: event.id, type: event.type, object: event.data.object, createdAt: unix(event.created) ?? new Date() };
  }
}

/* ------------------------------------------------------------ factory */

let cached: BillingProvider | undefined;

export function billingProvider(): BillingProvider {
  if (!cached) {
    const e = env();
    cached =
      e.BILLING_PROVIDER === "stripe"
        ? new StripeBillingProvider(e.STRIPE_SECRET_KEY ?? "", e.STRIPE_WEBHOOK_SECRET ?? "", { liveMode: e.BILLING_LIVE_MODE })
        : new MockBillingProvider();
  }
  return cached;
}

/** Tests only. */
export function setBillingProviderForTests(p: BillingProvider | undefined) {
  cached = p;
}

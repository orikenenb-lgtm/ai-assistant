import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/server/env";
import { errorFields, logger } from "@/server/logger";
import { hitRateLimit } from "@/server/rate-limit";
import { ingestBillingWebhook } from "@/modules/billing/webhooks";
import { BillingProviderError } from "@/modules/billing/providers";
import { StripeSignatureError } from "@/modules/billing/stripe-signature";

export const maxDuration = 30;

/**
 * Stripe webhook endpoint. Verifies the signature over the raw body, stores the
 * event (deduplicated by event id) and acknowledges; processing happens in the
 * worker (`billing.process_webhook`).
 */
export async function POST(request: NextRequest) {
  if (env().BILLING_PROVIDER !== "stripe") return NextResponse.json({ error: "not found" }, { status: 404 });
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!(await hitRateLimit(`billing-webhook:${ip}`, 600, 60)).allowed) {
    return NextResponse.json({ error: "rate limited" }, { status: 429 });
  }
  const raw = await request.text();
  if (raw.length > 1_000_000) return NextResponse.json({ error: "payload too large" }, { status: 413 });
  try {
    const result = await ingestBillingWebhook(raw, request.headers.get("stripe-signature"));
    return NextResponse.json({ received: true, duplicate: result.status === "duplicate" });
  } catch (e) {
    if (e instanceof StripeSignatureError || e instanceof BillingProviderError || e instanceof SyntaxError) {
      logger().warn({ ...errorFields(e), ip }, "rejected billing webhook");
      return NextResponse.json({ error: "invalid signature or payload" }, { status: 400 });
    }
    // Storage failure: a 5xx makes Stripe retry later.
    logger().error(errorFields(e), "could not store billing webhook");
    return NextResponse.json({ error: "temporarily unavailable" }, { status: 503 });
  }
}

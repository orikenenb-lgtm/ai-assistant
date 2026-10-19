import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signWebhookPayload, verifyWebhookSignature } from "@/modules/webhooks/sign";

describe("webhook signatures", () => {
  const secret = "whsec_test";
  const body = JSON.stringify({ id: "evt_1", type: "contact.created", data: { name: "דנה" } });

  it("produces t=<unix>,v1=<hex hmac of t.body>", () => {
    const header = signWebhookPayload(secret, body, 1_700_000_000);
    const expected = createHmac("sha256", secret).update(`1700000000.${body}`).digest("hex");
    expect(header).toBe(`t=1700000000,v1=${expected}`);
  });

  it("verifies valid signatures and rejects tampering, wrong secrets and stale timestamps", () => {
    const now = 1_700_000_000;
    const header = signWebhookPayload(secret, body, now);
    expect(verifyWebhookSignature(secret, body, header, { now })).toBe(true);
    expect(verifyWebhookSignature(secret, body + " ", header, { now })).toBe(false);
    expect(verifyWebhookSignature("other", body, header, { now })).toBe(false);
    expect(verifyWebhookSignature(secret, body, header, { now: now + 301 })).toBe(false);
    expect(verifyWebhookSignature(secret, body, "t=abc,v1=zz", { now })).toBe(false);
    expect(verifyWebhookSignature(secret, body, null, { now })).toBe(false);
  });
});

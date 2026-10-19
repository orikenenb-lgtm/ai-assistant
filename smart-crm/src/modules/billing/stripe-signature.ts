import { createHmac, timingSafeEqual } from "node:crypto";

export const STRIPE_SIGNATURE_TOLERANCE_SECONDS = 300;

export class StripeSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StripeSignatureError";
  }
}

/** Parses `t=…,v1=…,v1=…,v0=…` into the timestamp and all v1 signatures. */
export function parseSignatureHeader(header: string): { timestamp: number; signatures: string[] } {
  let timestamp = Number.NaN;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key === "t") timestamp = Number(value);
    else if (key === "v1" && /^[0-9a-f]+$/i.test(value)) signatures.push(value.toLowerCase());
  }
  return { timestamp, signatures };
}

export function computeStripeSignature(payload: string, timestamp: number, secret: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${payload}`, "utf8").digest("hex");
}

/**
 * Verifies a `Stripe-Signature` header against the raw request body
 * (HMAC-SHA256 of "<t>.<payload>" with the endpoint secret). Accepts any of the
 * v1 signatures (secret rotation) and rejects timestamps outside the tolerance
 * window (replay protection). Throws StripeSignatureError on failure.
 */
export function verifyStripeSignature(
  payload: string,
  header: string | null | undefined,
  secret: string,
  opts: { toleranceSeconds?: number; nowSeconds?: number } = {},
): void {
  if (!header) throw new StripeSignatureError("missing signature header");
  if (!secret) throw new StripeSignatureError("missing webhook secret");
  const { timestamp, signatures } = parseSignatureHeader(header);
  if (!Number.isFinite(timestamp)) throw new StripeSignatureError("missing timestamp");
  if (signatures.length === 0) throw new StripeSignatureError("no v1 signature");
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = opts.toleranceSeconds ?? STRIPE_SIGNATURE_TOLERANCE_SECONDS;
  if (Math.abs(now - timestamp) > tolerance) throw new StripeSignatureError("timestamp outside tolerance");
  const expected = Buffer.from(computeStripeSignature(payload, timestamp, secret), "hex");
  const ok = signatures.some((sig) => {
    const given = Buffer.from(sig, "hex");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  if (!ok) throw new StripeSignatureError("signature mismatch");
}

/** Builds a valid header (tests and local tooling). */
export function signStripePayload(payload: string, secret: string, timestamp = Math.floor(Date.now() / 1000)): string {
  return `t=${timestamp},v1=${computeStripeSignature(payload, timestamp, secret)}`;
}

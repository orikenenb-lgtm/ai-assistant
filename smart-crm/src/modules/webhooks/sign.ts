import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_HEADER = "X-SmartCRM-Signature";
export const DEFAULT_TOLERANCE_SECONDS = 300;

/** `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">` */
export function signWebhookPayload(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const sig = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${sig}`;
}

/** Reference verifier (documented for receivers; used by tests). */
export function verifyWebhookSignature(
  secret: string,
  body: string,
  header: string | null | undefined,
  opts: { now?: number; toleranceSeconds?: number } = {},
): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
  const t = Number(parts.t);
  if (!Number.isInteger(t) || !/^[0-9a-f]{64}$/.test(parts.v1 ?? "")) return false;
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - t) > (opts.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS)) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${body}`).digest();
  const given = Buffer.from(parts.v1, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

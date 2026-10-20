import { hmacSha256Hex, safeEqual } from "@/server/crypto";

/** `sha256=<hex>` over the exact raw request body, keyed with the Meta app secret. */
export function metaSignature(rawBody: string, appSecret: string): string {
  return `sha256=${hmacSha256Hex(appSecret, rawBody)}`;
}

/** Timing-safe check of the X-Hub-Signature-256 header. */
export function verifyMetaSignature(rawBody: string, header: string | null | undefined, appSecret: string | undefined): boolean {
  if (!header || !appSecret) return false;
  if (!/^sha256=[0-9a-f]{64}$/i.test(header)) return false;
  return safeEqual(header.toLowerCase(), metaSignature(rawBody, appSecret));
}

/**
 * Client IP for rate limiting and audit.
 *
 * `X-Forwarded-For` is client-controlled except for the entries appended by our
 * own proxies, so the left-most value must never be trusted. Order:
 *  1. `x-vercel-forwarded-for` — set by Vercel's edge, cannot be spoofed there;
 *  2. the right-most `X-Forwarded-For` entry — the address our (single) reverse
 *     proxy saw; on Vercel the header is rewritten to exactly the client IP;
 *  3. `x-real-ip`.
 */
export function clientIp(h: Headers): string | null {
  const vercel = h.get("x-vercel-forwarded-for")?.split(",")[0]?.trim();
  if (vercel) return vercel;
  const chain = h
    .get("x-forwarded-for")
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (chain?.length) return chain[chain.length - 1];
  return h.get("x-real-ip")?.trim() || null;
}

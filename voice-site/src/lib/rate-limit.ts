import "server-only";

/**
 * Fixed-window, in-memory rate limiter. On serverless platforms each instance
 * keeps its own counters, so this is a speed bump against scripted abuse, not a
 * hard global quota. Put a WAF / Vercel Firewall rule in front for that.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const MAX_KEYS = 10_000;

export type RateLimitResult = { ok: boolean; remaining: number; retryAfterSeconds: number };

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): RateLimitResult {
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    if (buckets.size >= MAX_KEYS) {
      for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
      // Still full: drop the oldest keys only (Map keeps insertion order). Never
      // wipe everything, or flooding new keys would reset everyone's limits.
      for (const k of buckets.keys()) {
        if (buckets.size < MAX_KEYS * 0.9) break;
        buckets.delete(k);
      }
    }
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  const ok = bucket.count <= limit;
  return {
    ok,
    remaining: Math.max(0, limit - bucket.count),
    retryAfterSeconds: ok ? 0 : Math.ceil((bucket.resetAt - now) / 1000),
  };
}

const HOUR = 60 * 60 * 1000;

/**
 * One budget for every lead an IP can create, whether from the form or from the
 * live demo agent (default 6 per hour; LEAD_RATE_LIMIT_PER_HOUR overrides).
 */
export function leadRateLimit(ip: string): RateLimitResult {
  const limit = Number(process.env.LEAD_RATE_LIMIT_PER_HOUR) || 6;
  return rateLimit(`lead:${ip}`, limit, HOUR);
}

/**
 * Best available client IP. On Vercel `x-vercel-forwarded-for` / `x-real-ip`
 * are set by the platform and can't be spoofed. Elsewhere, run behind a proxy
 * that appends to X-Forwarded-For; the last entry is the one that proxy saw
 * (the first entry is whatever the client chose to send).
 */
export function clientIp(request: Request): string {
  const h = request.headers;
  const platform = h.get("x-vercel-forwarded-for") ?? h.get("x-real-ip");
  if (platform) return platform.split(",")[0].trim();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",").at(-1)!.trim();
  return "unknown";
}

/** Reject cross-site POSTs from browsers (CSRF-ish noise and form spam). */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // non-browser clients and same-origin navigations without Origin
  try {
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

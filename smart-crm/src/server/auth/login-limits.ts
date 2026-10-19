import { hitRateLimit, peekRateLimit } from "../rate-limit";

const WINDOW = 900;

/**
 * Failed sign-ins only. Per account+IP (tight) so a stranger cannot lock the owner
 * out from elsewhere; per account (loose) against distributed guessing; per IP
 * against password spraying.
 */
function keys(email: string, ip: string | null): [string, number][] {
  const e = email.toLowerCase();
  const i = ip ?? "unknown";
  return [
    [`login:${e}:${i}`, 10],
    [`login:${e}`, 100],
    [`login-ip:${i}`, 50],
  ];
}

export async function loginBlocked(email: string, ip: string | null): Promise<boolean> {
  const results = await Promise.all(keys(email, ip).map(([k, limit]) => peekRateLimit(k, limit, WINDOW)));
  return results.some((r) => !r.allowed);
}

export async function recordLoginFailure(email: string, ip: string | null): Promise<void> {
  await Promise.all(keys(email, ip).map(([k, limit]) => hitRateLimit(k, limit, WINDOW)));
}

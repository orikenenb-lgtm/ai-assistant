/** Environment contract shared with CI (.github/workflows/ori-travel-ai.yml) and scripts/test.sh. */
export const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173';
export const OWNER_EMAIL = process.env.E2E_OWNER_EMAIL ?? 'owner@e2e.test';
export const OWNER_PASSWORD = process.env.E2E_OWNER_PASSWORD ?? 'E2e-Passw0rd-Local-1';
export const OWNER_NAME_HINT = 'בעלים';

/** Date `days` from now as YYYY-MM-DD (computed at runtime so the suite never goes stale). */
export function futureDate(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** A string that is unique per call, safe for names/emails. */
export function uniq(prefix = 'e2e'): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Submit idempotency keys.
 *
 * One key is generated per (booking, approval) and then REUSED for every retry or double
 * click — the server replays the original outcome for the same key and never sends twice.
 * A new key is only ever created for a new approval. sessionStorage survives a page reload
 * (so a reload followed by "retry" still sends the same key); an in-memory map is the
 * fallback when storage is unavailable.
 */
const PREFIX = 'ori.booking.submitKey.';
const memory = new Map<string, string>();

function generate(): string {
  return crypto.randomUUID();
}

export function submitKeyStorageName(bookingId: string, approvalId: string): string {
  return `${PREFIX}${bookingId}.${approvalId}`;
}

export function getSubmitKey(bookingId: string, approvalId: string): string {
  const name = submitKeyStorageName(bookingId, approvalId);
  const cached = memory.get(name);
  if (cached) return cached;
  let key: string | null;
  try {
    key = sessionStorage.getItem(name);
  } catch {
    key = null;
  }
  if (!key) {
    key = generate();
    try {
      sessionStorage.setItem(name, key);
    } catch {
      // keep it in memory only
    }
  }
  memory.set(name, key);
  return key;
}

/** Test helper. */
export function resetSubmitKeysForTests(): void {
  memory.clear();
}

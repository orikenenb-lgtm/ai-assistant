/**
 * Defensive check for supplier links rendered as anchors.
 * The server is authoritative (provider domain allowlist); the client additionally
 * refuses anything ambiguous: non-https, backslashes, whitespace/control characters,
 * credentials in the URL, or explicit ports.
 */
export function safeExternalUrl(raw: string | null | undefined): string | null {
  if (!raw || raw.length > 2048) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\\\s\u0000-\u001f\u007f]/.test(raw)) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
    return u.toString();
  } catch {
    return null;
  }
}

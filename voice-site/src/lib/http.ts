import "server-only";

export const MAX_BODY_BYTES = 32 * 1024;

export function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

/**
 * Read the body as a stream and stop at the cap, so a chunked upload without a
 * Content-Length can't make the server buffer an arbitrarily large body.
 */
async function readCapped(request: Request): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** Read a JSON or urlencoded body with a hard size cap. Returns null when unusable. */
export async function readBody(request: Request): Promise<{ data: unknown; kind: "json" | "form" } | null> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) return null;
  const raw = await readCapped(request);
  if (raw === null) return null;
  const type = request.headers.get("content-type") ?? "";
  try {
    if (type.includes("application/x-www-form-urlencoded")) {
      const params = new URLSearchParams(raw);
      const data: Record<string, unknown> = {};
      for (const [k, v] of params) data[k] = v;
      return { data, kind: "form" };
    }
    return { data: JSON.parse(raw), kind: "json" };
  } catch {
    return null;
  }
}

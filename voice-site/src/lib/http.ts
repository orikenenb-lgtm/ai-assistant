import "server-only";

export const MAX_BODY_BYTES = 32 * 1024;

export function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

/** Read a JSON or urlencoded body with a hard size cap. Returns null when unusable. */
export async function readBody(request: Request): Promise<{ data: unknown; kind: "json" | "form" } | null> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) return null;
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return null;
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

import { parseLead } from "@/lib/lead";
import { deliverLead } from "@/lib/leads/deliver";
import { json, readBody } from "@/lib/http";
import { clientIp, isSameOrigin, rateLimit } from "@/lib/rate-limit";

const HOUR = 60 * 60 * 1000;

function redirect(request: Request, path: string): Response {
  return Response.redirect(new URL(path, request.url), 303);
}

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return json({ ok: false, error: "forbidden" }, { status: 403 });

  const limited = rateLimit(`lead:${clientIp(request)}`, 6, HOUR);
  if (!limited.ok) {
    return json(
      { ok: false, error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } },
    );
  }

  const body = await readBody(request);
  if (!body) return json({ ok: false, error: "bad_request" }, { status: 400 });

  // Plain HTML form posts (no JavaScript) send strings; normalize the checkbox.
  const data =
    body.kind === "form"
      ? { ...(body.data as Record<string, unknown>), marketingConsent: (body.data as Record<string, unknown>).marketingConsent === "on" }
      : body.data;

  const parsed = parseLead(data);
  if (!parsed.ok) {
    return body.kind === "form"
      ? redirect(request, "/contact-error")
      : json({ ok: false, error: "validation", errors: parsed.errors }, { status: 422 });
  }

  // Honeypot hit: answer like a success so bots learn nothing.
  if (parsed.spam) return body.kind === "form" ? redirect(request, "/thanks") : json({ ok: true });

  const result = await deliverLead(parsed.lead);
  if (result.status === "delivered") {
    return body.kind === "form" ? redirect(request, "/thanks") : json({ ok: true });
  }
  return body.kind === "form"
    ? redirect(request, "/contact-error")
    : json({ ok: false, error: result.status }, { status: 503 });
}

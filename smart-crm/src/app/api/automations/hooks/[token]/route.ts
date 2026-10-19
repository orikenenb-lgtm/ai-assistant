import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db, schema } from "@/server/db";
import { sha256Hex } from "@/server/crypto";
import { hitRateLimit } from "@/server/rate-limit";
import { startWebhookRun } from "@/modules/automation/engine";

const MAX_BODY = 64 * 1024;

/**
 * Inbound webhook trigger for automation workflows. The token in the URL is the
 * credential (only its hash is stored). Send `Idempotency-Key` to deduplicate.
 */
export async function POST(request: NextRequest, { params }: RouteContext<"/api/automations/hooks/[token]">) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const [wf] = await db()
    .select()
    .from(schema.automationWorkflows)
    .where(and(eq(schema.automationWorkflows.webhookTokenHash, sha256Hex(token)), eq(schema.automationWorkflows.status, "active")));
  if (!wf || wf.triggerType !== "webhook") return NextResponse.json({ error: "not found" }, { status: 404 });
  const limit = await hitRateLimit(`automation-hook:${wf.id}`, 60, 60);
  if (!limit.allowed) return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": "60" } });
  const raw = await request.text();
  if (raw.length > MAX_BODY) return NextResponse.json({ error: "payload too large" }, { status: 413 });
  let payload: unknown = {};
  if (raw.trim()) {
    try {
      payload = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }
  }
  const key = request.headers.get("idempotency-key")?.slice(0, 100) || createHash("sha256").update(raw).update(String(Math.floor(Date.now() / 60_000))).digest("hex");
  const runId = await startWebhookRun(wf, payload, key);
  return NextResponse.json({ accepted: true, runId, duplicate: runId === null }, { status: 202 });
}

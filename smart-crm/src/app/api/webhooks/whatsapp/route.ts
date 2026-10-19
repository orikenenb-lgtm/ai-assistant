import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/server/env";
import { safeEqual } from "@/server/crypto";
import { errorFields, logger } from "@/server/logger";
import { MAX_WEBHOOK_BYTES, ingestWhatsAppWebhook } from "@/modules/whatsapp/webhook";

/**
 * Meta WhatsApp Cloud API webhook.
 *  GET  — subscription verification (hub.challenge handshake)
 *  POST — signed event delivery; stored, deduplicated and processed by the worker
 */
export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const expected = env().META_WEBHOOK_VERIFY_TOKEN;
  const token = p.get("hub.verify_token") ?? "";
  if (p.get("hub.mode") === "subscribe" && expected && safeEqual(token, expected)) {
    return new NextResponse(p.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new NextResponse("forbidden", { status: 403 });
}

export async function POST(request: NextRequest) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_WEBHOOK_BYTES) return new NextResponse("payload too large", { status: 413 });
  try {
    const raw = await request.text();
    const result = await ingestWhatsAppWebhook(raw, request.headers.get("x-hub-signature-256"));
    return NextResponse.json({ ok: result.status === 200 }, { status: result.status });
  } catch (e) {
    // 5xx makes Meta retry later; the body hash dedupe keeps retries safe.
    logger().error(errorFields(e), "whatsapp webhook ingest failed");
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

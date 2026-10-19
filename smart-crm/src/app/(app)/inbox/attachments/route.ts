import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getTenantContext } from "@/server/tenancy";
import { isAppError } from "@/server/errors";
import { errorFields, logger } from "@/server/logger";
import { sanitizeFileName, storage, storageKey } from "@/server/storage";
import { OUTBOUND_MEDIA } from "@/modules/whatsapp/provider";
import { sendMessage } from "@/modules/inbox/service";
import { drainWhatsAppJobsInDev } from "@/modules/whatsapp/dev";

const MAX_BYTES = 16 * 1024 * 1024;
const fields = z.object({ conversationId: z.uuid(), caption: z.string().trim().max(1024).optional() });

/** Multipart upload of an outbound WhatsApp attachment (image, document, audio, video). */
export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== request.headers.get("host")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const tc = await getTenantContext().catch(() => null);
  if (!tc) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BYTES + 64 * 1024) {
    return NextResponse.json({ error: "inbox.fileTooLarge" }, { status: 413 });
  }
  const form = await request.formData();
  const parsed = fields.safeParse({ conversationId: form.get("conversationId"), caption: form.get("caption") || undefined });
  const file = form.get("file");
  if (!parsed.success || !(file instanceof File)) return NextResponse.json({ error: "invalid request" }, { status: 400 });
  const spec = OUTBOUND_MEDIA[file.type];
  if (!spec) return NextResponse.json({ error: "inbox.fileTypeNotAllowed" }, { status: 400 });
  if (file.size <= 0 || file.size > Math.min(spec.maxBytes, MAX_BYTES)) return NextResponse.json({ error: "inbox.fileTooLarge" }, { status: 400 });

  const key = storageKey(tc.ctx.tenantId, "whatsapp-out", file.name);
  await storage().put(key, Buffer.from(await file.arrayBuffer()), file.type);
  try {
    const msg = await sendMessage(tc.ctx, parsed.data.conversationId, {
      kind: "media",
      storageKey: key,
      mimeType: file.type,
      fileName: sanitizeFileName(file.name),
      sizeBytes: file.size,
      caption: parsed.data.caption,
    });
    await drainWhatsAppJobsInDev();
    return NextResponse.json({ id: msg.id });
  } catch (e) {
    await storage().delete(key).catch(() => undefined);
    if (isAppError(e)) return NextResponse.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 400 });
    logger().error(errorFields(e), "inbox attachment send failed");
    return NextResponse.json({ error: "upload failed" }, { status: 500 });
  }
}

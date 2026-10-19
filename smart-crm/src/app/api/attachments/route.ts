import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getTenantContext } from "@/server/tenancy";
import { uploadAttachment } from "@/modules/crm/attachments";
import { isAppError } from "@/server/errors";
import { errorFields, logger } from "@/server/logger";
import { MAX_UPLOAD_BYTES } from "@/server/storage";

const fields = z.object({ entityType: z.enum(["contact", "company", "deal", "lead"]), entityId: z.uuid() });

/** Multipart upload (files can exceed the server-action body limit). */
export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== request.headers.get("host")) {
    return NextResponse.json({ error: "cross-origin upload rejected" }, { status: 403 });
  }
  const tc = await getTenantContext().catch(() => null);
  if (!tc) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_UPLOAD_BYTES + 64 * 1024) return NextResponse.json({ error: "file too large" }, { status: 413 });
  const form = await request.formData();
  const parsed = fields.safeParse({ entityType: form.get("entityType"), entityId: form.get("entityId") });
  const file = form.get("file");
  if (!parsed.success || !(file instanceof File)) return NextResponse.json({ error: "invalid request" }, { status: 400 });
  try {
    const row = await uploadAttachment(tc.ctx, parsed.data.entityType, parsed.data.entityId, {
      name: file.name,
      type: file.type,
      bytes: Buffer.from(await file.arrayBuffer()),
    });
    return NextResponse.json({ id: row.id });
  } catch (e) {
    if (isAppError(e)) return NextResponse.json({ error: e.message, code: e.code }, { status: e.code === "FORBIDDEN" ? 403 : 400 });
    logger().error(errorFields(e), "attachment upload failed");
    return NextResponse.json({ error: "upload failed" }, { status: 500 });
  }
}

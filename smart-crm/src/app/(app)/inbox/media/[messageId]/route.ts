import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { getTenantContext } from "@/server/tenancy";
import { schema } from "@/server/db";
import { storage } from "@/server/storage";

const INLINE = /^(image\/(png|jpeg|webp|gif)|audio\/(ogg|mpeg|aac|mp4)|video\/mp4|application\/pdf)$/;

/** Authorized media for a WhatsApp message (RLS decides visibility). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ messageId: string }> }) {
  const { messageId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(messageId)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const tc = await getTenantContext().catch(() => null);
  if (!tc || !tc.ctx.can("inbox.view")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const [msg] = await tc.ctx.run((tx) =>
    tx
      .select({ media: schema.messages.media })
      .from(schema.messages)
      .where(and(eq(schema.messages.id, messageId), eq(schema.messages.tenantId, tc.ctx.tenantId))),
  );
  const media = (msg?.media ?? null) as { storageKey?: string; mimeType?: string; fileName?: string } | null;
  if (!media?.storageKey) return NextResponse.json({ error: "not found" }, { status: 404 });
  const name = media.fileName ?? "file";
  if (storage().kind === "local") {
    const body = await storage().get(media.storageKey).catch(() => null);
    if (!body) return NextResponse.json({ error: "not found" }, { status: 404 });
    const mime = media.mimeType && INLINE.test(media.mimeType) ? media.mimeType : "application/octet-stream";
    const inline = mime !== "application/octet-stream" && request.nextUrl.searchParams.get("download") !== "1";
    return new NextResponse(new Uint8Array(body), {
      headers: {
        "Content-Type": mime,
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
        "Cache-Control": "private, max-age=300",
      },
    });
  }
  const url = await storage().signedUrl(media.storageKey, 300, name);
  return NextResponse.redirect(url, { headers: { "Cache-Control": "no-store" } });
}

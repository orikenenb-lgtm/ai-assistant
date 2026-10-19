import { NextResponse, type NextRequest } from "next/server";
import { verifyPayload } from "@/server/crypto";
import { storage } from "@/server/storage";

/** Serves local-disk files for development; the HMAC token is the authorization. */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") ?? "";
  const payload = verifyPayload<{ key: string; name: string }>("file-download", token);
  if (!payload) return NextResponse.json({ error: "invalid or expired link" }, { status: 403 });
  if (storage().kind !== "local") return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await storage().get(payload.key).catch(() => null);
  if (!body) return NextResponse.json({ error: "not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(payload.name)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}

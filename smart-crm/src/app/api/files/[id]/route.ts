import { NextResponse, type NextRequest } from "next/server";
import { getTenantContext } from "@/server/tenancy";
import { attachmentDownloadUrl } from "@/modules/crm/attachments";
import { isAppError } from "@/server/errors";

/** Authorized attachment download: checks access, then redirects to a 2-minute signed URL. */
export async function GET(request: NextRequest, { params }: RouteContext<"/api/files/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const tc = await getTenantContext().catch(() => null);
  if (!tc) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const url = await attachmentDownloadUrl(tc.ctx, id);
    return NextResponse.redirect(new URL(url, request.url), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const status = isAppError(e) && e.code === "FORBIDDEN" ? 403 : 404;
    return NextResponse.json({ error: "not found" }, { status });
  }
}

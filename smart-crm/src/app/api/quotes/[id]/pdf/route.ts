import { NextResponse, type NextRequest } from "next/server";
import { getTenantContext } from "@/server/tenancy";
import { isAppError } from "@/server/errors";
import { pdfResponse } from "@/modules/documents/http";
import { quotePdf } from "@/modules/documents/service";

/** Staff PDF download: the stored snapshot once sent, a live render for drafts. */
export async function GET(_request: NextRequest, { params }: RouteContext<"/api/quotes/[id]/pdf">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const tc = await getTenantContext().catch(() => null);
  if (!tc) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const { bytes, fileName } = await quotePdf(tc.ctx, id);
    return pdfResponse(bytes, fileName);
  } catch (e) {
    const status = isAppError(e) && e.code === "FORBIDDEN" ? 403 : 404;
    return NextResponse.json({ error: "not found" }, { status });
  }
}

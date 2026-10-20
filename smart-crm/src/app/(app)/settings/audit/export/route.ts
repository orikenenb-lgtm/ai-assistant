import { NextResponse, type NextRequest } from "next/server";
import { getTenantContext } from "@/server/tenancy";
import { isAppError } from "@/server/errors";
import { exportAuditCsv, parseAuditQuery } from "@/modules/audit/service";

export async function GET(request: NextRequest) {
  const tc = await getTenantContext().catch(() => null);
  if (!tc) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const csv = await exportAuditCsv(tc.ctx, parseAuditQuery(Object.fromEntries(request.nextUrl.searchParams)));
    const date = new Date().toISOString().slice(0, 10);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="audit-log-${date}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (isAppError(e) && (e.code === "FORBIDDEN" || e.code === "PLAN_REQUIRED")) {
      return NextResponse.json({ error: e.code.toLowerCase() }, { status: 403 });
    }
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}

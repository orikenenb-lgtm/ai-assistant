import { NextResponse, type NextRequest } from "next/server";
import { getTenantContext } from "@/server/tenancy";
import { db } from "@/server/db";
import { isAppError } from "@/server/errors";
import { errorFields, logger } from "@/server/logger";
import { getEntitlements } from "@/modules/billing/entitlements";
import { REPORTS, parseFilters, resolveScope, type ReportKey } from "@/modules/analytics/service";
import { exportReportCsv } from "@/modules/analytics/export";

/** CSV export of one analytics report (permission analytics.export). */
export async function GET(request: NextRequest) {
  const tc = await getTenantContext().catch(() => null);
  if (!tc) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const params = Object.fromEntries(request.nextUrl.searchParams);
  const report = params.report as ReportKey;
  if (!(REPORTS as readonly string[]).includes(report)) return NextResponse.json({ error: "unknown report" }, { status: 400 });
  try {
    const ent = await getEntitlements(db(), tc.ctx.tenantId);
    if (!ent.features.has("analytics")) return NextResponse.json({ error: "plan required" }, { status: 402 });
    const scope = await resolveScope(tc.ctx, parseFilters(params));
    const csv = await exportReportCsv(tc.ctx, report, scope);
    const name = `${report}-${scope.range.fromDate}_${scope.range.toDate}.csv`;
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (isAppError(e) && e.code === "FORBIDDEN") return NextResponse.json({ error: "forbidden" }, { status: 403 });
    logger().error(errorFields(e), "analytics export failed");
    return NextResponse.json({ error: "export failed" }, { status: 500 });
  }
}

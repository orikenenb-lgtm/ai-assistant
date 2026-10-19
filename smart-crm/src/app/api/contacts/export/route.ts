import { NextResponse, type NextRequest } from "next/server";
import { getTenantContext } from "@/server/tenancy";
import { exportContactsCsv } from "@/modules/crm/contacts/import-export";
import { parseListQuery } from "@/modules/crm/schemas";
import { isAppError } from "@/server/errors";

export async function GET(request: NextRequest) {
  const tc = await getTenantContext().catch(() => null);
  if (!tc) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const filters = parseListQuery(Object.fromEntries(request.nextUrl.searchParams));
    const { csv } = await exportContactsCsv(tc.ctx, filters);
    const date = new Date().toISOString().slice(0, 10);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="contacts-${date}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: "forbidden" }, { status: isAppError(e) && e.code === "FORBIDDEN" ? 403 : 500 });
  }
}

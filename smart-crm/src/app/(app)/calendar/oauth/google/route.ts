import { NextResponse, type NextRequest } from "next/server";
import { getTenantContext } from "@/server/tenancy";
import { env } from "@/server/env";
import { signPayload } from "@/server/crypto";
import { calendarSyncEnabled } from "@/modules/calendar/connections";
import { googleProvider } from "@/modules/calendar/providers";

/** Starts Google Calendar OAuth (only when credentials and the calendar.sync flag are enabled). */
export async function GET(request: NextRequest) {
  const tc = await getTenantContext().catch(() => null);
  if (!tc || tc.supportMode || !tc.ctx.can("calendar.manage")) return NextResponse.redirect(new URL("/calendar", request.url));
  const google = googleProvider();
  if (!google || !(await calendarSyncEnabled(tc.tenant.id))) return NextResponse.redirect(new URL("/calendar?integration=unavailable", request.url));
  const state = signPayload("calendar-oauth", { tenantId: tc.tenant.id, userId: tc.user.userId }, 600);
  return NextResponse.redirect(google.authUrl(state, `${env().APP_URL}/calendar/oauth/google/callback`));
}

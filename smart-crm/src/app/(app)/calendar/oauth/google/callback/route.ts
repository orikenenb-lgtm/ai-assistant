import { NextResponse, type NextRequest } from "next/server";
import { getTenantContext } from "@/server/tenancy";
import { env } from "@/server/env";
import { verifyPayload } from "@/server/crypto";
import { errorFields, logger } from "@/server/logger";
import { saveConnection } from "@/modules/calendar/connections";
import { googleProvider } from "@/modules/calendar/providers";

/** OAuth callback: verifies the signed state belongs to this session, then stores encrypted tokens. */
export async function GET(request: NextRequest) {
  const to = (q: string) => NextResponse.redirect(new URL(`/calendar?integration=${q}`, request.url));
  const tc = await getTenantContext().catch(() => null);
  const state = verifyPayload<{ tenantId: string; userId: string }>("calendar-oauth", request.nextUrl.searchParams.get("state") ?? "");
  const code = request.nextUrl.searchParams.get("code");
  const google = googleProvider();
  if (!tc || !state || !code || !google || state.tenantId !== tc.tenant.id || state.userId !== tc.user.userId) return to("failed");
  try {
    const tokens = await google.exchangeCode(code, `${env().APP_URL}/calendar/oauth/google/callback`);
    await saveConnection(tc.ctx, "google", tokens);
    return to("connected");
  } catch (e) {
    logger().warn(errorFields(e), "google calendar connect failed");
    return to("failed");
  }
}

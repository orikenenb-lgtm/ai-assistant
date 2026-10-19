import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/server/auth";
import { safeNext } from "@/modules/auth/schemas";

/**
 * Landing route for email links.
 *  - local adapter:    ?type=email&token=…        (recovery links go straight to /reset-password)
 *  - Supabase adapter: ?type=email|recovery&token_hash=…[&next=/reset-password]
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const type = url.searchParams.get("type");
  const token = url.searchParams.get("token_hash") ?? url.searchParams.get("token");
  const next = safeNext(url.searchParams.get("next"), "/dashboard");
  const to = (path: string) => NextResponse.redirect(new URL(path, request.url));

  if (!token || (type !== "email" && type !== "signup" && type !== "recovery")) return to("/verify-email?status=invalid");
  const kind = type === "recovery" ? "recovery" : "email";
  const result = await auth().confirm({ token, type: kind });
  if (!result) return to("/verify-email?status=invalid");
  if (kind === "recovery") return to(next === "/dashboard" ? "/reset-password" : next);
  return to("/verify-email?status=verified");
}

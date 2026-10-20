import "server-only";
import { notFound, redirect } from "next/navigation";
import { requestInfo, requireUser } from "@/server/auth";
import { isAppError } from "@/server/errors";
import { adminMfaSatisfied, assertSuperAdmin, type AdminActor } from "./guard";

/** For /admin pages: the current super admin, or a 404 for everyone else. */
export async function requireSuperAdmin(): Promise<AdminActor> {
  const user = await requireUser();
  try {
    await assertSuperAdmin(user.userId);
  } catch (e) {
    if (isAppError(e)) notFound();
    throw e;
  }
  if (!adminMfaSatisfied(user)) redirect("/account?mfa=required");
  const info = await requestInfo();
  return { userId: user.userId, ip: info.ip, userAgent: info.userAgent };
}

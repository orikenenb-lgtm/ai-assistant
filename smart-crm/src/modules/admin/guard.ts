import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { AppError } from "@/server/errors";
import { env } from "@/server/env";

/** The authenticated platform administrator performing an admin action. */
export type AdminActor = { userId: string; ip: string | null; userAgent: string | null };

/**
 * Outside development/test, platform powers require a second factor: the admin
 * must have MFA enrolled and the session must have passed it (aal2).
 */
export function adminMfaSatisfied(user: { mfaEnrolled: boolean; aal: string }): boolean {
  if (env().APP_ENV === "development" || env().APP_ENV === "test") return true;
  return user.mfaEnrolled && user.aal === "aal2";
}

/**
 * Every admin service function calls this first, so the console stays safe even
 * if a function is reached from an unexpected code path.
 */
export async function assertSuperAdmin(userId: string | null | undefined): Promise<void> {
  if (!userId) throw new AppError("FORBIDDEN", "admin.forbidden");
  const [p] = await db().select({ isSuperAdmin: schema.profiles.isSuperAdmin }).from(schema.profiles).where(eq(schema.profiles.id, userId)).limit(1);
  if (!p?.isSuperAdmin) throw new AppError("FORBIDDEN", "admin.forbidden");
}

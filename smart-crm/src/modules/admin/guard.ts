import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { AppError } from "@/server/errors";

/** The authenticated platform administrator performing an admin action. */
export type AdminActor = { userId: string; ip: string | null; userAgent: string | null };

/**
 * Every admin service function calls this first, so the console stays safe even
 * if a function is reached from an unexpected code path.
 */
export async function assertSuperAdmin(userId: string | null | undefined): Promise<void> {
  if (!userId) throw new AppError("FORBIDDEN", "admin.forbidden");
  const [p] = await db().select({ isSuperAdmin: schema.profiles.isSuperAdmin }).from(schema.profiles).where(eq(schema.profiles.id, userId)).limit(1);
  if (!p?.isSuperAdmin) throw new AppError("FORBIDDEN", "admin.forbidden");
}

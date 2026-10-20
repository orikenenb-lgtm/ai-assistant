import { eq } from "drizzle-orm";
import { z } from "zod";
import QRCode from "qrcode";
import { schema, withUserTx } from "@/server/db";
import { AppError } from "@/server/errors";
import type { AuthAdapter, SessionUser } from "@/server/auth/types";

export const profileSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  locale: z.enum(["he", "en"]),
  theme: z.enum(["light", "dark", "system"]),
});

export async function getProfile(userId: string) {
  return withUserTx(userId, async (tx) => {
    const [p] = await tx.select().from(schema.profiles).where(eq(schema.profiles.id, userId));
    if (!p) throw new AppError("NOT_FOUND", "errors.notFound");
    return { fullName: p.fullName, email: p.email, locale: p.locale as "he" | "en", theme: p.theme as "light" | "dark" | "system" };
  });
}

/** Profile writes go through RLS: users can only update their own row (column grants exclude is_super_admin). */
export async function updateProfile(userId: string, input: z.infer<typeof profileSchema>) {
  await withUserTx(userId, async (tx) => {
    const rows = await tx
      .update(schema.profiles)
      .set({ fullName: input.fullName, locale: input.locale, theme: input.theme })
      .where(eq(schema.profiles.id, userId))
      .returning({ id: schema.profiles.id });
    if (!rows.length) throw new AppError("NOT_FOUND", "errors.notFound");
  });
}

export type MfaEnrollment = { factorId: string; secret: string; qrDataUrl: string };

/** Starts TOTP enrollment; the QR code is rendered server-side as a data URL. */
export async function startMfaEnrollment(auth: AuthAdapter): Promise<MfaEnrollment> {
  const { factorId, secret, uri } = await auth.mfaEnroll();
  const qrDataUrl = await QRCode.toDataURL(uri, { errorCorrectionLevel: "M", margin: 1, width: 220 });
  return { factorId, secret, qrDataUrl };
}

export async function confirmMfaEnrollment(auth: AuthAdapter, input: { factorId: string; code: string }) {
  if (!(await auth.mfaVerifyEnrollment(input))) throw new AppError("VALIDATION", "auth.mfaInvalid", { code: ["auth.mfaInvalid"] });
}

/** Disabling MFA requires a session that already passed MFA (aal2). */
export async function disableMfa(auth: AuthAdapter, user: SessionUser, factorId: string) {
  if (user.aal !== "aal2") throw new AppError("FORBIDDEN", "account.mfaReauth");
  if (!(await auth.mfaUnenroll(factorId))) throw new AppError("VALIDATION", "errors.notFound");
}

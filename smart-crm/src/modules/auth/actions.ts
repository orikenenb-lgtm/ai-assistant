"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth, getSessionUser, requestInfo } from "@/server/auth";
import { publicAction, type ActionResult } from "@/server/action";
import { AppError } from "@/server/errors";
import { LOCALE_COOKIE } from "@/i18n/config";
import { db, schema } from "@/server/db";
import { eq } from "drizzle-orm";
import {
  changePasswordSchema,
  forgotSchema,
  mfaCodeSchema,
  resetSchema,
  safeNext,
  signInSchema,
  signUpSchema,
} from "./schemas";

export async function signInAction(input: unknown): Promise<ActionResult<{ status: string; redirectTo?: string }>> {
  return publicAction(input, signInSchema, async (data) => {
    const result = await auth().signIn({ email: data.email, password: data.password }, await requestInfo());
    if (result.status === "invalid_credentials") throw new AppError("UNAUTHENTICATED", "auth.invalidCredentials");
    if (result.status === "email_not_verified") return { status: "email_not_verified" };
    if (result.status === "mfa_required") return { status: "mfa_required", redirectTo: `/mfa?next=${encodeURIComponent(safeNext(data.next))}` };
    return { status: "ok", redirectTo: safeNext(data.next) };
  });
}

export async function signUpAction(input: unknown): Promise<ActionResult<{ email: string }>> {
  return publicAction(input, signUpSchema, async (data) => {
    await auth().signUp(
      { email: data.email, password: data.password, fullName: data.fullName, locale: data.locale },
      await requestInfo(),
    );
    return { email: data.email };
  });
}

export async function resendVerificationAction(input: unknown): Promise<ActionResult> {
  return publicAction(input, forgotSchema, async (data) => {
    await auth().resendVerification(data.email);
    return null;
  });
}

export async function requestPasswordResetAction(input: unknown): Promise<ActionResult> {
  return publicAction(input, forgotSchema, async (data) => {
    await auth().requestPasswordReset(data.email);
    return null;
  });
}

export async function completePasswordResetAction(input: unknown): Promise<ActionResult> {
  return publicAction(input, resetSchema, async (data) => {
    const ok = await auth().completePasswordReset({ token: data.token, password: data.password });
    if (!ok) throw new AppError("VALIDATION", "auth.invalidLink");
    return null;
  });
}

export async function mfaChallengeAction(input: unknown): Promise<ActionResult> {
  return publicAction(input, mfaCodeSchema, async (data) => {
    if (!(await getSessionUser())) throw new AppError("UNAUTHENTICATED", "errors.unauthenticated");
    if (!(await auth().mfaChallenge(data.code))) throw new AppError("VALIDATION", "auth.mfaInvalid");
    return null;
  });
}

export async function signOutAction(): Promise<void> {
  await auth().signOut("local");
  redirect("/login");
}

export async function changePasswordAction(input: unknown): Promise<ActionResult> {
  return publicAction(input, changePasswordSchema, async (data) => {
    if (!(await getSessionUser())) throw new AppError("UNAUTHENTICATED", "errors.unauthenticated");
    const ok = await auth().changePassword({ currentPassword: data.currentPassword, newPassword: data.newPassword });
    if (!ok) throw new AppError("VALIDATION", "auth.invalidCredentials", { currentPassword: ["auth.invalidCredentials"] });
    return null;
  });
}

export async function setLocaleAction(input: unknown): Promise<ActionResult> {
  return publicAction(input, z.object({ locale: z.enum(["he", "en"]) }), async ({ locale }) => {
    (await cookies()).set(LOCALE_COOKIE, locale, { path: "/", maxAge: 365 * 86400, sameSite: "lax" });
    const user = await getSessionUser();
    if (user) await db().update(schema.profiles).set({ locale }).where(eq(schema.profiles.id, user.userId));
    return null;
  });
}

"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth, requireUser } from "@/server/auth";
import { publicAction, type ActionResult } from "@/server/action";
import { AppError } from "@/server/errors";
import { LOCALE_COOKIE } from "@/i18n/config";
import { confirmMfaEnrollment, disableMfa, profileSchema, startMfaEnrollment, updateProfile, type MfaEnrollment } from "./service";

export async function updateProfileAction(input: unknown): Promise<ActionResult> {
  return publicAction(input, profileSchema, async (data) => {
    const user = await requireUser();
    await updateProfile(user.userId, data);
    (await cookies()).set(LOCALE_COOKIE, data.locale, { path: "/", maxAge: 365 * 86400, sameSite: "lax" });
    revalidatePath("/", "layout");
    return null;
  });
}

export async function startMfaEnrollmentAction(): Promise<ActionResult<MfaEnrollment>> {
  return publicAction({}, z.object({}), async () => {
    const user = await requireUser();
    if (user.mfaEnrolled) throw new AppError("CONFLICT", "account.mfaAlreadyEnabled");
    return startMfaEnrollment(auth());
  });
}

export async function confirmMfaEnrollmentAction(input: unknown): Promise<ActionResult> {
  return publicAction(input, z.object({ factorId: z.string().min(1).max(100), code: z.string().trim().regex(/^\d{6}$/) }), async (data) => {
    await requireUser();
    await confirmMfaEnrollment(auth(), data);
    revalidatePath("/account");
    return null;
  });
}

export async function disableMfaAction(input: unknown): Promise<ActionResult> {
  return publicAction(input, z.object({ factorId: z.string().min(1).max(100) }), async ({ factorId }) => {
    const user = await requireUser();
    await disableMfa(auth(), user, factorId);
    revalidatePath("/account");
    return null;
  });
}

export async function revokeSessionAction(input: unknown): Promise<ActionResult> {
  return publicAction(input, z.object({ sessionId: z.uuid() }), async ({ sessionId }) => {
    const user = await requireUser();
    if (sessionId === user.sessionId) throw new AppError("VALIDATION", "account.cannotRevokeCurrent");
    await auth().revokeSession(sessionId);
    revalidatePath("/account");
    return null;
  });
}

export async function signOutOtherSessionsAction(): Promise<ActionResult> {
  return publicAction({}, z.object({}), async () => {
    await requireUser();
    await auth().signOut("others");
    revalidatePath("/account");
    return null;
  });
}

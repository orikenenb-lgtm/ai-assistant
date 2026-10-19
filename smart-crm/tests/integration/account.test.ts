import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, db, schema, withUserTx } from "@/server/db";
import { LocalAuthAdapter } from "@/server/auth/local";
import { currentStep, hotp, totp } from "@/server/auth/totp";
import { confirmMfaEnrollment, disableMfa, getProfile, startMfaEnrollment, updateProfile } from "@/modules/account/service";
import { createUser, extractToken, latestEmail, memoryJar, uniqueEmail } from "../support/factories";

const req = { ip: `198.51.100.${Math.floor(Math.random() * 250) + 1}`, userAgent: "vitest" };
const PASSWORD = "Acc0unt!Password";

async function signedInAdapter() {
  const jar = memoryJar();
  const auth = new LocalAuthAdapter(async () => jar);
  const email = uniqueEmail("account");
  await auth.signUp({ email, password: PASSWORD, fullName: "חשבון", locale: "he" }, req);
  await auth.confirm({ token: extractToken((await latestEmail(email)).text_body), type: "email" });
  await auth.signIn({ email, password: PASSWORD }, req);
  return { auth, jar, email };
}

afterAll(async () => {
  await closeDb();
});

describe("profile", () => {
  it("updates the signed-in user's own profile only", async () => {
    const u = await createUser({ fullName: "Old Name" });
    const other = await createUser({ fullName: "Other" });
    await updateProfile(u.id, { fullName: "שם חדש", locale: "en", theme: "dark" });
    expect(await getProfile(u.id)).toMatchObject({ fullName: "שם חדש", locale: "en", theme: "dark" });
    // RLS: a user cannot write someone else's profile row even with a crafted query.
    const updated = await withUserTx(u.id, (tx) =>
      tx.update(schema.profiles).set({ fullName: "hacked" }).where(eq(schema.profiles.id, other.id)).returning(),
    );
    expect(updated).toEqual([]);
    const [o] = await db().select().from(schema.profiles).where(eq(schema.profiles.id, other.id));
    expect(o.fullName).toBe("Other");
  });
});

describe("MFA via the account service", () => {
  it("enrolls with a QR code, verifies, and disables only from an aal2 session", async () => {
    const { auth, email } = await signedInAdapter();
    const enrollment = await startMfaEnrollment(auth);
    expect(enrollment.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(enrollment.secret).toMatch(/^[A-Z2-7]{32}$/);

    await expect(confirmMfaEnrollment(auth, { factorId: enrollment.factorId, code: "000000" === totp(enrollment.secret) ? "111111" : "000000" })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await confirmMfaEnrollment(auth, { factorId: enrollment.factorId, code: totp(enrollment.secret) });
    const user = await auth.getSessionUser();
    expect(user).toMatchObject({ aal: "aal2", mfaEnrolled: true });

    // A fresh aal1 session cannot disable MFA.
    const jar2 = memoryJar();
    const second = new LocalAuthAdapter(async () => jar2);
    expect((await second.signIn({ email, password: PASSWORD }, req)).status).toBe("mfa_required");
    const aal1 = (await second.getSessionUser())!;
    await expect(disableMfa(second, aal1, enrollment.factorId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await second.mfaChallenge(hotp(enrollment.secret, currentStep() + 1))).toBe(true);

    const [factor] = await auth.mfaFactors();
    await disableMfa(auth, user!, factor.id);
    expect(await auth.mfaFactors()).toEqual([]);
  });
});

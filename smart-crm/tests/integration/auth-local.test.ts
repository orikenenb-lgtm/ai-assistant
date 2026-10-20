import { afterAll, describe, expect, it } from "vitest";
import { LocalAuthAdapter, SESSION_COOKIE } from "@/server/auth/local";
import { totp, currentStep, hotp } from "@/server/auth/totp";
import { closeDb, sqlClient } from "@/server/db";
import { extractToken, latestEmail, memoryJar, uniqueEmail } from "../support/factories";

// Fresh documentation-range IP per test file run so rate limits do not interfere.
const req = { ip: `203.0.113.${Math.floor(Math.random() * 250) + 1}`, userAgent: "vitest" };
const PASSWORD = "Sup3rSecret!pw";

function newAdapter() {
  const jar = memoryJar();
  return { jar, auth: new LocalAuthAdapter(async () => jar) };
}

async function registerVerified(email: string) {
  const { auth } = newAdapter();
  await auth.signUp({ email, password: PASSWORD, fullName: "דנה כהן", locale: "he" }, req);
  const mail = await latestEmail(email);
  expect(mail.template).toBe("verify_email");
  const confirmed = await auth.confirm({ token: extractToken(mail.text_body), type: "email" });
  expect(confirmed).not.toBeNull();
}

afterAll(async () => {
  await closeDb();
});

describe("LocalAuthAdapter", () => {
  it("signs up, blocks login until verified, then signs in and out", async () => {
    const email = uniqueEmail("signup");
    const { auth, jar } = newAdapter();
    await auth.signUp({ email, password: PASSWORD, fullName: "דנה", locale: "he" }, req);

    expect(await auth.signIn({ email, password: PASSWORD }, req)).toEqual({ status: "email_not_verified" });
    expect(jar.values.has(SESSION_COOKIE)).toBe(false);

    const mail = await latestEmail(email);
    expect(await auth.confirm({ token: extractToken(mail.text_body), type: "email" })).not.toBeNull();
    // Tokens are single use.
    expect(await auth.confirm({ token: extractToken(mail.text_body), type: "email" })).toBeNull();

    expect(await auth.signIn({ email, password: PASSWORD }, req)).toEqual({ status: "ok" });
    const user = await auth.getSessionUser();
    expect(user).toMatchObject({ email, emailVerified: true, aal: "aal1", mfaEnrolled: false });

    // Profile was created by the auth.users trigger.
    const [profile] = await sqlClient()`select full_name, locale from public.profiles where id = ${user!.userId}`;
    expect(profile).toMatchObject({ full_name: "דנה", locale: "he" });

    await auth.signOut("local");
    expect(await auth.getSessionUser()).toBeNull();
  });

  it("rejects wrong passwords and unknown users identically", async () => {
    const email = uniqueEmail("wrongpw");
    await registerVerified(email);
    const { auth } = newAdapter();
    expect(await auth.signIn({ email, password: "nope-nope-1" }, req)).toEqual({ status: "invalid_credentials" });
    expect(await auth.signIn({ email: uniqueEmail("ghost"), password: PASSWORD }, req)).toEqual({ status: "invalid_credentials" });
  });

  it("counts only failed sign-ins, reports rate limiting, and keys the limit per account+IP", async () => {
    const email = uniqueEmail("limits");
    await registerVerified(email);
    const { auth } = newAdapter();
    // Successful logins do not consume the budget.
    for (let i = 0; i < 12; i++) expect((await auth.signIn({ email, password: PASSWORD }, req)).status).toBe("ok");
    for (let i = 0; i < 10; i++) expect((await auth.signIn({ email, password: "wrong-pass-1" }, req)).status).toBe("invalid_credentials");
    expect((await auth.signIn({ email, password: PASSWORD }, req)).status).toBe("rate_limited");
    // The owner signing in from another address is not locked out by someone else's failures.
    const other = { ip: `198.51.100.${Math.floor(Math.random() * 250) + 1}`, userAgent: "vitest" };
    expect((await auth.signIn({ email, password: PASSWORD }, other)).status).toBe("ok");
  });

  it("does not reveal existing accounts on sign-up", async () => {
    const email = uniqueEmail("dupe");
    await registerVerified(email);
    const { auth } = newAdapter();
    await expect(auth.signUp({ email, password: PASSWORD, fullName: "x", locale: "en" }, req)).resolves.toBeUndefined();
    expect((await latestEmail(email)).template).toBe("account_exists");
    const [{ count }] = await sqlClient()`select count(*)::int as count from auth.users where lower(email) = lower(${email})`;
    expect(count).toBe(1);
  });

  it("resets a password, revoking existing sessions", async () => {
    const email = uniqueEmail("reset");
    await registerVerified(email);
    const first = newAdapter();
    expect((await first.auth.signIn({ email, password: PASSWORD }, req)).status).toBe("ok");

    const other = newAdapter();
    await other.auth.requestPasswordReset(email);
    const token = extractToken((await latestEmail(email)).text_body);
    expect(await other.auth.completePasswordReset({ token, password: "BrandNew!pass9" })).toBe(true);
    expect(await other.auth.completePasswordReset({ token, password: "Again!pass99" })).toBe(false);

    expect(await first.auth.getSessionUser()).toBeNull();
    expect((await other.auth.signIn({ email, password: PASSWORD }, req)).status).toBe("invalid_credentials");
    expect((await other.auth.signIn({ email, password: "BrandNew!pass9" }, req)).status).toBe("ok");
  });

  it("changes password only with the current password", async () => {
    const email = uniqueEmail("change");
    await registerVerified(email);
    const { auth } = newAdapter();
    await auth.signIn({ email, password: PASSWORD }, req);
    expect(await auth.changePassword({ currentPassword: "wrong-pass-1", newPassword: "Another!pass1" })).toBe(false);
    expect(await auth.changePassword({ currentPassword: PASSWORD, newPassword: "Another!pass1" })).toBe(true);
    expect(await auth.getSessionUser()).not.toBeNull();
  });

  it("enrolls TOTP MFA and requires it on the next login (with replay protection)", async () => {
    const email = uniqueEmail("mfa");
    await registerVerified(email);
    const a = newAdapter();
    await a.auth.signIn({ email, password: PASSWORD }, req);
    const { factorId, secret, uri } = await a.auth.mfaEnroll();
    expect(uri).toContain("otpauth://totp/");
    expect(await a.auth.mfaVerifyEnrollment({ factorId, code: "000000" === totp(secret) ? "111111" : "000000" })).toBe(false);
    expect(await a.auth.mfaVerifyEnrollment({ factorId, code: totp(secret) })).toBe(true);
    expect(await a.auth.getSessionUser()).toMatchObject({ aal: "aal2", mfaEnrolled: true });

    const b = newAdapter();
    expect(await b.auth.signIn({ email, password: PASSWORD }, req)).toEqual({ status: "mfa_required" });
    expect(await b.auth.getSessionUser()).toMatchObject({ aal: "aal1", mfaEnrolled: true });
    // The code already used for enrollment cannot be replayed.
    expect(await b.auth.mfaChallenge(totp(secret))).toBe(false);
    const nextCode = hotp(secret, currentStep() + 1);
    expect(await b.auth.mfaChallenge(nextCode)).toBe(true);
    expect(await b.auth.getSessionUser()).toMatchObject({ aal: "aal2" });

    const sessions = await b.auth.listSessions();
    expect(sessions.length).toBeGreaterThanOrEqual(2);
    expect(sessions.filter((s) => s.current)).toHaveLength(1);
    await b.auth.signOut("others");
    expect(await a.auth.getSessionUser()).toBeNull();
    expect(await b.auth.getSessionUser()).not.toBeNull();
  });
});

describe("profile bootstrap", () => {
  it("stores user metadata as a JSON object so the profile trigger picks up the name", async () => {
    const { createUser } = await import("../support/factories");
    const u = await createUser({ fullName: "מיכל אברהם" });
    const [row] = await sqlClient()`
      select p.full_name, jsonb_typeof(u.raw_user_meta_data) as kind
      from public.profiles p join auth.users u on u.id = p.id where p.id = ${u.id}`;
    expect(row).toMatchObject({ full_name: "מיכל אברהם", kind: "object" });
  });
});

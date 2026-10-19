/**
 * SupabaseAuthAdapter — staging/production authentication through Supabase Auth.
 * Cookie-based sessions via @supabase/ssr; proxy.ts refreshes tokens on each
 * request. Verification/recovery emails are sent by Supabase using templates
 * that link to /auth/confirm?token_hash={{ .TokenHash }}&type=email|recovery
 * (see docs/SETUP.md).
 */
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "../env";
import { hitRateLimit } from "../rate-limit";
import { verifyPayload } from "../crypto";
import type { AuthAdapter, MfaFactor, RequestInfo, SessionUser, SignInResult } from "./types";

export type SupabaseCookieStore = {
  getAll(): { name: string; value: string }[];
  set(name: string, value: string, options: CookieOptions): void;
};

export function createSupabaseServerClient(store: SupabaseCookieStore): SupabaseClient {
  const e = env();
  return createServerClient(e.NEXT_PUBLIC_SUPABASE_URL!, e.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookieOptions: { sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30 },
    cookies: {
      getAll: () => store.getAll(),
      setAll: (cookies) => {
        try {
          for (const c of cookies) store.set(c.name, c.value, c.options);
        } catch {
          // Called from a Server Component: cookies are read-only there; proxy.ts refreshes them.
        }
      },
    },
  });
}

export class SupabaseAuthAdapter implements AuthAdapter {
  readonly kind = "supabase" as const;

  constructor(private readonly store: () => Promise<SupabaseCookieStore>) {}

  private async client() {
    return createSupabaseServerClient(await this.store());
  }

  async getSessionUser(): Promise<SessionUser | null> {
    const sb = await this.client();
    const { data, error } = await sb.auth.getUser();
    if (error || !data.user) return null;
    const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    return {
      userId: data.user.id,
      email: data.user.email ?? "",
      emailVerified: Boolean(data.user.email_confirmed_at),
      aal: aal?.currentLevel === "aal2" ? "aal2" : "aal1",
      mfaEnrolled: aal?.nextLevel === "aal2",
      sessionId: null,
    };
  }

  async signUp(input: { email: string; password: string; fullName: string; locale: "he" | "en" }, req: RequestInfo) {
    const limit = await hitRateLimit(`signup:${req.ip ?? "unknown"}`, env().AUTH_SIGNUP_LIMIT_PER_HOUR, 3600);
    if (!limit.allowed) return;
    const sb = await this.client();
    // Supabase hides whether the address already exists (no enumeration).
    await sb.auth.signUp({
      email: input.email,
      password: input.password,
      options: { data: { full_name: input.fullName, locale: input.locale }, emailRedirectTo: `${env().APP_URL}/auth/confirm` },
    });
  }

  async signIn(input: { email: string; password: string }, req: RequestInfo): Promise<SignInResult> {
    // Per account+IP (tight) so a third party cannot lock the account owner out from elsewhere;
    // per account (loose) against distributed guessing; per IP against spraying.
    const email = input.email.toLowerCase();
    const byAccountIp = await hitRateLimit(`login:${email}:${req.ip ?? "unknown"}`, 10, 900);
    const byAccount = await hitRateLimit(`login:${email}`, 100, 900);
    const byIp = await hitRateLimit(`login-ip:${req.ip ?? "unknown"}`, 50, 900);
    if (!byAccountIp.allowed || !byAccount.allowed || !byIp.allowed) return { status: "invalid_credentials" };
    const sb = await this.client();
    const { error } = await sb.auth.signInWithPassword({ email: input.email, password: input.password });
    if (error) {
      if (error.code === "email_not_confirmed") return { status: "email_not_verified" };
      return { status: "invalid_credentials" };
    }
    const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    return aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2" ? { status: "mfa_required" } : { status: "ok" };
  }

  async signOut(scope: "local" | "others" | "global") {
    const sb = await this.client();
    await sb.auth.signOut({ scope });
  }

  async resendVerification(email: string) {
    const limit = await hitRateLimit(`resend-verify:${email.toLowerCase()}`, 3, 3600);
    if (!limit.allowed) return;
    const sb = await this.client();
    await sb.auth.resend({ type: "signup", email, options: { emailRedirectTo: `${env().APP_URL}/auth/confirm` } });
  }

  async confirm(input: { token: string; type: "email" | "recovery" }) {
    const sb = await this.client();
    const { data, error } = await sb.auth.verifyOtp({ token_hash: input.token, type: input.type });
    if (error || !data.user) return null;
    return { userId: data.user.id };
  }

  async requestPasswordReset(email: string) {
    const limit = await hitRateLimit(`reset:${email.toLowerCase()}`, 5, 3600);
    if (!limit.allowed) return;
    const sb = await this.client();
    await sb.auth.resetPasswordForEmail(email, { redirectTo: `${env().APP_URL}/auth/confirm?next=/reset-password` });
  }

  async completePasswordReset(input: { token?: string; password: string; recoveryProof?: string | null }) {
    const sb = await this.client();
    // A session alone is not enough: the reset must follow a recovery link (signed proof set by /auth/confirm).
    const { data } = await sb.auth.getUser();
    const proof = input.recoveryProof ? verifyPayload<{ userId: string }>("pw-recovery", input.recoveryProof) : null;
    if (!data.user || !proof || proof.userId !== data.user.id) return false;
    const { error } = await sb.auth.updateUser({ password: input.password });
    if (error) return false;
    await sb.auth.signOut({ scope: "others" });
    return true;
  }

  async changePassword(input: { currentPassword: string; newPassword: string }) {
    const sb = await this.client();
    const { data } = await sb.auth.getUser();
    if (!data.user?.email) return false;
    const check = await sb.auth.signInWithPassword({ email: data.user.email, password: input.currentPassword });
    if (check.error) return false;
    const { error } = await sb.auth.updateUser({ password: input.newPassword });
    if (error) return false;
    await sb.auth.signOut({ scope: "others" });
    return true;
  }

  async mfaEnroll() {
    const sb = await this.client();
    const { data, error } = await sb.auth.mfa.enroll({ factorType: "totp" });
    if (error || !data) throw new Error(error?.message ?? "MFA enrollment failed");
    return { factorId: data.id, secret: data.totp.secret, uri: data.totp.uri };
  }

  async mfaVerifyEnrollment(input: { factorId: string; code: string }) {
    const sb = await this.client();
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: input.factorId, code: input.code });
    return !error;
  }

  async mfaChallenge(code: string) {
    const sb = await this.client();
    const { data } = await sb.auth.mfa.listFactors();
    const factor = data?.totp?.find((f) => f.status === "verified");
    if (!factor) return false;
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
    return !error;
  }

  async mfaUnenroll(factorId: string) {
    const sb = await this.client();
    const { error } = await sb.auth.mfa.unenroll({ factorId });
    return !error;
  }

  async mfaFactors(): Promise<MfaFactor[]> {
    const sb = await this.client();
    const { data } = await sb.auth.mfa.listFactors();
    return (data?.totp ?? [])
      .filter((f) => f.status === "verified")
      .map((f) => ({ id: f.id, status: "verified" as const, createdAt: f.created_at ? new Date(f.created_at) : null }));
  }

  async listSessions() {
    return null;
  }

  async revokeSession() {
    // Supabase exposes "sign out other sessions" (signOut scope "others") instead.
  }
}

/**
 * LocalAuthAdapter — DEVELOPMENT & CI ONLY.
 *
 * A complete email/password + TOTP implementation backed by the local Supabase
 * stub (auth.users, auth.local_*), so the product can be run and tested end to
 * end without cloud credentials. env() refuses AUTH_PROVIDER=local when
 * APP_ENV=production; production uses SupabaseAuthAdapter.
 */
import { sqlClient } from "../db";
import { env } from "../env";
import { randomToken, sha256Hex } from "../crypto";
import { sendEmail } from "../email";
import { hitRateLimit } from "../rate-limit";
import { hashPassword, verifyPassword } from "./password";
import { generateSecret, otpauthUri, verifyTotp } from "./totp";
import type { AuthAdapter, MfaFactor, RequestInfo, SessionInfo, SessionUser, SignInResult } from "./types";

export type CookieJar = {
  get(name: string): string | undefined;
  set(name: string, value: string, opts: { maxAge: number }): void;
  delete(name: string): void;
};

export const SESSION_COOKIE = "crm_session";
const SESSION_TTL_SECONDS = 14 * 24 * 3600;
const VERIFY_TTL_SECONDS = 24 * 3600;
const RESET_TTL_SECONDS = 3600;

type UserRow = {
  id: string;
  email: string;
  encrypted_password: string | null;
  email_confirmed_at: Date | null;
  full_name: string | null;
  locale: string | null;
};

export class LocalAuthAdapter implements AuthAdapter {
  readonly kind = "local" as const;

  constructor(private readonly jar: () => Promise<CookieJar>) {}

  private sql() {
    return sqlClient();
  }

  private async findUserByEmail(email: string): Promise<UserRow | undefined> {
    const rows = await this.sql()<UserRow[]>`
      select u.id, u.email, u.encrypted_password, u.email_confirmed_at,
             p.full_name, p.locale
      from auth.users u left join public.profiles p on p.id = u.id
      where lower(u.email) = lower(${email})`;
    return rows[0];
  }

  private async createToken(userId: string, purpose: "email_verification" | "password_reset", ttl: number) {
    const token = randomToken(32);
    await this.sql()`
      insert into auth.local_tokens (user_id, purpose, token_hash, expires_at)
      values (${userId}, ${purpose}, ${sha256Hex(token)}, now() + make_interval(secs => ${ttl}))`;
    return token;
  }

  private async createSession(userId: string, aal: "aal1" | "aal2", req: RequestInfo) {
    const token = randomToken(32);
    await this.sql()`
      insert into auth.local_sessions (user_id, token_hash, aal, user_agent, ip, expires_at)
      values (${userId}, ${sha256Hex(token)}, ${aal}, ${req.userAgent?.slice(0, 300) ?? null}, ${req.ip ?? null},
              now() + make_interval(secs => ${SESSION_TTL_SECONDS}))`;
    await this.sql()`update auth.users set last_sign_in_at = now() where id = ${userId}`;
    (await this.jar()).set(SESSION_COOKIE, token, { maxAge: SESSION_TTL_SECONDS });
  }

  private async currentSessionRow() {
    const token = (await this.jar()).get(SESSION_COOKIE);
    if (!token) return undefined;
    const rows = await this.sql()<
      { id: string; user_id: string; aal: "aal1" | "aal2"; email: string; email_confirmed_at: Date | null; last_seen_at: Date; mfa: boolean }[]
    >`
      select s.id, s.user_id, s.aal, u.email, u.email_confirmed_at, s.last_seen_at,
             exists (select 1 from auth.local_mfa_factors f where f.user_id = u.id and f.status = 'verified') as mfa
      from auth.local_sessions s
      join auth.users u on u.id = s.user_id
      where s.token_hash = ${sha256Hex(token)}
        and s.revoked_at is null and s.expires_at > now()
        and (u.banned_until is null or u.banned_until < now())`;
    return rows[0];
  }

  async getSessionUser(): Promise<SessionUser | null> {
    const s = await this.currentSessionRow();
    if (!s) return null;
    if (Date.now() - new Date(s.last_seen_at).getTime() > 5 * 60_000) {
      await this.sql()`update auth.local_sessions set last_seen_at = now() where id = ${s.id}`;
    }
    return {
      userId: s.user_id,
      email: s.email,
      emailVerified: s.email_confirmed_at !== null,
      aal: s.aal,
      mfaEnrolled: s.mfa,
      sessionId: s.id,
    };
  }

  async signUp(input: { email: string; password: string; fullName: string; locale: "he" | "en" }, req: RequestInfo) {
    const limit = await hitRateLimit(`signup:${req.ip ?? "unknown"}`, env().AUTH_SIGNUP_LIMIT_PER_HOUR, 3600);
    if (!limit.allowed) return; // silently drop; response is identical either way
    const existing = await this.findUserByEmail(input.email);
    const base = env().APP_URL;
    if (existing) {
      await sendEmail({
        to: existing.email,
        template: "account_exists",
        data: { name: existing.full_name ?? "", loginUrl: `${base}/login`, resetUrl: `${base}/forgot-password` },
        locale: existing.locale === "en" ? "en" : "he",
      });
      return;
    }
    const passwordHash = await hashPassword(input.password);
    const [user] = await this.sql()<{ id: string }[]>`
      insert into auth.users (email, encrypted_password, raw_user_meta_data)
      values (${input.email.toLowerCase()}, ${passwordHash}, ${JSON.stringify({ full_name: input.fullName, locale: input.locale })}::text::jsonb)
      returning id`;
    const token = await this.createToken(user.id, "email_verification", VERIFY_TTL_SECONDS);
    await sendEmail({
      to: input.email,
      template: "verify_email",
      data: { name: input.fullName, url: `${base}/auth/confirm?type=email&token=${token}` },
      locale: input.locale,
    });
  }

  async signIn(input: { email: string; password: string }, req: RequestInfo): Promise<SignInResult> {
    const byAccount = await hitRateLimit(`login:${input.email.toLowerCase()}`, 10, 900);
    const byIp = await hitRateLimit(`login-ip:${req.ip ?? "unknown"}`, 50, 900);
    if (!byAccount.allowed || !byIp.allowed) return { status: "invalid_credentials" };
    const user = await this.findUserByEmail(input.email);
    const ok = await verifyPassword(input.password, user?.encrypted_password ?? null);
    if (!user || !ok) return { status: "invalid_credentials" };
    if (!user.email_confirmed_at) return { status: "email_not_verified" };
    const [{ mfa }] = await this.sql()<{ mfa: boolean }[]>`
      select exists (select 1 from auth.local_mfa_factors where user_id = ${user.id} and status = 'verified') as mfa`;
    await this.createSession(user.id, "aal1", req);
    return mfa ? { status: "mfa_required" } : { status: "ok" };
  }

  async signOut(scope: "local" | "others" | "global") {
    const s = await this.currentSessionRow();
    const jar = await this.jar();
    if (s) {
      if (scope === "local") await this.sql()`update auth.local_sessions set revoked_at = now() where id = ${s.id}`;
      if (scope === "others") {
        await this.sql()`update auth.local_sessions set revoked_at = now()
                         where user_id = ${s.user_id} and id <> ${s.id} and revoked_at is null`;
      }
      if (scope === "global") {
        await this.sql()`update auth.local_sessions set revoked_at = now() where user_id = ${s.user_id} and revoked_at is null`;
      }
    }
    if (scope !== "others") jar.delete(SESSION_COOKIE);
  }

  async resendVerification(email: string) {
    const limit = await hitRateLimit(`resend-verify:${email.toLowerCase()}`, 3, 3600);
    if (!limit.allowed) return;
    const user = await this.findUserByEmail(email);
    if (!user || user.email_confirmed_at) return;
    const token = await this.createToken(user.id, "email_verification", VERIFY_TTL_SECONDS);
    await sendEmail({
      to: user.email,
      template: "verify_email",
      data: { name: user.full_name ?? "", url: `${env().APP_URL}/auth/confirm?type=email&token=${token}` },
      locale: user.locale === "en" ? "en" : "he",
    });
  }

  /** Validates a one-time token. Email tokens are consumed here; recovery tokens on reset. */
  async confirm(input: { token: string; type: "email" | "recovery" }) {
    const purpose = input.type === "email" ? "email_verification" : "password_reset";
    const rows = await this.sql()<{ id: string; user_id: string }[]>`
      select id, user_id from auth.local_tokens
      where token_hash = ${sha256Hex(input.token)} and purpose = ${purpose}
        and used_at is null and expires_at > now()`;
    const row = rows[0];
    if (!row) return null;
    if (input.type === "email") {
      await this.sql().begin(async (tx) => {
        await tx`update auth.local_tokens set used_at = now() where id = ${row.id}`;
        await tx`update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()) where id = ${row.user_id}`;
      });
    }
    return { userId: row.user_id };
  }

  async requestPasswordReset(email: string) {
    const limit = await hitRateLimit(`reset:${email.toLowerCase()}`, 5, 3600);
    if (!limit.allowed) return;
    const user = await this.findUserByEmail(email);
    if (!user) return;
    const token = await this.createToken(user.id, "password_reset", RESET_TTL_SECONDS);
    await sendEmail({
      to: user.email,
      template: "reset_password",
      data: { name: user.full_name ?? "", url: `${env().APP_URL}/reset-password?token=${token}` },
      locale: user.locale === "en" ? "en" : "he",
    });
  }

  async completePasswordReset(input: { token?: string; password: string }) {
    if (!input.token) return false;
    const hash = await hashPassword(input.password);
    return this.sql().begin(async (tx) => {
      const rows = await tx<{ id: string; user_id: string }[]>`
        update auth.local_tokens set used_at = now()
        where token_hash = ${sha256Hex(input.token!)} and purpose = 'password_reset'
          and used_at is null and expires_at > now()
        returning id, user_id`;
      const row = rows[0];
      if (!row) return false;
      // Proving inbox ownership also verifies the address.
      await tx`update auth.users set encrypted_password = ${hash}, email_confirmed_at = coalesce(email_confirmed_at, now()),
               updated_at = now() where id = ${row.user_id}`;
      await tx`update auth.local_sessions set revoked_at = now() where user_id = ${row.user_id} and revoked_at is null`;
      await tx`update auth.local_tokens set used_at = now() where user_id = ${row.user_id} and purpose = 'password_reset' and used_at is null`;
      return true;
    });
  }

  async changePassword(input: { currentPassword: string; newPassword: string }) {
    const s = await this.currentSessionRow();
    if (!s) return false;
    const [user] = await this.sql()<{ encrypted_password: string | null }[]>`
      select encrypted_password from auth.users where id = ${s.user_id}`;
    if (!(await verifyPassword(input.currentPassword, user?.encrypted_password ?? null))) return false;
    const hash = await hashPassword(input.newPassword);
    await this.sql().begin(async (tx) => {
      await tx`update auth.users set encrypted_password = ${hash}, updated_at = now() where id = ${s.user_id}`;
      await tx`update auth.local_sessions set revoked_at = now() where user_id = ${s.user_id} and id <> ${s.id} and revoked_at is null`;
    });
    return true;
  }

  async mfaEnroll() {
    const s = await this.currentSessionRow();
    if (!s) throw new Error("not signed in");
    const secret = generateSecret();
    await this.sql()`delete from auth.local_mfa_factors where user_id = ${s.user_id} and status = 'unverified'`;
    const [f] = await this.sql()<{ id: string }[]>`
      insert into auth.local_mfa_factors (user_id, secret) values (${s.user_id}, ${secret}) returning id`;
    return { factorId: f.id, secret, uri: otpauthUri(secret, s.email) };
  }

  async mfaVerifyEnrollment(input: { factorId: string; code: string }) {
    const s = await this.currentSessionRow();
    if (!s) return false;
    const limit = await hitRateLimit(`mfa:${s.user_id}`, 10, 300);
    if (!limit.allowed) return false;
    const [f] = await this.sql()<{ id: string; secret: string }[]>`
      select id, secret from auth.local_mfa_factors
      where id = ${input.factorId} and user_id = ${s.user_id} and status = 'unverified'`;
    if (!f) return false;
    const step = verifyTotp(f.secret, input.code);
    if (step === null) return false;
    await this.sql().begin(async (tx) => {
      await tx`update auth.local_mfa_factors set status = 'verified', last_used_step = ${step} where id = ${f.id}`;
      await tx`update auth.local_sessions set aal = 'aal2' where id = ${s.id}`;
    });
    return true;
  }

  async mfaChallenge(code: string) {
    const s = await this.currentSessionRow();
    if (!s) return false;
    const limit = await hitRateLimit(`mfa:${s.user_id}`, 10, 300);
    if (!limit.allowed) return false;
    const factors = await this.sql()<{ id: string; secret: string; last_used_step: string | null }[]>`
      select id, secret, last_used_step from auth.local_mfa_factors where user_id = ${s.user_id} and status = 'verified'`;
    for (const f of factors) {
      const step = verifyTotp(f.secret, code, { lastUsedStep: f.last_used_step === null ? null : Number(f.last_used_step) });
      if (step !== null) {
        await this.sql().begin(async (tx) => {
          await tx`update auth.local_mfa_factors set last_used_step = ${step} where id = ${f.id}`;
          await tx`update auth.local_sessions set aal = 'aal2' where id = ${s.id}`;
        });
        return true;
      }
    }
    return false;
  }

  async mfaUnenroll(factorId: string) {
    const s = await this.currentSessionRow();
    if (!s || s.aal !== "aal2") return false;
    const rows = await this.sql()`delete from auth.local_mfa_factors where id = ${factorId} and user_id = ${s.user_id} returning id`;
    return rows.length > 0;
  }

  async mfaFactors(): Promise<MfaFactor[]> {
    const s = await this.currentSessionRow();
    if (!s) return [];
    const rows = await this.sql()<{ id: string; status: "verified" | "unverified"; created_at: Date }[]>`
      select id, status, created_at from auth.local_mfa_factors where user_id = ${s.user_id} and status = 'verified' order by created_at`;
    return rows.map((r) => ({ id: r.id, status: r.status, createdAt: r.created_at }));
  }

  async listSessions(): Promise<SessionInfo[]> {
    const s = await this.currentSessionRow();
    if (!s) return [];
    const rows = await this.sql()<{ id: string; user_agent: string | null; ip: string | null; created_at: Date; last_seen_at: Date }[]>`
      select id, user_agent, ip, created_at, last_seen_at from auth.local_sessions
      where user_id = ${s.user_id} and revoked_at is null and expires_at > now()
      order by last_seen_at desc`;
    return rows.map((r) => ({
      id: r.id,
      current: r.id === s.id,
      userAgent: r.user_agent,
      ip: r.ip,
      createdAt: r.created_at,
      lastSeenAt: r.last_seen_at,
    }));
  }

  async revokeSession(sessionId: string) {
    const s = await this.currentSessionRow();
    if (!s) return;
    await this.sql()`update auth.local_sessions set revoked_at = now()
                     where id = ${sessionId} and user_id = ${s.user_id} and revoked_at is null`;
  }
}

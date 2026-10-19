import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "../env";
import { LocalAuthAdapter, type CookieJar } from "./local";
import { SupabaseAuthAdapter, type SupabaseCookieStore } from "./supabase";
import type { AuthAdapter, RequestInfo, SessionUser } from "./types";

const secureCookies = () => env().APP_URL.startsWith("https://");

async function cookieJar(): Promise<CookieJar> {
  const store = await cookies();
  return {
    get: (name) => store.get(name)?.value,
    set: (name, value, opts) =>
      store.set(name, value, { httpOnly: true, sameSite: "lax", secure: secureCookies(), path: "/", maxAge: opts.maxAge }),
    delete: (name) => store.delete(name),
  };
}

async function supabaseStore(): Promise<SupabaseCookieStore> {
  const store = await cookies();
  return {
    getAll: () => store.getAll().map((c) => ({ name: c.name, value: c.value })),
    set: (name, value, options) => store.set(name, value, options),
  };
}

let adapter: AuthAdapter | undefined;

export function auth(): AuthAdapter {
  if (!adapter) {
    adapter = env().AUTH_PROVIDER === "supabase" ? new SupabaseAuthAdapter(supabaseStore) : new LocalAuthAdapter(cookieJar);
  }
  return adapter;
}

/** Session user for this request (memoized per request). */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => auth().getSessionUser());

/** Signed in, email verified and — if enrolled — passed MFA. Redirects otherwise. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!user.emailVerified) redirect("/verify-email");
  if (user.mfaEnrolled && user.aal !== "aal2") redirect("/mfa");
  return user;
}

export async function requestInfo(): Promise<RequestInfo> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return { ip: forwarded || h.get("x-real-ip") || null, userAgent: h.get("user-agent") };
}

export type { SessionUser } from "./types";

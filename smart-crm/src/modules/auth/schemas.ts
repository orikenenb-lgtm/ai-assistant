import { z } from "zod";

export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

export const passwordSchema = z
  .string()
  .min(10)
  .max(128)
  .refine((v) => /[A-Za-z֐-׿]/.test(v) && /\d/.test(v), { message: "validation.passwordWeak" });

export const signInSchema = z.object({ email: emailSchema, password: z.string().min(1).max(128), next: z.string().optional() });

export const signUpSchema = z
  .object({
    fullName: z.string().trim().min(2).max(120),
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
    locale: z.enum(["he", "en"]).default("he"),
  })
  .refine((v) => v.password === v.confirmPassword, { path: ["confirmPassword"], message: "validation.passwordMismatch" });

export const forgotSchema = z.object({ email: emailSchema });

export const resetSchema = z
  .object({ token: z.string().max(200).optional(), password: passwordSchema, confirmPassword: z.string() })
  .refine((v) => v.password === v.confirmPassword, { path: ["confirmPassword"], message: "validation.passwordMismatch" });

export const mfaCodeSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/) });

export const changePasswordSchema = z
  .object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema, confirmPassword: z.string() })
  .refine((v) => v.newPassword === v.confirmPassword, { path: ["confirmPassword"], message: "validation.passwordMismatch" });

/** Only same-site relative paths are allowed as post-login destinations (no open redirects). */
export function safeNext(next: string | null | undefined, fallback = "/dashboard"): string {
  // Browsers strip tabs/newlines and treat "\\" as "/", so "/\t/evil.com" would leave the site.
  if (!next || !next.startsWith("/") || /[\u0000-\u001f\u007f\\]/.test(next)) return fallback;
  let url: URL;
  try {
    url = new URL(next, "http://same.origin");
  } catch {
    return fallback;
  }
  if (url.origin !== "http://same.origin") return fallback;
  return url.pathname + url.search + url.hash;
}

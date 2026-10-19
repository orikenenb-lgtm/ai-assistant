import "server-only";
import { z } from "zod";
import { getTranslations } from "next-intl/server";
import { unstable_rethrow } from "next/navigation";
import { AppError, isAppError, isCheckViolation, isForeignKeyViolation, isRlsViolation, isUniqueViolation, type ErrorCode } from "./errors";
import { errorFields, logger } from "./logger";
import { requireTenant, type TenantContext } from "./tenancy";
import { assertCan, assertWritable } from "./context";
import type { Permission } from "./rbac/permissions";

export type ActionError = { code: ErrorCode; message: string; fieldErrors?: Record<string, string[]> };
export type ActionResult<T = null> = { ok: true; data: T } | { ok: false; error: ActionError };

type Translator = Awaited<ReturnType<typeof getTranslations>>;

function issueMessage(t: Translator, issue: z.core.$ZodIssue): string {
  // Custom refinements carry a translation key as their message.
  if (issue.code === "custom" && issue.message && t.has(issue.message)) return t(issue.message);
  switch (issue.code) {
    case "invalid_type":
      return issue.input === undefined || issue.input === null ? t("validation.required") : t("validation.invalid");
    case "too_small":
      if (issue.origin === "string") {
        return Number(issue.minimum) <= 1 ? t("validation.required") : t("validation.tooShort", { min: Number(issue.minimum) });
      }
      if (issue.origin === "array" || issue.origin === "set") return t("validation.selectAtLeast", { min: Number(issue.minimum) });
      return t("validation.tooSmall", { min: Number(issue.minimum) });
    case "too_big":
      if (issue.origin === "string") return t("validation.tooLong", { max: Number(issue.maximum) });
      return t("validation.tooBig", { max: Number(issue.maximum) });
    case "invalid_format":
      if (issue.format === "email") return t("validation.email");
      if (issue.format === "url") return t("validation.url");
      return t("validation.invalid");
    case "invalid_value":
      return t("validation.invalidOption");
    default:
      return issue.message && t.has(issue.message) ? t(issue.message) : t("validation.invalid");
  }
}

async function toActionError(e: unknown): Promise<ActionError> {
  const t = await getTranslations();
  if (e instanceof z.ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of e.issues) {
      const key = issue.path.join(".") || "_form";
      (fieldErrors[key] ??= []).push(issueMessage(t, issue));
    }
    return { code: "VALIDATION", message: t("errors.validation"), fieldErrors };
  }
  if (isAppError(e)) {
    const message = t.has(e.message) ? t(e.message, (e.details ?? {}) as Record<string, string>) : e.message;
    let fieldErrors: Record<string, string[]> | undefined;
    if (e.fieldErrors) {
      fieldErrors = Object.fromEntries(
        Object.entries(e.fieldErrors).map(([k, msgs]) => [k, msgs.map((m) => (t.has(m) ? t(m) : m))]),
      );
    }
    return { code: e.code, message, fieldErrors };
  }
  if (isUniqueViolation(e)) return { code: "CONFLICT", message: t("errors.conflict") };
  if (isForeignKeyViolation(e)) return { code: "VALIDATION", message: t("errors.relatedMissing") };
  if (isCheckViolation(e)) return { code: "VALIDATION", message: t("errors.validation") };
  if (isRlsViolation(e)) return { code: "FORBIDDEN", message: t("errors.forbidden") };
  logger().error(errorFields(e), "unexpected action error");
  return { code: "INTERNAL", message: t("errors.internal") };
}

/**
 * Standard pipeline for tenant-scoped server actions:
 * validate → authenticate → resolve tenant → authorize → run → map errors.
 */
export async function tenantAction<S extends z.ZodType, R>(
  input: unknown,
  opts: { schema: S; permission?: Permission; write?: boolean },
  handler: (data: z.infer<S>, tc: TenantContext) => Promise<R>,
): Promise<ActionResult<R>> {
  try {
    const data = opts.schema.parse(input, { reportInput: true });
    const tc = await requireTenant();
    if (opts.write !== false) assertWritable(tc.ctx);
    if (opts.permission) assertCan(tc.ctx, opts.permission);
    return { ok: true, data: await handler(data, tc) };
  } catch (e) {
    unstable_rethrow(e); // let redirect()/notFound() through
    return { ok: false, error: await toActionError(e) };
  }
}

/** Same pipeline without a tenant (auth pages, onboarding, account settings). */
export async function publicAction<S extends z.ZodType, R>(
  input: unknown,
  schema: S,
  handler: (data: z.infer<S>) => Promise<R>,
): Promise<ActionResult<R>> {
  try {
    const data = schema.parse(input, { reportInput: true });
    return { ok: true, data: await handler(data) };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: await toActionError(e) };
  }
}

export function fail(code: ErrorCode, message: string, fieldErrors?: Record<string, string[]>): never {
  throw new AppError(code, message, fieldErrors);
}

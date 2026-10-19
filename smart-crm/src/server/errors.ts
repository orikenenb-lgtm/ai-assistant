export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "QUOTA_EXCEEDED"
  | "PLAN_REQUIRED"
  | "READ_ONLY"
  | "PRECONDITION"
  | "PROVIDER_ERROR"
  | "INTERNAL";

/**
 * Expected, user-facing failure. `message` is a translation key under the
 * `errors` namespace (or a safe literal); never put internal details in it.
 */
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string = code,
    public readonly fieldErrors?: Record<string, string[]>,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const notFound = (what = "record") => new AppError("NOT_FOUND", `errors.notFound`, undefined, { what });
export const forbidden = (message = "errors.forbidden") => new AppError("FORBIDDEN", message);
export const conflict = (message = "errors.conflict") => new AppError("CONFLICT", message);
export const validation = (fieldErrors: Record<string, string[]>, message = "errors.validation") =>
  new AppError("VALIDATION", message, fieldErrors);

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

/** Postgres error helpers (postgres.js errors expose `code` and `constraint_name`). */
export function pgErrorCode(e: unknown): string | undefined {
  const err = (e as { cause?: unknown })?.cause ?? e;
  return typeof err === "object" && err !== null && "code" in err ? String((err as { code: unknown }).code) : undefined;
}

export function pgConstraint(e: unknown): string | undefined {
  const err = ((e as { cause?: unknown })?.cause ?? e) as { constraint_name?: string };
  return err?.constraint_name;
}

export const isUniqueViolation = (e: unknown) => pgErrorCode(e) === "23505";
export const isForeignKeyViolation = (e: unknown) => pgErrorCode(e) === "23503";
export const isCheckViolation = (e: unknown) => pgErrorCode(e) === "23514";
export const isRlsViolation = (e: unknown) => pgErrorCode(e) === "42501";

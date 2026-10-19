import { NextResponse, type NextRequest } from "next/server";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/server/db";
import { systemCtx, type ServiceCtx } from "@/server/context";
import { AppError, isAppError, isForeignKeyViolation, isUniqueViolation, type ErrorCode } from "@/server/errors";
import { sha256Hex } from "@/server/crypto";
import { hitRateLimit } from "@/server/rate-limit";
import { errorFields, logger } from "@/server/logger";
import { getEntitlements, recordUsage } from "@/modules/billing/entitlements";
import { en } from "@/i18n/messages.generated";
import { looksLikeApiKey, permissionsForScopes, type ApiScope } from "./keys";

/**
 * Minimal framework for the public REST API (v1):
 *   export const GET = apiRoute({ scope: "contacts:read" }, async ({ ctx, request }) => json(...))
 * Handles API-key authentication, scopes, per-key rate limiting, metering,
 * validation and a uniform error format {error:{code,message,details}}.
 */

export const RATE_LIMIT_PER_MINUTE = 600;

export type ApiKeyPrincipal = { keyId: string; tenantId: string; scopes: string[]; name: string; prefix: string };

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

const STATUS_FOR: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 422,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  QUOTA_EXCEEDED: 403,
  PLAN_REQUIRED: 403,
  READ_ONLY: 403,
  PRECONDITION: 412,
  PROVIDER_ERROR: 502,
  INTERNAL: 500,
};

/** English text for a translation key (the API is English-only). */
function englishMessage(key: string): string {
  const value = key.split(".").reduce<unknown>((node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined), en);
  return typeof value === "string" ? value.replace(/\{[^}]+\}/g, "").trim() : key;
}

export function errorResponse(status: number, code: string, message: string, details?: unknown, headers?: HeadersInit) {
  return NextResponse.json({ error: { code, message, ...(details === undefined ? {} : { details }) } }, { status, headers });
}

/** Resolves a Bearer API key. Lookup is by SHA-256 (unique index), never by plaintext. */
export async function authenticateApiKey(authorization: string | null): Promise<ApiKeyPrincipal> {
  const match = /^Bearer\s+(\S+)$/i.exec(authorization ?? "");
  if (!match || !looksLikeApiKey(match[1])) throw new ApiError(401, "UNAUTHENTICATED", "Missing or malformed API key");
  const [row] = await db()
    .select({ key: schema.apiKeys, tenant: schema.tenants })
    .from(schema.apiKeys)
    .innerJoin(schema.tenants, eq(schema.tenants.id, schema.apiKeys.tenantId))
    .where(and(eq(schema.apiKeys.keyHash, sha256Hex(match[1])), isNull(schema.tenants.deletedAt)))
    .limit(1);
  if (!row || row.key.revokedAt) throw new ApiError(401, "UNAUTHENTICATED", "Invalid or revoked API key");
  if (row.key.expiresAt && row.key.expiresAt < new Date()) throw new ApiError(401, "UNAUTHENTICATED", "API key expired");
  if (row.tenant.status !== "active") throw new ApiError(403, "FORBIDDEN", "Organization is suspended");
  const ent = await getEntitlements(db(), row.tenant.id);
  if (!ent.features.has("api")) throw new ApiError(403, "PLAN_REQUIRED", "The API is not included in your plan");
  if (!row.key.lastUsedAt || Date.now() - row.key.lastUsedAt.getTime() > 60_000) {
    await db().update(schema.apiKeys).set({ lastUsedAt: new Date() }).where(eq(schema.apiKeys.id, row.key.id));
  }
  return { keyId: row.key.id, tenantId: row.tenant.id, scopes: row.key.scopes, name: row.key.name, prefix: row.key.prefix };
}

export type ApiHandlerArgs<P> = { request: NextRequest; ctx: ServiceCtx; principal: ApiKeyPrincipal; params: P };

function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  if (e instanceof z.ZodError) {
    return new ApiError(
      422,
      "VALIDATION",
      "Request validation failed",
      e.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  if (isAppError(e)) {
    const details = e.fieldErrors
      ? Object.entries(e.fieldErrors).map(([path, msgs]) => ({ path, message: msgs.map(englishMessage).join("; ") }))
      : undefined;
    return new ApiError(STATUS_FOR[e.code] ?? 400, e.code, englishMessage(e.message), details);
  }
  if (isUniqueViolation(e)) return new ApiError(409, "CONFLICT", "Conflicting record");
  if (isForeignKeyViolation(e)) return new ApiError(422, "VALIDATION", "A referenced record was not found");
  logger().error(errorFields(e), "unexpected API error");
  return new ApiError(500, "INTERNAL", "Internal server error");
}

export function apiRoute<P = Record<string, never>>(
  opts: { scope?: ApiScope },
  handler: (args: ApiHandlerArgs<P>) => Promise<Response>,
): (request: NextRequest, context: { params: Promise<P> }) => Promise<Response> {
  return async (request, context) => {
    const started = Date.now();
    let principal: ApiKeyPrincipal | null = null;
    let headers: Record<string, string> = {};
    try {
      principal = await authenticateApiKey(request.headers.get("authorization"));
      const limit = await hitRateLimit(`api:${principal.keyId}`, RATE_LIMIT_PER_MINUTE, 60);
      headers = {
        "X-RateLimit-Limit": String(RATE_LIMIT_PER_MINUTE),
        "X-RateLimit-Remaining": String(limit.remaining),
        "X-RateLimit-Reset": String(Math.ceil(limit.resetAt.getTime() / 1000)),
      };
      if (!limit.allowed) {
        headers["Retry-After"] = String(Math.max(1, Math.ceil((limit.resetAt.getTime() - Date.now()) / 1000)));
        throw new ApiError(429, "RATE_LIMITED", "Rate limit exceeded");
      }
      if (opts.scope && !principal.scopes.includes(opts.scope)) {
        throw new ApiError(403, "FORBIDDEN", `This key lacks the "${opts.scope}" scope`);
      }
      const ctx = systemCtx(principal.tenantId, {
        actorType: "api_key",
        apiKeyId: principal.keyId,
        permissions: permissionsForScopes(principal.scopes),
        meta: {
          ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
          userAgent: request.headers.get("user-agent"),
        },
      });
      const params = (await context.params) ?? ({} as P);
      const response = await handler({ request, ctx, principal, params });
      for (const [k, v] of Object.entries(headers)) response.headers.set(k, v);
      response.headers.set("Cache-Control", "no-store");
      await recordUsage(db(), { tenantId: principal.tenantId, metric: "api_calls", quantity: 1, refType: "api_key", refId: principal.keyId });
      logger().info({ apiKey: principal.prefix, method: request.method, path: request.nextUrl.pathname, status: response.status, ms: Date.now() - started }, "api request");
      return response;
    } catch (e) {
      const err = toApiError(e);
      if (principal) {
        logger().info({ apiKey: principal.prefix, method: request.method, path: request.nextUrl.pathname, status: err.status }, "api request failed");
      }
      return errorResponse(err.status, err.code, err.message, err.details, headers);
    }
  };
}

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

/** Parses a JSON body (422 on invalid JSON / schema). */
export async function readBody<S extends z.ZodType>(request: NextRequest, schema: S): Promise<z.infer<S>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ApiError(422, "VALIDATION", "Request body must be valid JSON");
  }
  return schema.parse(body);
}

export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export function queryObject(request: NextRequest): Record<string, string> {
  return Object.fromEntries(request.nextUrl.searchParams.entries());
}

export function pagination(page: number, pageSize: number, total: number) {
  return { page, pageSize, total, hasMore: page * pageSize < total };
}

export const uuidParam = z.uuid();

export function parseId(raw: string | undefined): string {
  const parsed = uuidParam.safeParse(raw);
  if (!parsed.success) throw new AppError("NOT_FOUND", "errors.notFound");
  return parsed.data;
}

/** Count helper for tenant-scoped list endpoints. */
export const countSql = sql<number>`count(*)::int`;

import { withSystemTx, withUserTx, type Tx } from "./db";
import { AppError } from "./errors";
import { roleCan, type Permission, type Role } from "./rbac/permissions";

export type ActorType = "user" | "system" | "automation" | "ai" | "api_key" | "admin" | "webhook";

export type RequestMeta = { ip?: string | null; userAgent?: string | null; requestId?: string };

/**
 * Everything a module service needs to act inside one tenant. Services never
 * read cookies or headers themselves, so the same code serves server actions,
 * the public API, AI tools and background jobs.
 */
export interface ServiceCtx {
  tenantId: string;
  /** Human on whose behalf the action runs (null for system/automation/API keys). */
  userId: string | null;
  actorType: ActorType;
  role: Role | null;
  readOnly: boolean;
  apiKeyId?: string;
  meta?: RequestMeta;
  /** Runs in a transaction; RLS-enforced for user contexts. */
  run<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  can(permission: Permission): boolean;
}

export function userCtx(args: {
  tenantId: string;
  userId: string;
  role: Role;
  readOnly?: boolean;
  actorType?: Extract<ActorType, "user" | "ai">;
  meta?: RequestMeta;
}): ServiceCtx {
  const readOnly = args.readOnly ?? false;
  return {
    tenantId: args.tenantId,
    userId: args.userId,
    actorType: args.actorType ?? "user",
    role: args.role,
    readOnly,
    meta: args.meta,
    run: (fn) => withUserTx(args.userId, fn),
    can: (p) => roleCan(args.role, p),
  };
}

/**
 * Read-only support-mode context for platform admins: RLS grants read access
 * through an active support session, never write access.
 */
export function supportCtx(args: { tenantId: string; userId: string; meta?: RequestMeta }): ServiceCtx {
  return {
    tenantId: args.tenantId,
    userId: args.userId,
    actorType: "admin",
    role: null,
    readOnly: true,
    meta: args.meta,
    run: (fn) => withUserTx(args.userId, fn),
    can: (p) => p.endsWith(".view"),
  };
}

/**
 * System context (worker, webhooks, automations, API keys). RLS is bypassed,
 * so services must filter by ctx.tenantId — they always do.
 */
export function systemCtx(
  tenantId: string,
  opts: { actorType?: ActorType; userId?: string | null; permissions?: Permission[]; apiKeyId?: string; meta?: RequestMeta } = {},
): ServiceCtx {
  const allowed = opts.permissions ? new Set(opts.permissions) : null;
  return {
    tenantId,
    userId: opts.userId ?? null,
    actorType: opts.actorType ?? "system",
    role: null,
    readOnly: false,
    apiKeyId: opts.apiKeyId,
    meta: opts.meta,
    run: (fn) => withSystemTx(fn),
    can: (p) => (allowed ? allowed.has(p) : true),
  };
}

export function assertCan(ctx: ServiceCtx, permission: Permission) {
  if (!ctx.can(permission)) throw new AppError("FORBIDDEN", "errors.forbidden", undefined, { permission });
}

export function assertWritable(ctx: ServiceCtx) {
  if (ctx.readOnly) throw new AppError("READ_ONLY", "errors.readOnly");
}

/** Convenience: permission + writability for mutations. */
export function assertCanWrite(ctx: ServiceCtx, permission: Permission) {
  assertWritable(ctx);
  assertCan(ctx, permission);
}

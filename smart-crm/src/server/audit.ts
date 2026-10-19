import type { Tx } from "./db";
import { schema } from "./db";
import type { ServiceCtx } from "./context";

export type AuditEntry = {
  action: string;
  entityType?: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
};

const ACTOR_TYPES = {
  user: "user",
  ai: "ai",
  admin: "admin",
  system: "system",
  automation: "automation",
  api_key: "api_key",
  webhook: "webhook",
} as const;

/** Writes an audit row in the caller's transaction (atomic with the change). */
export async function audit(tx: Tx, ctx: ServiceCtx, entry: AuditEntry) {
  await tx.insert(schema.auditLogs).values({
    tenantId: ctx.tenantId,
    actorUserId: ctx.userId,
    actorType: ACTOR_TYPES[ctx.actorType],
    action: entry.action,
    entityType: entry.entityType ?? null,
    entityId: entry.entityId ?? null,
    metadata: { ...(entry.metadata ?? {}), ...(ctx.apiKeyId ? { apiKeyId: ctx.apiKeyId } : {}) },
    ip: ctx.meta?.ip ?? null,
    userAgent: ctx.meta?.userAgent?.slice(0, 300) ?? null,
  });
}

/** Platform-level audit (no tenant), e.g. super-admin actions. System tx only. */
export async function auditPlatform(
  tx: Tx,
  entry: AuditEntry & { actorUserId: string | null; tenantId?: string | null; ip?: string | null; userAgent?: string | null },
) {
  await tx.insert(schema.auditLogs).values({
    tenantId: entry.tenantId ?? null,
    actorUserId: entry.actorUserId,
    actorType: "admin",
    action: entry.action,
    entityType: entry.entityType ?? null,
    entityId: entry.entityId ?? null,
    metadata: entry.metadata ?? {},
    ip: entry.ip ?? null,
    userAgent: entry.userAgent?.slice(0, 300) ?? null,
  });
}

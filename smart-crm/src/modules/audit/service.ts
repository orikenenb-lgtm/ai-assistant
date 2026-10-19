import { and, count, desc, eq, gte, like, lt, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/server/db";
import { assertCan, type ServiceCtx } from "@/server/context";
import { AppError } from "@/server/errors";
import { audit } from "@/server/audit";
import { getEntitlements } from "@/modules/billing/entitlements";

export const auditQuerySchema = z.object({
  action: z
    .string()
    .trim()
    .max(100)
    .regex(/^[a-z0-9_.]*$/)
    .optional()
    .catch(undefined),
  actor: z.uuid().optional().catch(undefined),
  entityType: z
    .string()
    .trim()
    .max(40)
    .regex(/^[a-z_]*$/)
    .optional()
    .catch(undefined),
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).default(1).catch(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(50).catch(50),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;

export function parseAuditQuery(params: Record<string, string | string[] | undefined>): AuditQuery {
  const flat = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]).filter(([, v]) => v));
  return auditQuerySchema.parse(flat);
}

function where(ctx: ServiceCtx, q: AuditQuery): SQL {
  return and(
    eq(schema.auditLogs.tenantId, ctx.tenantId),
    q.action ? like(schema.auditLogs.action, `${q.action.replace(/[\\%_]/g, (c) => `\\${c}`)}%`) : undefined,
    q.actor ? eq(schema.auditLogs.actorUserId, q.actor) : undefined,
    q.entityType ? eq(schema.auditLogs.entityType, q.entityType) : undefined,
    q.from ? gte(schema.auditLogs.createdAt, new Date(`${q.from}T00:00:00Z`)) : undefined,
    q.to ? lt(schema.auditLogs.createdAt, new Date(new Date(`${q.to}T00:00:00Z`).getTime() + 86400_000)) : undefined,
  )!;
}

export type AuditRow = {
  id: number;
  action: string;
  actorType: string;
  actorName: string | null;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, unknown>;
  ip: string | null;
  createdAt: Date;
};

/** RLS limits audit reads to owners/managers of the tenant; the permission check says why. */
export async function listAuditLogs(ctx: ServiceCtx, q: AuditQuery): Promise<{ rows: AuditRow[]; total: number }> {
  assertCan(ctx, "audit.view");
  return ctx.run(async (tx) => {
    const w = where(ctx, q);
    const [{ total }] = await tx.select({ total: count() }).from(schema.auditLogs).where(w);
    const rows = await tx
      .select({ a: schema.auditLogs, actorName: schema.profiles.fullName })
      .from(schema.auditLogs)
      .leftJoin(schema.profiles, eq(schema.profiles.id, schema.auditLogs.actorUserId))
      .where(w)
      .orderBy(desc(schema.auditLogs.createdAt), desc(schema.auditLogs.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    return {
      total,
      rows: rows.map(({ a, actorName }) => ({
        id: a.id,
        action: a.action,
        actorType: a.actorType,
        actorName,
        entityType: a.entityType,
        entityId: a.entityId,
        metadata: a.metadata,
        ip: a.ip,
        createdAt: a.createdAt,
      })),
    };
  });
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = typeof v === "object" && !(v instanceof Date) ? JSON.stringify(v) : v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV export of the filtered log (plan feature `audit_export`). */
export async function exportAuditCsv(ctx: ServiceCtx, q: AuditQuery): Promise<string> {
  assertCan(ctx, "audit.view");
  if (!(await getEntitlements(db(), ctx.tenantId)).features.has("audit_export")) throw new AppError("PLAN_REQUIRED", "errors.planRequired");
  const lines = ["created_at,action,actor_type,actor,entity_type,entity_id,ip,metadata"];
  let page = 1;
  for (;;) {
    const { rows } = await listAuditLogs(ctx, { ...q, page, pageSize: 100 });
    for (const r of rows) lines.push([r.createdAt, r.action, r.actorType, r.actorName, r.entityType, r.entityId, r.ip, r.metadata].map(cell).join(","));
    if (rows.length < 100 || page >= 500) break;
    page++;
  }
  await ctx.run((tx) => audit(tx, ctx, { action: "audit.exported", entityType: "audit_log", metadata: { rows: lines.length - 1 } }));
  return `﻿${lines.join("\r\n")}\r\n`;
}

export async function auditActors(ctx: ServiceCtx) {
  assertCan(ctx, "audit.view");
  return ctx.run((tx) =>
    tx
      .select({ userId: schema.profiles.id, fullName: schema.profiles.fullName })
      .from(schema.memberships)
      .innerJoin(schema.profiles, eq(schema.profiles.id, schema.memberships.userId))
      .where(eq(schema.memberships.tenantId, ctx.tenantId)),
  );
}

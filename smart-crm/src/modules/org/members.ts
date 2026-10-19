import { and, asc, eq } from "drizzle-orm";
import { schema } from "@/server/db";
import { assertCan, assertCanWrite, type ServiceCtx } from "@/server/context";
import { audit } from "@/server/audit";
import { AppError, pgErrorCode } from "@/server/errors";
import { assignableRoles, canManageMember, type Role } from "@/server/rbac/permissions";
import { assertSeatAvailable } from "@/modules/billing/entitlements";
import { queueSeatSync } from "@/modules/billing/seats";

export type MemberView = {
  userId: string;
  fullName: string;
  email: string;
  role: Role;
  status: "active" | "disabled";
  joinedAt: Date;
};

export async function listMembers(ctx: ServiceCtx): Promise<MemberView[]> {
  assertCan(ctx, "members.view");
  return ctx.run(async (tx) => {
    const rows = await tx
      .select({ m: schema.memberships, p: schema.profiles })
      .from(schema.memberships)
      .innerJoin(schema.profiles, eq(schema.profiles.id, schema.memberships.userId))
      .where(eq(schema.memberships.tenantId, ctx.tenantId))
      .orderBy(asc(schema.profiles.fullName));
    return rows.map((r) => ({
      userId: r.p.id,
      fullName: r.p.fullName,
      email: r.p.email,
      role: r.m.role as Role,
      status: r.m.status as MemberView["status"],
      joinedAt: r.m.createdAt,
    }));
  });
}

/** Lightweight list for assignee pickers (active members only). */
export async function listAssignableMembers(ctx: ServiceCtx) {
  return ctx.run(async (tx) => {
    const rows = await tx
      .select({ userId: schema.profiles.id, fullName: schema.profiles.fullName, email: schema.profiles.email })
      .from(schema.memberships)
      .innerJoin(schema.profiles, eq(schema.profiles.id, schema.memberships.userId))
      .where(and(eq(schema.memberships.tenantId, ctx.tenantId), eq(schema.memberships.status, "active")))
      .orderBy(asc(schema.profiles.fullName));
    return rows.map((r) => ({ ...r, fullName: r.fullName || r.email }));
  });
}

async function loadTarget(ctx: ServiceCtx, tx: Parameters<Parameters<ServiceCtx["run"]>[0]>[0], userId: string) {
  const [m] = await tx
    .select()
    .from(schema.memberships)
    .where(and(eq(schema.memberships.tenantId, ctx.tenantId), eq(schema.memberships.userId, userId)));
  if (!m) throw new AppError("NOT_FOUND", "errors.notFound");
  if (!ctx.role || !canManageMember(ctx.role, m.role as Role)) throw new AppError("FORBIDDEN", "errors.forbidden");
  return m;
}

function mapOwnerError(e: unknown): never {
  if (pgErrorCode(e) === "23514") throw new AppError("VALIDATION", "members.lastOwner");
  throw e;
}

export async function changeMemberRole(ctx: ServiceCtx, userId: string, role: Role) {
  assertCanWrite(ctx, "members.manage");
  if (!ctx.role || !assignableRoles(ctx.role).includes(role)) throw new AppError("FORBIDDEN", "errors.forbidden");
  await ctx
    .run(async (tx) => {
      const m = await loadTarget(ctx, tx, userId);
      if (m.role === role) return;
      await tx.update(schema.memberships).set({ role }).where(eq(schema.memberships.id, m.id));
      await audit(tx, ctx, { action: "member.role_changed", entityType: "membership", entityId: userId, metadata: { from: m.role, to: role } });
    })
    .catch(mapOwnerError);
}

export async function setMemberStatus(ctx: ServiceCtx, userId: string, status: "active" | "disabled") {
  assertCanWrite(ctx, "members.manage");
  if (userId === ctx.userId) throw new AppError("VALIDATION", "members.cannotChangeSelf");
  await ctx
    .run(async (tx) => {
      const m = await loadTarget(ctx, tx, userId);
      if (m.status === status) return;
      if (status === "active") await assertSeatAvailable(tx, ctx.tenantId);
      await tx.update(schema.memberships).set({ status }).where(eq(schema.memberships.id, m.id));
      await audit(tx, ctx, { action: status === "active" ? "member.enabled" : "member.disabled", entityType: "membership", entityId: userId });
      await queueSeatSync(tx, ctx.tenantId);
    })
    .catch(mapOwnerError);
}

export async function removeMember(ctx: ServiceCtx, userId: string) {
  assertCanWrite(ctx, "members.manage");
  if (userId === ctx.userId) throw new AppError("VALIDATION", "members.cannotChangeSelf");
  await ctx
    .run(async (tx) => {
      const m = await loadTarget(ctx, tx, userId);
      // Owned records are unassigned automatically (ON DELETE SET NULL on the composite FKs).
      await tx.delete(schema.memberships).where(eq(schema.memberships.id, m.id));
      await audit(tx, ctx, { action: "member.removed", entityType: "membership", entityId: userId, metadata: { role: m.role } });
      await queueSeatSync(tx, ctx.tenantId);
    })
    .catch(mapOwnerError);
}

import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { schema, withSystemTx, type Tx } from "@/server/db";
import { assertCanWrite, assertCan, type ServiceCtx } from "@/server/context";
import { audit } from "@/server/audit";
import { AppError } from "@/server/errors";
import { randomToken, sha256Hex } from "@/server/crypto";
import { env } from "@/server/env";
import { sendEmail } from "@/server/email";
import { assignableRoles, type Role } from "@/server/rbac/permissions";
import { assertSeatAvailable } from "@/modules/billing/entitlements";
import { notify } from "@/modules/notifications/service";

const INVITE_TTL_DAYS = 7;

const ROLE_LABELS: Record<"he" | "en", Record<Role, string>> = {
  he: { owner: "בעלים", manager: "מנהל/ת", agent: "נציג/ה" },
  en: { owner: "Owner", manager: "Manager", agent: "Agent" },
};

export type InvitationView = {
  id: string;
  email: string;
  role: Role;
  expiresAt: Date;
  createdAt: Date;
  invitedByName: string | null;
};

export async function listInvitations(ctx: ServiceCtx): Promise<InvitationView[]> {
  assertCan(ctx, "members.view");
  return ctx.run(async (tx) => {
    const rows = await tx
      .select({ inv: schema.invitations, inviter: schema.profiles.fullName })
      .from(schema.invitations)
      .leftJoin(schema.profiles, eq(schema.profiles.id, schema.invitations.invitedBy))
      .where(
        and(
          eq(schema.invitations.tenantId, ctx.tenantId),
          isNull(schema.invitations.acceptedAt),
          isNull(schema.invitations.revokedAt),
          gt(schema.invitations.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(schema.invitations.createdAt));
    return rows.map((r) => ({
      id: r.inv.id,
      email: r.inv.email,
      role: r.inv.role as Role,
      expiresAt: r.inv.expiresAt,
      createdAt: r.inv.createdAt,
      invitedByName: r.inviter,
    }));
  });
}

async function sendInvitationEmail(tx: Tx, ctx: ServiceCtx, inv: { email: string; role: Role; expiresAt: Date }, token: string) {
  const [tenant] = await tx.select().from(schema.tenants).where(eq(schema.tenants.id, ctx.tenantId));
  const [inviter] = ctx.userId
    ? await tx.select({ fullName: schema.profiles.fullName }).from(schema.profiles).where(eq(schema.profiles.id, ctx.userId))
    : [];
  const locale = tenant.locale === "en" ? "en" : "he";
  await sendEmail({
    to: inv.email,
    template: "invitation",
    locale,
    tenantId: ctx.tenantId,
    data: {
      orgName: tenant.name,
      inviterName: inviter?.fullName || tenant.name,
      role: ROLE_LABELS[locale][inv.role],
      url: `${env().APP_URL}/invite/${token}`,
      expiresAt: inv.expiresAt.toISOString().slice(0, 10),
    },
  });
}

export async function createInvitation(ctx: ServiceCtx, input: { email: string; role: Role }) {
  assertCanWrite(ctx, "members.invite");
  if (!ctx.role || !assignableRoles(ctx.role).includes(input.role)) throw new AppError("FORBIDDEN", "errors.forbidden");
  const email = input.email.trim().toLowerCase();
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86400_000);
  return ctx.run(async (tx) => {
    const existingMember = await tx
      .select({ id: schema.memberships.id })
      .from(schema.memberships)
      .innerJoin(schema.profiles, eq(schema.profiles.id, schema.memberships.userId))
      .where(and(eq(schema.memberships.tenantId, ctx.tenantId), sql`lower(${schema.profiles.email}) = ${email}`))
      .limit(1);
    if (existingMember.length) throw new AppError("CONFLICT", "members.alreadyMember");
    await assertSeatAvailable(tx, ctx.tenantId);
    const [inv] = await tx
      .insert(schema.invitations)
      .values({ tenantId: ctx.tenantId, email, role: input.role, tokenHash: sha256Hex(token), invitedBy: ctx.userId, expiresAt })
      .returning();
    await audit(tx, ctx, { action: "member.invited", entityType: "invitation", entityId: inv.id, metadata: { email, role: input.role } });
    await sendInvitationEmail(tx, ctx, { email, role: input.role, expiresAt }, token);
    return { id: inv.id };
  });
}

export async function revokeInvitation(ctx: ServiceCtx, invitationId: string) {
  assertCanWrite(ctx, "members.invite");
  await ctx.run(async (tx) => {
    const [inv] = await tx
      .update(schema.invitations)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.invitations.id, invitationId), eq(schema.invitations.tenantId, ctx.tenantId), isNull(schema.invitations.acceptedAt)))
      .returning();
    if (!inv) throw new AppError("NOT_FOUND", "errors.notFound");
    await audit(tx, ctx, { action: "member.invitation_revoked", entityType: "invitation", entityId: inv.id, metadata: { email: inv.email } });
  });
}

export async function resendInvitation(ctx: ServiceCtx, invitationId: string) {
  assertCanWrite(ctx, "members.invite");
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86400_000);
  await ctx.run(async (tx) => {
    const [inv] = await tx
      .update(schema.invitations)
      .set({ tokenHash: sha256Hex(token), expiresAt })
      .where(
        and(
          eq(schema.invitations.id, invitationId),
          eq(schema.invitations.tenantId, ctx.tenantId),
          isNull(schema.invitations.acceptedAt),
          isNull(schema.invitations.revokedAt),
        ),
      )
      .returning();
    if (!inv) throw new AppError("NOT_FOUND", "errors.notFound");
    await audit(tx, ctx, { action: "member.invitation_resent", entityType: "invitation", entityId: inv.id });
    await sendInvitationEmail(tx, ctx, { email: inv.email, role: inv.role as Role, expiresAt }, token);
  });
}

export type InvitationPreview = { id: string; tenantName: string; role: Role; email: string; status: "valid" | "expired" | "used" };

/** Public lookup by token (the token itself is the credential). */
export async function previewInvitation(token: string): Promise<InvitationPreview | null> {
  return withSystemTx(async (tx) => {
    const [row] = await tx
      .select({ inv: schema.invitations, tenantName: schema.tenants.name })
      .from(schema.invitations)
      .innerJoin(schema.tenants, eq(schema.tenants.id, schema.invitations.tenantId))
      .where(and(eq(schema.invitations.tokenHash, sha256Hex(token)), isNull(schema.tenants.deletedAt)))
      .limit(1);
    if (!row) return null;
    const status = row.inv.acceptedAt || row.inv.revokedAt ? "used" : row.inv.expiresAt < new Date() ? "expired" : "valid";
    return { id: row.inv.id, tenantName: row.tenantName, role: row.inv.role as Role, email: row.inv.email, status };
  });
}

export async function listPendingInvitationsForEmail(email: string): Promise<{ id: string; tenantName: string; role: Role }[]> {
  return withSystemTx(async (tx) => {
    const rows = await tx
      .select({ id: schema.invitations.id, tenantName: schema.tenants.name, role: schema.invitations.role })
      .from(schema.invitations)
      .innerJoin(schema.tenants, eq(schema.tenants.id, schema.invitations.tenantId))
      .where(
        and(
          sql`lower(${schema.invitations.email}) = lower(${email})`,
          isNull(schema.invitations.acceptedAt),
          isNull(schema.invitations.revokedAt),
          gt(schema.invitations.expiresAt, new Date()),
          isNull(schema.tenants.deletedAt),
        ),
      );
    return rows.map((r) => ({ ...r, role: r.role as Role }));
  });
}

/**
 * Accepts an invitation for a signed-in user whose verified email matches the
 * invited address. Identified either by token (email link) or by id (onboarding
 * list, which is already filtered to the user's own email).
 */
export async function acceptInvitation(user: { userId: string; email: string }, ref: { token: string } | { invitationId: string }) {
  return withSystemTx(async (tx) => {
    const where = "token" in ref ? eq(schema.invitations.tokenHash, sha256Hex(ref.token)) : eq(schema.invitations.id, ref.invitationId);
    const [inv] = await tx.select().from(schema.invitations).where(where).for("update").limit(1);
    if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt < new Date()) throw new AppError("VALIDATION", "invite.invalid");
    if (inv.email.toLowerCase() !== user.email.toLowerCase()) throw new AppError("FORBIDDEN", "invite.wrongEmail");

    const [existing] = await tx
      .select()
      .from(schema.memberships)
      .where(and(eq(schema.memberships.tenantId, inv.tenantId), eq(schema.memberships.userId, user.userId)));
    if (existing) {
      await tx.update(schema.memberships).set({ status: "active", role: inv.role }).where(eq(schema.memberships.id, existing.id));
    } else {
      await tx.insert(schema.memberships).values({ tenantId: inv.tenantId, userId: user.userId, role: inv.role });
    }
    await tx.update(schema.invitations).set({ acceptedAt: new Date(), acceptedBy: user.userId }).where(eq(schema.invitations.id, inv.id));
    await tx.update(schema.profiles).set({ lastTenantId: inv.tenantId }).where(eq(schema.profiles.id, user.userId));
    await tx.insert(schema.auditLogs).values({
      tenantId: inv.tenantId,
      actorUserId: user.userId,
      actorType: "user",
      action: "member.joined",
      entityType: "membership",
      entityId: user.userId,
      metadata: { role: inv.role, invitationId: inv.id },
    });
    if (inv.invitedBy) {
      await notify(tx, {
        tenantId: inv.tenantId,
        userId: inv.invitedBy,
        type: "invitation_accepted",
        title: { he: `${user.email} הצטרף/ה לארגון`, en: `${user.email} joined the organization` },
        link: "/settings/team",
      });
    }
    return { tenantId: inv.tenantId };
  });
}

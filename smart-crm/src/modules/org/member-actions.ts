"use server";

import { cookies } from "next/headers";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { publicAction, tenantAction, type ActionResult } from "@/server/action";
import { TENANT_COOKIE } from "@/server/tenancy";
import { ROLES } from "@/server/rbac/permissions";
import { acceptInvitation, createInvitation, resendInvitation, revokeInvitation } from "./invitations";
import { changeMemberRole, removeMember, setMemberStatus } from "./members";
import { emailSchema } from "@/modules/auth/schemas";

async function enterTenant(tenantId: string) {
  (await cookies()).set(TENANT_COOKIE, tenantId, { path: "/", sameSite: "lax", httpOnly: true, maxAge: 365 * 86400 });
}

export async function acceptInvitationByIdAction(input: unknown): Promise<ActionResult> {
  return publicAction(input, z.object({ invitationId: z.uuid() }), async ({ invitationId }) => {
    const user = await requireUser();
    const { tenantId } = await acceptInvitation(user, { invitationId });
    await enterTenant(tenantId);
    return null;
  });
}

export async function acceptInvitationByTokenAction(input: unknown): Promise<ActionResult> {
  return publicAction(input, z.object({ token: z.string().min(20).max(200) }), async ({ token }) => {
    const user = await requireUser();
    const { tenantId } = await acceptInvitation(user, { token });
    await enterTenant(tenantId);
    return null;
  });
}

export async function inviteMemberAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return tenantAction(
    input,
    { schema: z.object({ email: emailSchema, role: z.enum(ROLES) }), permission: "members.invite" },
    (data, { ctx }) => createInvitation(ctx, data),
  );
}

export async function revokeInvitationAction(input: unknown): Promise<ActionResult> {
  return tenantAction(input, { schema: z.object({ id: z.uuid() }), permission: "members.invite" }, async ({ id }, { ctx }) => {
    await revokeInvitation(ctx, id);
    return null;
  });
}

export async function resendInvitationAction(input: unknown): Promise<ActionResult> {
  return tenantAction(input, { schema: z.object({ id: z.uuid() }), permission: "members.invite" }, async ({ id }, { ctx }) => {
    await resendInvitation(ctx, id);
    return null;
  });
}

export async function changeMemberRoleAction(input: unknown): Promise<ActionResult> {
  return tenantAction(
    input,
    { schema: z.object({ userId: z.uuid(), role: z.enum(ROLES) }), permission: "members.manage" },
    async (data, { ctx }) => {
      await changeMemberRole(ctx, data.userId, data.role);
      return null;
    },
  );
}

export async function setMemberStatusAction(input: unknown): Promise<ActionResult> {
  return tenantAction(
    input,
    { schema: z.object({ userId: z.uuid(), status: z.enum(["active", "disabled"]) }), permission: "members.manage" },
    async (data, { ctx }) => {
      await setMemberStatus(ctx, data.userId, data.status);
      return null;
    },
  );
}

export async function removeMemberAction(input: unknown): Promise<ActionResult> {
  return tenantAction(input, { schema: z.object({ userId: z.uuid() }), permission: "members.manage" }, async ({ userId }, { ctx }) => {
    await removeMember(ctx, userId);
    return null;
  });
}

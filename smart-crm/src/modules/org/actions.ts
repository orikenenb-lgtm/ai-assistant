"use server";

import { cookies } from "next/headers";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { publicAction, type ActionResult } from "@/server/action";
import { AppError } from "@/server/errors";
import { TENANT_COOKIE } from "@/server/tenancy";
import { createOrganization, isActiveMember, setLastTenant } from "./service";

const createOrgSchema = z.object({
  name: z.string().trim().min(2).max(120),
  locale: z.enum(["he", "en"]),
  currency: z.enum(["ILS", "USD", "EUR", "GBP"]).default("ILS"),
  timezone: z.string().max(64).default("Asia/Jerusalem"),
});

async function setTenantCookie(tenantId: string) {
  (await cookies()).set(TENANT_COOKIE, tenantId, { path: "/", sameSite: "lax", httpOnly: true, maxAge: 365 * 86400 });
}

export async function createOrganizationAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return publicAction(input, createOrgSchema, async (data) => {
    const user = await requireUser();
    const tenant = await createOrganization(user.userId, data);
    await setTenantCookie(tenant.id);
    return { id: tenant.id };
  });
}

export async function switchTenantAction(input: unknown): Promise<ActionResult> {
  return publicAction(input, z.object({ tenantId: z.uuid() }), async ({ tenantId }) => {
    const user = await requireUser();
    if (!(await isActiveMember(user.userId, tenantId))) throw new AppError("FORBIDDEN", "errors.forbidden");
    await setTenantCookie(tenantId);
    await setLastTenant(user.userId, tenantId);
    return null;
  });
}

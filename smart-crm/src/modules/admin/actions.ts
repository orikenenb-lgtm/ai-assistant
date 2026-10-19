"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requestInfo, requireUser } from "@/server/auth";
import { publicAction, type ActionResult } from "@/server/action";
import { TENANT_COOKIE } from "@/server/tenancy";
import { assertSuperAdmin, type AdminActor } from "./guard";
import {
  adminChangePlan,
  cancelDeadJob,
  cancelTenantDeletion,
  createFeatureFlag,
  endSupportSession,
  flagKeySchema,
  listTenants,
  overrideSchema,
  planUpdateSchema,
  retryDeadJob,
  scheduleTenantDeletion,
  setFeatureFlag,
  setTenantFeatureFlag,
  setTenantOverride,
  setTenantStatus,
  startSupportSession,
  supportStartSchema,
  updatePlan,
} from "./service";

async function currentAdmin(): Promise<AdminActor> {
  const user = await requireUser();
  await assertSuperAdmin(user.userId);
  const info = await requestInfo();
  return { userId: user.userId, ip: info.ip, userAgent: info.userAgent };
}

async function adminAction<S extends z.ZodType, R>(input: unknown, schema: S, handler: (data: z.infer<S>, actor: AdminActor) => Promise<R>): Promise<ActionResult<R>> {
  return publicAction(input, schema, async (data) => handler(data, await currentAdmin()));
}

const tenantId = z.object({ tenantId: z.uuid() });

export async function searchTenantsAction(input: unknown): Promise<ActionResult<{ id: string; name: string }[]>> {
  return adminAction(input, z.object({ q: z.string().max(100).default("") }), async ({ q }, actor) => {
    const { rows } = await listTenants(actor, { q: q.trim() || undefined, page: 1, pageSize: 10 });
    return rows.map((r) => ({ id: r.id, name: `${r.name} (${r.slug})` }));
  });
}

export async function setTenantOverrideAction(input: unknown): Promise<ActionResult> {
  return adminAction(input, tenantId.extend({ override: overrideSchema }), async ({ tenantId, override }, actor) => {
    await setTenantOverride(actor, tenantId, override);
    revalidatePath(`/admin/tenants/${tenantId}`);
    return null;
  });
}

export async function adminChangePlanAction(input: unknown): Promise<ActionResult> {
  return adminAction(
    input,
    tenantId.extend({ planId: z.string().regex(/^[a-z0-9_]{2,32}$/), interval: z.enum(["month", "year"]), force: z.boolean().default(false) }),
    async (d, actor) => {
      await adminChangePlan(actor, d.tenantId, d.planId, d.interval, { force: d.force });
      revalidatePath(`/admin/tenants/${d.tenantId}`);
      return null;
    },
  );
}

export async function setTenantStatusAction(input: unknown): Promise<ActionResult> {
  return adminAction(input, tenantId.extend({ status: z.enum(["active", "suspended"]), reason: z.string().trim().min(5).max(500) }), async (d, actor) => {
    await setTenantStatus(actor, d.tenantId, d.status, d.reason);
    revalidatePath(`/admin/tenants/${d.tenantId}`);
    return null;
  });
}

export async function scheduleTenantDeletionAction(input: unknown): Promise<ActionResult> {
  return adminAction(input, tenantId.extend({ confirmSlug: z.string().max(60), reason: z.string().trim().min(5).max(500) }), async (d, actor) => {
    await scheduleTenantDeletion(actor, d.tenantId, d.confirmSlug, d.reason);
    revalidatePath(`/admin/tenants/${d.tenantId}`);
    return null;
  });
}

export async function cancelTenantDeletionAction(input: unknown): Promise<ActionResult> {
  return adminAction(input, tenantId, async (d, actor) => {
    await cancelTenantDeletion(actor, d.tenantId);
    revalidatePath(`/admin/tenants/${d.tenantId}`);
    return null;
  });
}

export async function updatePlanAction(input: unknown): Promise<ActionResult> {
  return adminAction(input, z.object({ planId: z.string().regex(/^[a-z0-9_]{2,32}$/), data: planUpdateSchema }), async (d, actor) => {
    await updatePlan(actor, d.planId, d.data);
    revalidatePath("/admin/plans");
    return null;
  });
}

export async function createFeatureFlagAction(input: unknown): Promise<ActionResult> {
  return adminAction(input, z.object({ key: flagKeySchema, description: z.string().trim().max(300).default("") }), async (d, actor) => {
    await createFeatureFlag(actor, d.key, d.description);
    revalidatePath("/admin/flags");
    return null;
  });
}

export async function setFeatureFlagAction(input: unknown): Promise<ActionResult> {
  return adminAction(input, z.object({ key: flagKeySchema, enabled: z.boolean() }), async (d, actor) => {
    await setFeatureFlag(actor, d.key, d.enabled);
    revalidatePath("/admin/flags");
    return null;
  });
}

export async function setTenantFeatureFlagAction(input: unknown): Promise<ActionResult> {
  return adminAction(input, tenantId.extend({ key: flagKeySchema, enabled: z.boolean().nullable() }), async (d, actor) => {
    await setTenantFeatureFlag(actor, d.tenantId, d.key, d.enabled);
    revalidatePath("/admin/flags");
    revalidatePath(`/admin/tenants/${d.tenantId}`);
    return null;
  });
}

export async function retryDeadJobAction(input: unknown): Promise<ActionResult> {
  return adminAction(input, z.object({ jobId: z.number().int().positive() }), async (d, actor) => {
    await retryDeadJob(actor, d.jobId);
    revalidatePath("/admin/jobs");
    return null;
  });
}

export async function cancelDeadJobAction(input: unknown): Promise<ActionResult> {
  return adminAction(input, z.object({ jobId: z.number().int().positive() }), async (d, actor) => {
    await cancelDeadJob(actor, d.jobId);
    revalidatePath("/admin/jobs");
    return null;
  });
}

/** Starts read-only support mode and points the tenant cookie at the tenant. */
export async function startSupportSessionAction(input: unknown): Promise<ActionResult<{ redirectTo: string }>> {
  return adminAction(input, supportStartSchema, async (d, actor) => {
    const session = await startSupportSession(actor, d);
    (await cookies()).set(TENANT_COOKIE, session.tenantId, { path: "/", sameSite: "lax", httpOnly: true, maxAge: d.minutes * 60 });
    return { redirectTo: "/dashboard" };
  });
}

export async function endSupportSessionAction(input: unknown): Promise<ActionResult> {
  return adminAction(input, z.object({ sessionId: z.uuid().optional() }), async (d, actor) => {
    const left = await endSupportSession(actor, d.sessionId);
    const store = await cookies();
    if (left.includes(store.get(TENANT_COOKIE)?.value ?? "")) store.delete(TENANT_COOKIE);
    revalidatePath("/admin/support");
    return null;
  });
}

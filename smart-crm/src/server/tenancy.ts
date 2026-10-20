import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gt, isNull, asc } from "drizzle-orm";
import { db, schema } from "./db";
import { requireUser, requestInfo, type SessionUser } from "./auth";
import { supportCtx, userCtx, type ServiceCtx } from "./context";
import type { Role } from "./rbac/permissions";

export const TENANT_COOKIE = "crm_tenant";

export type TenantSummary = {
  id: string;
  name: string;
  slug: string;
  status: "active" | "suspended";
  locale: "he" | "en";
  timezone: string;
  currency: string;
  brandColor: string | null;
  logoPath: string | null;
};

export type TenantContext = {
  user: SessionUser & { fullName: string; isSuperAdmin: boolean; locale: "he" | "en" };
  tenant: TenantSummary;
  role: Role | null;
  supportMode: boolean;
  ctx: ServiceCtx;
};

export type MyTenant = TenantSummary & { role: Role };

/** Tenants the user belongs to (system read keyed strictly by the session user). */
export async function listMyTenants(userId: string): Promise<MyTenant[]> {
  const rows = await db()
    .select({ tenant: schema.tenants, role: schema.memberships.role })
    .from(schema.memberships)
    .innerJoin(schema.tenants, eq(schema.tenants.id, schema.memberships.tenantId))
    .where(and(eq(schema.memberships.userId, userId), eq(schema.memberships.status, "active"), isNull(schema.tenants.deletedAt)))
    .orderBy(asc(schema.tenants.name));
  return rows.map((r) => ({ ...toSummary(r.tenant), role: r.role as Role }));
}

function toSummary(t: typeof schema.tenants.$inferSelect): TenantSummary {
  return {
    id: t.id,
    name: t.name,
    slug: t.slug,
    status: t.status as TenantSummary["status"],
    locale: t.locale as TenantSummary["locale"],
    timezone: t.timezone,
    currency: t.currency,
    brandColor: t.brandColor,
    logoPath: t.logoPath,
  };
}

async function activeSupportTenant(userId: string, tenantId: string) {
  const [row] = await db()
    .select({ tenant: schema.tenants })
    .from(schema.supportSessions)
    .innerJoin(schema.tenants, eq(schema.tenants.id, schema.supportSessions.tenantId))
    .where(
      and(
        eq(schema.supportSessions.adminUserId, userId),
        eq(schema.supportSessions.tenantId, tenantId),
        isNull(schema.supportSessions.endedAt),
        gt(schema.supportSessions.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return row?.tenant;
}

/**
 * Resolves the active tenant for this request (memoized). Returns null when the
 * signed-in user has no organization yet.
 */
export const getTenantContext = cache(async (): Promise<TenantContext | null> => {
  const session = await requireUser();
  const [profile] = await db().select().from(schema.profiles).where(eq(schema.profiles.id, session.userId)).limit(1);
  if (!profile) redirect("/login");
  const user = {
    ...session,
    fullName: profile.fullName,
    isSuperAdmin: profile.isSuperAdmin,
    locale: (profile.locale === "en" ? "en" : "he") as "he" | "en",
  };
  const meta = { ...(await requestInfo()) };
  const wanted = (await cookies()).get(TENANT_COOKIE)?.value ?? profile.lastTenantId ?? undefined;

  // Platform admin in read-only support mode for a tenant they are not a member of.
  if (wanted && profile.isSuperAdmin) {
    const memberships = await listMyTenants(session.userId);
    if (!memberships.some((m) => m.id === wanted)) {
      const t = await activeSupportTenant(session.userId, wanted);
      if (t) {
        // Every support-mode request is audit-logged under the tenant (memoized: once per request).
        await db().insert(schema.auditLogs).values({
          tenantId: t.id,
          actorUserId: session.userId,
          actorType: "admin",
          action: "admin.support_view",
          entityType: "tenant",
          entityId: t.id,
          ip: meta.ip ?? null,
          userAgent: meta.userAgent?.slice(0, 300) ?? null,
        });
        return {
          user,
          tenant: toSummary(t),
          role: null,
          supportMode: true,
          ctx: supportCtx({ tenantId: t.id, userId: session.userId, meta }),
        };
      }
    }
  }

  const tenants = await listMyTenants(session.userId);
  if (tenants.length === 0) return null;
  const chosen = tenants.find((t) => t.id === wanted) ?? tenants[0];
  return {
    user,
    tenant: chosen,
    role: chosen.role,
    supportMode: false,
    ctx: userCtx({
      tenantId: chosen.id,
      userId: session.userId,
      role: chosen.role,
      readOnly: chosen.status !== "active",
      meta,
    }),
  };
});

/** Tenant context or redirect to onboarding. */
export async function requireTenant(): Promise<TenantContext> {
  const t = await getTenantContext();
  if (!t) redirect("/onboarding");
  return t;
}

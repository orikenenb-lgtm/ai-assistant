import { requireTenant, listMyTenants } from "@/server/tenancy";
import { AppShell } from "@/components/layout/app-shell";
import { NAV, type NavKey } from "@/components/layout/nav";
import { getEntitlements, trialDaysLeft, type Feature } from "@/modules/billing/entitlements";
import { listNotifications } from "@/modules/notifications/service";
import { db } from "@/server/db";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const tc = await requireTenant();
  const { ctx } = tc;
  const [tenants, ent, notifications] = await Promise.all([
    listMyTenants(tc.user.userId),
    getEntitlements(db(), tc.tenant.id),
    tc.supportMode ? Promise.resolve({ unread: 0 }) : listNotifications(ctx, 1),
  ]);

  const allowedNav: NavKey[] = NAV.flatMap((g) => g.items)
    .filter((i) => (!i.permission || ctx.can(i.permission)) && (!i.feature || ent.features.has(i.feature as Feature)))
    .map((i) => i.key);


  return (
    <AppShell
      user={{ id: tc.user.userId, fullName: tc.user.fullName, email: tc.user.email, isSuperAdmin: tc.user.isSuperAdmin }}
      tenant={{ id: tc.tenant.id, name: tc.tenant.name, brandColor: tc.tenant.brandColor }}
      tenants={tenants.map((t) => ({ id: t.id, name: t.name, role: t.role }))}
      role={tc.role}
      allowedNav={allowedNav}
      supportMode={tc.supportMode}
      trialDaysLeft={trialDaysLeft(ent)}
      unreadNotifications={notifications.unread}
    >
      {children}
    </AppShell>
  );
}

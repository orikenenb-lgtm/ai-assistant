import { getTranslations } from "next-intl/server";
import { requireTenant } from "@/server/tenancy";
import { db } from "@/server/db";
import { listMembers } from "@/modules/org/members";
import { listInvitations } from "@/modules/org/invitations";
import { getEntitlements, seatsInUse } from "@/modules/billing/entitlements";
import { TeamManager } from "@/modules/settings/components/team-manager";
import { NoAccess } from "@/modules/settings/components/no-access";
import { PageHeader } from "@/components/ui/primitives";

export async function generateMetadata() {
  return { title: (await getTranslations("members"))("title") };
}

export default async function TeamSettingsPage() {
  const { ctx, user, role } = await requireTenant();
  if (!ctx.can("members.view")) return <NoAccess />;
  const t = await getTranslations("members");
  const [members, invitations, ent, used] = await Promise.all([
    listMembers(ctx),
    ctx.can("members.invite") ? listInvitations(ctx) : Promise.resolve([]),
    getEntitlements(db(), ctx.tenantId),
    seatsInUse(db(), ctx.tenantId),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("subtitle")} />
      <TeamManager
        members={members}
        invitations={invitations}
        currentUserId={user.userId}
        actorRole={role}
        canInvite={ctx.can("members.invite") && !ctx.readOnly}
        canManageMembers={ctx.can("members.manage") && !ctx.readOnly}
        seats={{ used, limit: ent.seatLimit }}
      />
    </div>
  );
}

import { getTranslations } from "next-intl/server";
import { requireTenant } from "@/server/tenancy";
import { listDataRequests, TENANT_PURGE_GRACE_DAYS } from "@/modules/privacy/service";
import { getOrgSettings } from "@/modules/settings/service";
import { ContactRequestsCard, DataRequestsCard, DeleteTenantCard } from "@/modules/privacy/components/privacy-center";
import { NoAccess } from "@/modules/settings/components/no-access";
import { PageHeader } from "@/components/ui/primitives";

export async function generateMetadata() {
  return { title: (await getTranslations("privacy"))("title") };
}

export default async function PrivacyPage() {
  const { ctx } = await requireTenant();
  if (!ctx.can("privacy.manage")) return <NoAccess />;
  const t = await getTranslations("privacy");
  const [requests, { tenant }] = await Promise.all([listDataRequests(ctx), getOrgSettings(ctx)]);
  const canEdit = !ctx.readOnly;
  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("subtitle")} />
      <ContactRequestsCard canEdit={canEdit} />
      <DataRequestsCard
        canEdit={canEdit}
        requests={requests.map((r) => ({
          id: r.id,
          type: r.type,
          subjectType: r.subjectType,
          status: r.status,
          createdAt: r.createdAt,
          completedAt: r.completedAt,
          downloadable: r.downloadable,
          requestedByName: r.requestedByName,
        }))}
      />
      {canEdit && <DeleteTenantCard orgName={tenant.name} graceDays={TENANT_PURGE_GRACE_DAYS} />}
    </div>
  );
}

import { getTranslations } from "next-intl/server";
import { requireTenant } from "@/server/tenancy";
import { getOrgSettings, logoDataUrl } from "@/modules/settings/service";
import { BrandingCard, OrgProfileForm } from "@/modules/settings/components/org-settings-forms";
import { NoAccess } from "@/modules/settings/components/no-access";
import { PageHeader } from "@/components/ui/primitives";

export async function generateMetadata() {
  return { title: (await getTranslations("orgSettings"))("title") };
}

export default async function GeneralSettingsPage() {
  const { ctx } = await requireTenant();
  if (!ctx.can("org.view")) return <NoAccess />;
  const t = await getTranslations("orgSettings");
  const { tenant, settings } = await getOrgSettings(ctx);
  const canEdit = ctx.can("org.update") && !ctx.readOnly;
  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("subtitle")} />
      <OrgProfileForm
        canEdit={canEdit}
        initial={{
          name: tenant.name,
          locale: tenant.locale === "en" ? "en" : "he",
          timezone: tenant.timezone,
          currency: tenant.currency,
          website: tenant.website,
          phone: tenant.phone,
          email: tenant.email,
          address: tenant.address,
          taxId: tenant.taxId,
          vatRatePercent: settings.defaultVatRateBp / 100,
          messagesRetentionDays: settings.retention.messagesDays,
          aiLogsRetentionDays: settings.retention.aiLogsDays,
        }}
      />
      <BrandingCard logoDataUrl={await logoDataUrl(tenant.logoPath)} brandColor={tenant.brandColor} canEdit={canEdit} />
    </div>
  );
}

import { getTranslations } from "next-intl/server";
import { requireTenant } from "@/server/tenancy";
import { env } from "@/server/env";
import { accountingStatus } from "@/modules/documents/service";
import { getDocumentSettings, listTemplates } from "@/modules/documents/templates";
import { AccountingCard, TemplatesCard, VatSettingsCard } from "@/modules/documents/components/template-settings";
import { Alert, PageHeader } from "@/components/ui/primitives";

export async function generateMetadata() {
  return { title: (await getTranslations("documents"))("title") };
}

export default async function DocumentSettingsPage() {
  const { ctx } = await requireTenant();
  const t = await getTranslations("documents");
  if (!ctx.can("documents.templates")) {
    return <Alert tone="danger">{(await getTranslations("errors"))("forbidden")}</Alert>;
  }
  const [templates, settings, accounting] = await Promise.all([listTemplates(ctx), getDocumentSettings(ctx), accountingStatus(ctx)]);
  const canEdit = !ctx.readOnly;

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("subtitle")} className="mb-0" />
      <TemplatesCard
        canEdit={canEdit}
        templates={templates.map((x) => ({
          id: x.id,
          name: x.name,
          isDefault: x.isDefault,
          headerText: x.headerText,
          footerText: x.footerText,
          terms: x.terms,
          accentColor: x.accentColor,
          showLogo: x.showLogo,
        }))}
      />
      <VatSettingsCard defaultTaxRatePercent={String(settings.defaultTaxRateBp / 100)} canEdit={canEdit} />
      <AccountingCard status={accounting} canManage={ctx.can("integrations.manage") && canEdit} mockAllowed={env().APP_ENV !== "production"} />
    </div>
  );
}

import { getTranslations } from "next-intl/server";
import { requireTenant } from "@/server/tenancy";
import { db } from "@/server/db";
import { getEntitlements } from "@/modules/billing/entitlements";
import { getCustomFieldDefs } from "@/modules/crm/custom-fields";
import { CustomFieldsManager } from "@/modules/sales/components/crm-settings";
import { Alert } from "@/components/ui/primitives";

export async function generateMetadata() {
  return { title: (await getTranslations("crmSettings"))("customFieldsTitle") };
}

export default async function CustomFieldsSettingsPage() {
  const { ctx } = await requireTenant();
  const t = await getTranslations("crmSettings");
  const te = await getTranslations("errors");
  if (!ctx.can("settings.manage")) return <Alert tone="warning">{te("forbidden")}</Alert>;
  const ent = await getEntitlements(db(), ctx.tenantId);
  const enabled = ent.features.has("custom_fields");
  const [contact, company, deal, lead] = await Promise.all([
    getCustomFieldDefs(ctx, "contact"),
    getCustomFieldDefs(ctx, "company"),
    getCustomFieldDefs(ctx, "deal"),
    getCustomFieldDefs(ctx, "lead"),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">{t("customFieldsTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("customFieldsSubtitle")}</p>
      </div>
      {!enabled && <Alert tone="info">{t("planRequired")}</Alert>}
      {ctx.readOnly && <Alert tone="warning">{te("readOnly")}</Alert>}
      <CustomFieldsManager fields={{ contact, company, deal, lead }} canEdit={enabled && !ctx.readOnly} />
    </div>
  );
}

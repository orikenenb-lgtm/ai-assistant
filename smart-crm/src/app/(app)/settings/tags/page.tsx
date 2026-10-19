import { getTranslations } from "next-intl/server";
import { requireTenant } from "@/server/tenancy";
import { listTags, tagUsageCounts } from "@/modules/crm/tags";
import { TagsManager } from "@/modules/sales/components/crm-settings";
import { Alert } from "@/components/ui/primitives";

export async function generateMetadata() {
  return { title: (await getTranslations("crmSettings"))("tagsTitle") };
}

export default async function TagsSettingsPage() {
  const { ctx } = await requireTenant();
  const t = await getTranslations("crmSettings");
  const te = await getTranslations("errors");
  if (!ctx.can("settings.manage")) return <Alert tone="warning">{te("forbidden")}</Alert>;
  const [tags, usage] = await Promise.all([listTags(ctx), tagUsageCounts(ctx)]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">{t("tagsTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("tagsSubtitle")}</p>
      </div>
      {ctx.readOnly && <Alert tone="warning">{te("readOnly")}</Alert>}
      <TagsManager tags={tags.map((tag) => ({ ...tag, usage: usage.get(tag.id) ?? 0 }))} canEdit={!ctx.readOnly} />
    </div>
  );
}

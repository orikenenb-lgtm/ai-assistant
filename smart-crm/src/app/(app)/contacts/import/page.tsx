import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireTenant } from "@/server/tenancy";
import { getCustomFieldDefs } from "@/modules/crm/custom-fields";
import { ImportWizard } from "@/modules/crm/components/import-wizard";
import { PageHeader } from "@/components/ui/primitives";

export async function generateMetadata() {
  return { title: (await getTranslations("import"))("title") };
}

export default async function ImportPage() {
  const { ctx } = await requireTenant();
  if (!ctx.can("contacts.import") || ctx.readOnly) redirect("/contacts");
  const t = await getTranslations("import");
  const defs = await getCustomFieldDefs(ctx, "contact");
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={t("title")} description={t("subtitle")} />
      <ImportWizard customFields={defs.map((d) => ({ key: d.key, label: d.label }))} />
    </div>
  );
}

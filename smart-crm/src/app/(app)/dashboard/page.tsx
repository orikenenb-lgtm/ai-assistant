import { getTranslations } from "next-intl/server";
import { requireTenant } from "@/server/tenancy";
import { PageHeader } from "@/components/ui/primitives";

export async function generateMetadata() {
  return { title: (await getTranslations("nav"))("dashboard") };
}

export default async function DashboardPage() {
  const { user } = await requireTenant();
  const t = await getTranslations("dashboard");
  return <PageHeader title={t("greeting", { name: user.fullName.split(" ")[0] || "" })} description={t("subtitle")} />;
}

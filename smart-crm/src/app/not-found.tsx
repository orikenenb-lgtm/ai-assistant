import { getTranslations } from "next-intl/server";
import { StatusPage } from "@/components/layout/status-page";

export default async function NotFound() {
  const t = await getTranslations("errors");
  return (
    <main className="min-h-screen bg-background">
      <StatusPage kind="not-found" title={t("notFoundTitle")} body={t("notFoundBody")} homeLabel={t("goHome")} />
    </main>
  );
}

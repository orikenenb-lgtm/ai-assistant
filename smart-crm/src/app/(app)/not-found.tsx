import { getTranslations } from "next-intl/server";
import { StatusPage } from "@/components/layout/status-page";

/** Rendered inside the app shell for missing records and unknown app routes. */
export default async function AppNotFound() {
  const t = await getTranslations("errors");
  return <StatusPage kind="not-found" title={t("notFoundTitle")} body={t("notFoundBody")} homeLabel={t("goHome")} />;
}

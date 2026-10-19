import { getTranslations } from "next-intl/server";
import { ShieldAlert } from "lucide-react";
import { EmptyState } from "@/components/ui/primitives";

/** Shown when a settings page is opened without the needed permission or plan. */
export async function NoAccess({ reason = "forbidden" }: { reason?: "forbidden" | "plan" }) {
  const t = await getTranslations("errors");
  return <EmptyState icon={<ShieldAlert />} title={reason === "plan" ? t("planRequired") : t("forbidden")} />;
}

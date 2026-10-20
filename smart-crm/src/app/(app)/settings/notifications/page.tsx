import { getTranslations } from "next-intl/server";
import { requireTenant } from "@/server/tenancy";
import { Alert, PageHeader } from "@/components/ui/primitives";
import { listPreferences } from "./preferences";
import { PreferencesForm } from "./preferences-form";

export async function generateMetadata() {
  return { title: (await getTranslations("notificationSettings"))("title") };
}

export default async function NotificationSettingsPage() {
  const tc = await requireTenant();
  const t = await getTranslations("notificationSettings");
  const prefs = await listPreferences(tc.ctx);
  const readOnly = tc.supportMode || tc.ctx.readOnly;
  return (
    <div className="max-w-3xl">
      <PageHeader title={t("title")} description={t("subtitle")} />
      {readOnly && <Alert tone="warning" className="mb-4">{t("readOnly")}</Alert>}
      <PreferencesForm initial={prefs} readOnly={readOnly} />
      <p className="mt-3 text-xs text-muted-foreground" dir="auto">
        {t("emailNote", { email: tc.user.email })}
      </p>
    </div>
  );
}

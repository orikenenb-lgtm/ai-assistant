import { getTranslations } from "next-intl/server";
import { requireTenant } from "@/server/tenancy";
import { db } from "@/server/db";
import { getEntitlements, type Feature } from "@/modules/billing/entitlements";
import { SettingsNav } from "./settings-nav-client";
import { SETTINGS_SECTIONS } from "./settings-nav";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const { ctx } = await requireTenant();
  const ent = await getEntitlements(db(), ctx.tenantId);
  const t = await getTranslations("settings");
  const sections = SETTINGS_SECTIONS.filter(
    (s) => (!s.permission || ctx.can(s.permission)) && (!s.feature || ent.features.has(s.feature as Feature)),
  );
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="min-w-0">
        <h1 className="mb-4 text-xl font-semibold tracking-tight">{t("title")}</h1>
        <SettingsNav sections={sections.map((s) => ({ key: s.key, group: s.group }))} />
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireSuperAdmin } from "@/modules/admin/request";
import { listFeatureFlags } from "@/modules/admin/service";
import { CreateFlagForm, FlagToggle, RemoveTenantFlagOverride } from "@/modules/admin/components/admin-controls";
import { Badge, Card, CardContent, CardHeader, CardTitle, PageHeader } from "@/components/ui/primitives";

export async function generateMetadata() {
  return { title: (await getTranslations("admin.nav"))("flags") };
}

export default async function AdminFlagsPage() {
  const actor = await requireSuperAdmin();
  const t = await getTranslations("admin.flags");
  const flags = await listFeatureFlags(actor);
  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("subtitle")} />
      <Card>
        <CardHeader>
          <CardTitle>{t("new")}</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateFlagForm />
        </CardContent>
      </Card>
      <div className="space-y-3">
        {flags.map((f) => (
          <Card key={f.key} className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-mono text-sm font-medium" dir="ltr">
                  {f.key}
                </p>
                {f.description && <p className="text-sm text-muted-foreground">{f.description}</p>}
              </div>
              <div className="flex items-center gap-3">
                <Badge tone={f.enabled ? "success" : "neutral"}>{f.enabled ? t("on") : t("off")}</Badge>
                <FlagToggle flagKey={f.key} enabled={f.enabled} />
              </div>
            </div>
            {f.overrides.length > 0 && (
              <ul className="mt-3 space-y-1 border-t border-border pt-3 text-sm">
                {f.overrides.map((o) => (
                  <li key={o.tenantId} className="flex items-center justify-between gap-2">
                    <Link href={`/admin/tenants/${o.tenantId}`} className="hover:underline">
                      {o.tenantName}
                    </Link>
                    <span className="flex items-center gap-2">
                      <Badge tone={o.enabled ? "success" : "danger"}>{o.enabled ? t("forceOn") : t("forceOff")}</Badge>
                      <RemoveTenantFlagOverride tenantId={o.tenantId} flagKey={f.key} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

import { getLocale, getTranslations } from "next-intl/server";
import { requireSuperAdmin } from "@/modules/admin/request";
import { listPlansAdmin } from "@/modules/admin/service";
import { PlanEditor } from "@/modules/admin/components/plan-editor";
import { Badge, PageHeader } from "@/components/ui/primitives";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatMoney, formatNumber } from "@/lib/format";

export async function generateMetadata() {
  return { title: (await getTranslations("admin.nav"))("plans") };
}

export default async function AdminPlansPage() {
  const actor = await requireSuperAdmin();
  const t = await getTranslations("admin.plans");
  const locale = (await getLocale()) as "he" | "en";
  const plans = await listPlansAdmin(actor);
  return (
    <div>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <Table>
        <THead>
          <TR className="hover:bg-transparent">
            <TH>{t("plan")}</TH>
            <TH>{t("priceMonthly")}</TH>
            <TH className="hidden md:table-cell">{t("seatLimit")}</TH>
            <TH className="hidden lg:table-cell">{t("features")}</TH>
            <TH>{t("subscribers")}</TH>
            <TH>{t("visibility")}</TH>
            <TH>
              <span className="sr-only">{t("actions")}</span>
            </TH>
          </TR>
        </THead>
        <TBody>
          {plans.map((p) => {
            const stripe = ((p.providerPriceIds as Record<string, Record<string, string>> | null)?.stripe ?? {}) as Record<string, string>;
            return (
              <TR key={p.id}>
                <TD>
                  <span className="block font-medium">{p.name[locale]}</span>
                  <span className="block font-mono text-xs text-muted-foreground" dir="ltr">
                    {p.id}
                  </span>
                </TD>
                <TD className="tabular">{formatMoney(p.priceMonthlyCents, p.currency, locale)}</TD>
                <TD className="hidden tabular md:table-cell">{p.seatLimit ?? "∞"}</TD>
                <TD className="hidden max-w-80 text-xs text-muted-foreground lg:table-cell">{p.features.join(", ")}</TD>
                <TD className="tabular">{formatNumber(p.subscribers, locale)}</TD>
                <TD>
                  <div className="flex flex-wrap gap-1">
                    <Badge tone={p.active ? "success" : "neutral"}>{p.active ? t("active") : t("inactive")}</Badge>
                    {p.isPublic && <Badge tone="info">{t("public")}</Badge>}
                  </div>
                </TD>
                <TD className="text-end">
                  <PlanEditor
                    plan={{
                      id: p.id,
                      name: p.name,
                      description: p.description,
                      priceMonthlyCents: p.priceMonthlyCents,
                      priceYearlyCents: p.priceYearlyCents,
                      trialDays: p.trialDays,
                      seatLimit: p.seatLimit,
                      limits: p.limits,
                      features: p.features,
                      isPublic: p.isPublic,
                      active: p.active,
                      stripePriceMonth: stripe.month ?? "",
                      stripePriceYear: stripe.year ?? "",
                    }}
                  />
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
    </div>
  );
}

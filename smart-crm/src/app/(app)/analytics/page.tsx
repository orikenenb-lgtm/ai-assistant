import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { BarChart3, Lock } from "lucide-react";
import { requireTenant } from "@/server/tenancy";
import { db } from "@/server/db";
import { getEntitlements } from "@/modules/billing/entitlements";
import { REPORTS, ownerOptions, parseFilters, pipelineOptions, resolveScope, runReport, type ReportKey } from "@/modules/analytics/service";
import { AnalyticsFilters } from "@/modules/analytics/components/filters";
import { CustomersView, LeadsView, PipelineView, RevenueView, TeamView } from "@/modules/analytics/components/report-views";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState, PageHeader } from "@/components/ui/primitives";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export async function generateMetadata() {
  return { title: (await getTranslations("nav"))("analytics") };
}

export default async function AnalyticsPage({ searchParams }: PageProps<"/analytics">) {
  const { ctx } = await requireTenant();
  const t = await getTranslations("analytics");
  const locale = (await getLocale()) as "he" | "en";

  if (!ctx.can("analytics.view")) {
    return <EmptyState icon={<Lock />} title={t("forbidden")} className="mt-10" />;
  }
  const ent = await getEntitlements(db(), ctx.tenantId);
  if (!ent.features.has("analytics")) {
    return (
      <EmptyState
        icon={<BarChart3 />}
        title={t("planTitle")}
        description={t("planBody")}
        className="mt-10"
        action={
          ctx.can("billing.view") ? (
            <Button asChild>
              <Link href="/settings/billing">{t("upgrade")}</Link>
            </Button>
          ) : undefined
        }
      />
    );
  }

  const sp = await searchParams;
  const rawTab = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  const tab: ReportKey = (REPORTS as readonly string[]).includes(rawTab ?? "") ? (rawTab as ReportKey) : "revenue";
  const filters = parseFilters(sp);
  const scope = await resolveScope(ctx, filters);
  const [report, owners, pipelines] = await Promise.all([runReport(ctx, tab, scope), ownerOptions(ctx, scope), pipelineOptions(ctx)]);
  const rangeLabel = `${formatDate(scope.range.from, locale, scope.timeZone)} – ${formatDate(new Date(scope.range.to.getTime() - 1), locale, scope.timeZone)}`;

  const keep = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    const value = Array.isArray(v) ? v[0] : v;
    if (value && k !== "tab") keep.set(k, value);
  }
  const tabHref = (key: ReportKey) => `/analytics?${new URLSearchParams({ ...Object.fromEntries(keep), tab: key })}`;
  const exportHref = ctx.can("analytics.export") ? `/api/analytics/export?${new URLSearchParams({ ...Object.fromEntries(keep), report: tab })}` : null;

  return (
    <>
      <PageHeader
        title={t("title")}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {rangeLabel}
            {scope.agentScoped && <Badge tone="primary">{t("myDataOnly")}</Badge>}
          </span>
        }
      />
      <nav aria-label={t("reports")} className="mb-4 flex gap-1 overflow-x-auto border-b border-border">
        {REPORTS.map((key) => (
          <Link
            key={key}
            href={tabHref(key)}
            aria-current={key === tab ? "page" : undefined}
            className={cn(
              "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              key === tab ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t(`tabs.${key}`)}
          </Link>
        ))}
      </nav>
      <AnalyticsFilters
        owners={owners.map((o) => ({ value: o.user_id, label: o.name }))}
        pipelines={pipelines.map((p) => ({ value: p.id, label: p.name }))}
        showPipeline={tab === "pipeline" || tab === "revenue" || tab === "team"}
        pipelineRequired={tab === "pipeline"}
        exportHref={exportHref}
        agentScoped={scope.agentScoped}
      />
      {report.key === "revenue" && <RevenueView data={report.data} rangeLabel={rangeLabel} />}
      {report.key === "pipeline" && <PipelineView data={report.data} />}
      {report.key === "leads" && <LeadsView data={report.data} rangeLabel={rangeLabel} />}
      {report.key === "team" && <TeamView data={report.data} />}
      {report.key === "customers" && <CustomersView data={report.data} rangeLabel={rangeLabel} />}
    </>
  );
}

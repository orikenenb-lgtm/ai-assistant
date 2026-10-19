import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Activity, AlertTriangle, Building2, Database, LifeBuoy, Mail, Users, Wallet } from "lucide-react";
import { requireSuperAdmin } from "@/modules/admin/request";
import { getPlatformStats } from "@/modules/admin/service";
import { Card, CardContent, CardHeader, CardTitle, PageHeader, StatCard } from "@/components/ui/primitives";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatMoney, formatNumber } from "@/lib/format";

export async function generateMetadata() {
  return { title: (await getTranslations("admin.nav"))("overview") };
}

export default async function AdminOverviewPage() {
  const actor = await requireSuperAdmin();
  const t = await getTranslations("admin");
  const locale = (await getLocale()) as "he" | "en";
  const s = await getPlatformStats(actor);
  const n = (v: number) => formatNumber(v, locale);
  const dead = s.jobs.byStatus.dead ?? 0;
  return (
    <div className="space-y-6">
      <PageHeader title={t("overview.title")} description={t("overview.subtitle")} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t("overview.tenants")}
          value={n(s.tenants.total)}
          icon={<Building2 />}
          hint={t("overview.tenantsHint", { suspended: s.tenants.byStatus.suspended ?? 0, deleted: s.tenants.deleted })}
        />
        <StatCard
          label={t("overview.mrr")}
          value={s.mrr.length ? s.mrr.map((m) => formatMoney(m.cents, m.currency, locale)).join(" · ") : formatMoney(0, "ILS", locale)}
          icon={<Wallet />}
          hint={t("overview.mrrHint")}
        />
        <StatCard label={t("overview.users")} value={n(s.users.activeMembers)} icon={<Users />} hint={t("overview.usersHint", { active: s.users.active30d, total: s.users.total })} />
        <StatCard label={t("overview.dbLatency")} value={`${s.dbLatencyMs} ms`} icon={<Database />} hint={t("overview.dbHint")} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Link href="/admin/jobs" className="block rounded-xl focus-visible:ring-2 focus-visible:ring-ring">
          <StatCard label={t("overview.deadJobs")} value={n(dead)} icon={<AlertTriangle />} hint={dead > 0 ? t("overview.deadJobsHint") : t("overview.allGood")} className={dead > 0 ? "border-danger/40" : undefined} />
        </Link>
        <StatCard label={t("overview.queued")} value={n(s.jobs.byStatus.queued ?? 0)} icon={<Activity />} hint={t("overview.running", { n: s.jobs.byStatus.running ?? 0 })} />
        <StatCard
          label={t("overview.webhookFailures")}
          value={n(s.webhookFailures.last24h)}
          icon={<AlertTriangle />}
          hint={t("overview.last7d", { n: s.webhookFailures.last7d })}
        />
        <StatCard label={t("overview.emailFailures")} value={n(s.emailFailures7d)} icon={<Mail />} hint={t("overview.supportActive", { n: s.activeSupportSessions })} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("overview.byPlan")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {s.tenants.byPlan.map((p) => (
                <li key={p.planId} className="flex items-center justify-between">
                  <span>{p.name}</span>
                  <span className="tabular font-medium">{n(p.count)}</span>
                </li>
              ))}
              {s.tenants.byPlan.length === 0 && <li className="text-muted-foreground">—</li>}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("overview.queueByType")}</CardTitle>
            <LifeBuoy className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {s.jobs.byType.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("overview.queueEmpty")}</p>
            ) : (
              <Table>
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH>{t("jobs.type")}</TH>
                    <TH>{t("overview.queuedShort")}</TH>
                    <TH>{t("overview.runningShort")}</TH>
                    <TH>{t("overview.deadShort")}</TH>
                  </TR>
                </THead>
                <TBody>
                  {s.jobs.byType.map((j) => (
                    <TR key={j.type}>
                      <TD className="font-mono text-xs" dir="ltr">
                        {j.type}
                      </TD>
                      <TD className="tabular">{j.queued}</TD>
                      <TD className="tabular">{j.running}</TD>
                      <TD className={j.dead ? "tabular font-semibold text-danger-foreground" : "tabular"}>{j.dead}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

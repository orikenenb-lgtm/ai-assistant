import Link from "next/link";
import { Suspense } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { Banknote, CalendarClock, CheckSquare, Handshake, MessageCircle, Sparkles, Target, Trophy, Upload, UserPlus } from "lucide-react";
import { requireTenant } from "@/server/tenancy";
import { dashboardData } from "@/modules/analytics/service";
import { formatBucket, formatPercent, formatValue, looseTranslator, type ValueFormat } from "@/modules/analytics/format";
import { CategoryBars, ChartFrame, TimeBars } from "@/modules/analytics/components/charts";
import { KpiTile } from "@/modules/analytics/components/kpi";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, CardHeader, CardTitle, PageHeader, Skeleton } from "@/components/ui/primitives";
import { formatDate, formatRelative, formatTime } from "@/lib/format";

export async function generateMetadata() {
  return { title: (await getTranslations("nav"))("dashboard") };
}

export default async function DashboardPage() {
  const { user } = await requireTenant();
  const t = await getTranslations("dashboard");
  return (
    <>
      <PageHeader title={t("greeting", { name: user.fullName.split(" ")[0] || "" })} description={t("subtitle")} />
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardContent />
      </Suspense>
    </>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <Skeleton className="h-72 rounded-xl xl:col-span-2" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
    </div>
  );
}

function signedPct(v: number | null, locale: "he" | "en") {
  if (v === null) return null;
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${formatPercent(Math.abs(v), locale)}`;
}

async function DashboardContent() {
  const { ctx } = await requireTenant();
  const [d, t, ta, tcrm, locale] = await Promise.all([
    dashboardData(ctx),
    getTranslations("dashboard"),
    getTranslations("analytics"),
    getTranslations("crm"),
    getLocale() as Promise<"he" | "en">,
  ]);
  const money: ValueFormat = { kind: "money", currency: d.currency };
  const m = (v: number) => formatValue(v, money, locale);
  const k = d.kpis;
  const fresh = d.hasData.contacts + d.hasData.deals + d.hasData.leads === 0;
  const canDeals = ctx.can("deals.view");

  if (fresh) {
    return (
      <Card className="p-6 sm:p-8" data-testid="dashboard-empty">
        <h2 className="text-lg font-semibold">{t("emptyTitle")}</h2>
        <p className="mt-1 max-w-xl text-sm text-muted-foreground">{t("emptyBody")}</p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { href: "/contacts?new=1", icon: UserPlus, label: t("start.contact"), show: ctx.can("contacts.create") },
            { href: "/contacts/import", icon: Upload, label: t("start.import"), show: ctx.can("contacts.import") },
            { href: "/deals?new=1", icon: Handshake, label: t("start.deal"), show: ctx.can("deals.create") },
            { href: "/settings/whatsapp", icon: MessageCircle, label: t("start.whatsapp"), show: ctx.can("integrations.manage") },
          ]
            .filter((x) => x.show)
            .map((x) => (
              <Link key={x.href} href={x.href} className="flex items-center gap-3 rounded-xl border border-border p-4 text-sm font-medium transition-colors hover:bg-accent">
                <span className="flex size-9 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground">
                  <x.icon className="size-4" />
                </span>
                {x.label}
              </Link>
            ))}
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {d.agentScoped && (
        <p className="text-xs text-muted-foreground">
          <Badge tone="primary">{ta("myDataOnly")}</Badge>
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="dashboard-kpis">
        {canDeals && (
          <KpiTile
            label={t("kpi.openPipeline")}
            value={m(k.openPipelineCents)}
            icon={<Banknote />}
            href="/deals"
            testId="kpi-open-pipeline"
            hint={t("kpi.openDeals", { count: k.openDeals })}
          />
        )}
        {canDeals && <KpiTile label={t("kpi.weighted")} value={m(k.weightedPipelineCents)} icon={<Target />} hint={t("kpi.weightedHint")} testId="kpi-weighted" />}
        {canDeals && (
          <KpiTile
            label={t("kpi.wonThisMonth")}
            value={m(k.wonThisMonthCents)}
            icon={<Trophy />}
            testId="kpi-won-month"
            delta={{ pct: k.wonChangePct, formatted: signedPct(k.wonChangePct, locale), periodLabel: t("kpi.vsLastMonth") }}
          />
        )}
        {ctx.can("leads.view") && (
          <KpiTile
            label={t("kpi.newLeads")}
            value={formatValue(k.newLeadsThisWeek, { kind: "count" }, locale)}
            icon={<Sparkles />}
            href="/leads"
            testId="kpi-new-leads"
            hint={k.leads90d > 0 ? t("kpi.conversion90d", { rate: formatPercent(k.conversionRate90d, locale) }) : t("kpi.noLeads90d")}
          />
        )}
        {ctx.can("inbox.view") && (
          <KpiTile
            label={d.agentScoped ? t("kpi.myConversations") : t("kpi.openConversations")}
            value={formatValue(k.openConversations, { kind: "count" }, locale)}
            icon={<MessageCircle />}
            href="/inbox"
            testId="kpi-conversations"
            hint={t("kpi.unread", { count: k.unreadMessages })}
          />
        )}
        {ctx.can("tasks.view") && (
          <KpiTile
            label={t("kpi.myTasks")}
            value={t("kpi.tasksValue", { today: k.tasksDueToday, overdue: k.tasksOverdue })}
            icon={<CheckSquare />}
            href="/tasks"
            tone={k.tasksOverdue > 0 ? "danger" : undefined}
            testId="kpi-tasks"
            hint={k.tasksOverdue > 0 ? t("kpi.overdueHint", { count: k.tasksOverdue }) : t("kpi.noOverdue")}
          />
        )}
      </div>

      {canDeals && (
        <div className="grid gap-4 xl:grid-cols-3">
          <ChartFrame
            className="xl:col-span-2"
            title={t("charts.wonByMonth")}
            description={t("charts.last12")}
            table={{
              head: [ta("table.month"), ta("revenue.wonDeals"), ta("revenue.won")],
              rows: d.wonByMonth.map((r) => [formatBucket(r.bucket, "month", locale, { long: true }), String(r.wonCount), m(r.wonValueCents)]),
            }}
          >
            <TimeBars
              data={d.wonByMonth}
              series={[{ key: "wonValueCents", label: ta("revenue.won"), slot: 1 }]}
              bucket="month"
              format={money}
              ariaLabel={t("charts.wonByMonth")}
            />
          </ChartFrame>
          <ChartFrame
            title={t("charts.pipelineByStage")}
            description={d.pipeline.pipelineName ?? undefined}
            table={{ head: [ta("table.stage"), ta("table.deals"), ta("pipeline.openValue")], rows: d.pipeline.stages.map((s) => [s.name, String(s.count), m(s.valueCents)]) }}
          >
            <CategoryBars data={d.pipeline.stages.map((s) => ({ name: s.name, value: s.valueCents }))} format={money} label={ta("pipeline.openValue")} ariaLabel={t("charts.pipelineByStage")} />
          </ChartFrame>
        </div>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {ctx.can("tasks.view") && (
          <Card>
            <CardHeader>
              <CardTitle>{t("lists.myTasks")}</CardTitle>
              <Button asChild variant="link" size="sm">
                <Link href="/tasks">{t("lists.all")}</Link>
              </Button>
            </CardHeader>
            <CardContent>
              {d.myTasksToday.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">{t("lists.noTasks")}</p>
              ) : (
                <ul className="divide-y divide-border">
                  {d.myTasksToday.map((task) => (
                    <li key={task.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{task.title}</span>
                        {task.contactName && task.contactId && (
                          <Link href={`/contacts/${task.contactId}`} className="block truncate text-xs text-muted-foreground hover:underline">
                            {task.contactName}
                          </Link>
                        )}
                      </span>
                      <span className="shrink-0 text-xs">
                        {task.overdue ? (
                          <Badge tone="danger">{t("lists.overdue")}</Badge>
                        ) : (
                          <span className="tabular text-muted-foreground">{task.dueAt ? formatTime(task.dueAt, locale, d.timeZone) : ""}</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}
        {canDeals && (
          <Card>
            <CardHeader>
              <CardTitle>{t("lists.closingSoon")}</CardTitle>
              <CalendarClock className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {d.closingSoon.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">{t("lists.noClosing")}</p>
              ) : (
                <ul className="divide-y divide-border">
                  {d.closingSoon.map((deal) => (
                    <li key={deal.id}>
                      <Link href={`/deals/${deal.id}`} className="flex items-center justify-between gap-3 py-2.5 text-sm hover:text-primary">
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{deal.title}</span>
                          <span className="block text-xs text-muted-foreground">
                            {deal.stageName} · {formatDate(deal.expectedCloseDate, locale, "UTC")}
                          </span>
                        </span>
                        <span className="tabular shrink-0 text-end text-xs">
                          <span className="block font-semibold text-foreground">{formatValue(deal.valueCents, { kind: "money", currency: deal.currency }, locale)}</span>
                          <span className="text-muted-foreground">{deal.probability}%</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}
        <Card className="lg:col-span-2 xl:col-span-1">
          <CardHeader>
            <CardTitle>{t("lists.activity")}</CardTitle>
          </CardHeader>
          <CardContent>
            {d.recentActivity.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{t("lists.noActivity")}</p>
            ) : (
              <ul className="space-y-3" data-testid="activity-feed">
                {d.recentActivity.map((a) => {
                  const target = a.dealId
                    ? { href: `/deals/${a.dealId}`, label: a.dealTitle }
                    : a.contactId
                      ? { href: `/contacts/${a.contactId}`, label: a.contactName }
                      : a.companyId
                        ? { href: `/companies/${a.companyId}`, label: a.companyName }
                        : a.leadId
                          ? { href: `/leads/${a.leadId}`, label: null }
                          : null;
                  const crm = looseTranslator(tcrm);
                  const typeLabel = crm.has(`activity.${a.type}`) ? crm.t(`activity.${a.type}`) : a.type;
                  return (
                    <li key={a.id} className="text-sm">
                      <p>
                        <span className="font-medium">{a.actorName ?? tcrm(`actor.${a.actorType}` as "actor.system")}</span>{" "}
                        <span className="text-muted-foreground">· {typeLabel}</span>
                        {a.subject && <span className="text-muted-foreground"> · {a.subject}</span>}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {target?.label && (
                          <>
                            <Link href={target.href} className="hover:underline">
                              {target.label}
                            </Link>{" "}
                            ·{" "}
                          </>
                        )}
                        {formatRelative(a.occurredAt, locale)}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

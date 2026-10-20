import { getLocale, getTranslations } from "next-intl/server";
import { Banknote, Clock, Handshake, Percent, Sparkles, Target, Trophy, Users } from "lucide-react";
import { Alert, EmptyState } from "@/components/ui/primitives";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { durationParts } from "../math";
import { formatBucket, formatPercent, formatValue, looseTranslator, type ValueFormat } from "../format";
import type { CustomersReport, LeadsReport, PipelineReport, RevenueReport, TeamReport } from "../service";
import { CategoryBars, ChartFrame, TimeBars, TrendArea, type SeriesDef, type Slot } from "./charts";
import { KpiTile } from "./kpi";

type Locale = "he" | "en";

async function ctx() {
  const [t, tc, locale] = [await getTranslations("analytics"), await getTranslations("contacts"), (await getLocale()) as Locale];
  return { t, tc, locale };
}

export function formatDuration(seconds: number | null, locale: Locale): string {
  if (seconds === null) return "—";
  const { value, unit } = durationParts(seconds);
  return new Intl.NumberFormat(locale === "he" ? "he-IL" : "en-US", { style: "unit", unit, unitDisplay: "long", maximumFractionDigits: 1 }).format(value);
}

function signedPct(v: number | null, locale: Locale): string | null {
  if (v === null) return null;
  const s = formatPercent(Math.abs(v), locale, 0);
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${s}`;
}

const grid = "grid gap-4 sm:grid-cols-2 xl:grid-cols-4";

/* ----------------------------------------------------------------- revenue */

export async function RevenueView({ data, rangeLabel }: { data: RevenueReport; rangeLabel: string }) {
  const { t, locale } = await ctx();
  const money: ValueFormat = { kind: "money", currency: data.currency };
  const m = (v: number | null) => formatValue(v, money, locale);
  const empty = data.totals.wonCount === 0 && data.totals.lostCount === 0;
  return (
    <div className="space-y-6">
      <div className={grid}>
        <KpiTile
          label={t("revenue.won")}
          value={m(data.totals.wonValueCents)}
          icon={<Banknote />}
          testId="kpi-revenue-won"
          delta={{ pct: data.totals.changePct, formatted: signedPct(data.totals.changePct, locale), periodLabel: t("vsPrevious") }}
        />
        <KpiTile label={t("revenue.wonDeals")} value={formatValue(data.totals.wonCount, { kind: "count" }, locale)} icon={<Trophy />} />
        <KpiTile label={t("revenue.avgDeal")} value={m(data.totals.avgDealCents)} icon={<Handshake />} />
        <KpiTile
          label={t("revenue.winRate")}
          value={formatPercent(data.totals.winRate, locale)}
          icon={<Percent />}
          hint={t("revenue.wonLost", { won: data.totals.wonCount, lost: data.totals.lostCount })}
        />
      </div>
      {data.excludedOtherCurrency > 0 && <Alert tone="info">{t("revenue.otherCurrency", { count: data.excludedOtherCurrency, currency: data.currency })}</Alert>}
      {empty ? (
        <EmptyState icon={<Banknote />} title={t("noDataTitle")} description={t("noDataRange", { range: rangeLabel })} />
      ) : (
        <div className="grid gap-4 xl:grid-cols-3">
          <ChartFrame
            className="xl:col-span-2"
            title={t("revenue.overTime")}
            description={rangeLabel}
            table={{
              head: [t("table.period"), t("revenue.wonDeals"), t("revenue.won")],
              rows: data.series.map((s) => [formatBucket(s.bucket, data.bucket, locale, { long: true }), String(s.wonCount), m(s.wonValueCents)]),
            }}
          >
            <TimeBars
              data={data.series}
              series={[{ key: "wonValueCents", label: t("revenue.won"), slot: 1 }]}
              bucket={data.bucket}
              format={money}
              ariaLabel={t("revenue.overTime")}
            />
          </ChartFrame>
          <ChartFrame
            title={t("revenue.lostReasons")}
            description={t("revenue.lostReasonsHint")}
            table={{ head: [t("table.reason"), t("table.deals")], rows: data.lostReasons.map((l) => [l.label ?? t("revenue.noReason"), String(l.count)]) }}
          >
            {data.lostReasons.length ? (
              <CategoryBars
                data={data.lostReasons.map((l) => ({ name: l.label ?? t("revenue.noReason"), value: l.count }))}
                format={{ kind: "count" }}
                label={t("table.deals")}
                slot={2}
                ariaLabel={t("revenue.lostReasons")}
              />
            ) : (
              <p className="py-10 text-center text-sm text-muted-foreground">{t("revenue.noLost")}</p>
            )}
          </ChartFrame>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- pipeline */

export async function PipelineView({ data }: { data: PipelineReport }) {
  const { t, locale } = await ctx();
  const money: ValueFormat = { kind: "money", currency: data.currency };
  const m = (v: number | null) => formatValue(v, money, locale);
  if (!data.pipelineId) return <EmptyState icon={<Target />} title={t("pipeline.none")} />;
  const open = data.stages.filter((s) => s.kind === "open");
  const funnel = data.stages.filter((s) => s.kind !== "lost");
  return (
    <div className="space-y-6">
      <div className={grid}>
        <KpiTile label={t("pipeline.openValue")} value={m(data.totals.openValueCents)} icon={<Banknote />} testId="kpi-pipeline-open" />
        <KpiTile label={t("pipeline.weighted")} value={m(data.totals.weightedValueCents)} icon={<Target />} hint={t("pipeline.weightedHint")} />
        <KpiTile label={t("pipeline.openDeals")} value={formatValue(data.totals.openCount, { kind: "count" }, locale)} icon={<Handshake />} />
        <KpiTile label={t("pipeline.created")} value={formatValue(data.totals.createdInRange, { kind: "count" }, locale)} icon={<Sparkles />} hint={t("pipeline.createdHint")} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <ChartFrame
          title={t("pipeline.byStage")}
          description={t("pipeline.byStageHint")}
          table={{
            head: [t("table.stage"), t("table.deals"), t("pipeline.openValue"), t("pipeline.weighted"), t("pipeline.avgDays")],
            rows: open.map((s) => [s.name, String(s.openCount), m(s.openValueCents), m(s.weightedValueCents), s.avgDaysInStage === null ? "—" : formatValue(s.avgDaysInStage, { kind: "days" }, locale)]),
          }}
        >
          <CategoryBars data={open.map((s) => ({ name: s.name, value: s.openValueCents }))} format={money} label={t("pipeline.openValue")} ariaLabel={t("pipeline.byStage")} />
        </ChartFrame>
        <ChartFrame
          title={t("pipeline.funnel")}
          description={t("pipeline.funnelHint")}
          table={{ head: [t("table.stage"), t("pipeline.reached")], rows: funnel.map((s) => [s.name, String(s.reachedCount)]) }}
        >
          <CategoryBars data={funnel.map((s) => ({ name: s.name, value: s.reachedCount }))} format={{ kind: "count" }} label={t("pipeline.reached")} ariaLabel={t("pipeline.funnel")} />
        </ChartFrame>
      </div>
      <ChartFrame
        title={t("pipeline.forecast")}
        description={t("pipeline.forecastHint")}
        table={{
          head: [t("table.month"), t("table.deals"), t("pipeline.openValue"), t("pipeline.weighted")],
          rows: data.forecast.map((f) => [formatBucket(f.month, "month", locale, { long: true }), String(f.count), m(f.valueCents), m(f.weightedValueCents)]),
        }}
      >
        <TimeBars
          data={data.forecast.map((f) => ({ bucket: f.month, weightedValueCents: f.weightedValueCents }))}
          series={[{ key: "weightedValueCents", label: t("pipeline.weighted"), slot: 1 }]}
          bucket="month"
          format={money}
          ariaLabel={t("pipeline.forecast")}
        />
        {(data.overdue.count > 0 || data.noCloseDate.count > 0) && (
          <p className="mt-3 text-xs text-muted-foreground">
            {data.overdue.count > 0 && t("pipeline.overdue", { count: data.overdue.count, value: m(data.overdue.valueCents) })}{" "}
            {data.noCloseDate.count > 0 && t("pipeline.noDate", { count: data.noCloseDate.count, value: m(data.noCloseDate.valueCents) })}
          </p>
        )}
      </ChartFrame>
    </div>
  );
}

/* ------------------------------------------------------------------- leads */

const SOURCE_SLOTS: Slot[] = [1, 2, 3, 4, 5, 6];

export async function LeadsView({ data, rangeLabel }: { data: LeadsReport; rangeLabel: string }) {
  const { t, locale } = await ctx();
  const lt = looseTranslator(t);
  const sourceLabel = (s: string) => (lt.has(`sources.${s}`) ? lt.t(`sources.${s}`) : s);
  // Slots follow the source (fixed order by overall volume), never re-cycled.
  const series: SeriesDef[] = data.sources.map((s, i) => ({ key: s, label: sourceLabel(s), slot: SOURCE_SLOTS[Math.min(i, 5)] }));
  return (
    <div className="space-y-6">
      <div className={grid}>
        <KpiTile
          label={t("leads.new")}
          value={formatValue(data.totals.created, { kind: "count" }, locale)}
          icon={<Sparkles />}
          testId="kpi-leads-new"
          delta={{ pct: data.totals.changePct, formatted: signedPct(data.totals.changePct, locale), periodLabel: t("vsPrevious") }}
        />
        <KpiTile label={t("leads.conversion")} value={formatPercent(data.totals.conversionRate, locale)} icon={<Percent />} hint={t("leads.conversionHint")} />
        <KpiTile label={t("leads.converted")} value={formatValue(data.totals.converted, { kind: "count" }, locale)} icon={<Trophy />} />
        <KpiTile label={t("leads.timeToConvert")} value={formatDuration(data.totals.medianSecondsToConvert, locale)} icon={<Clock />} hint={t("median")} />
      </div>
      {data.totals.created === 0 ? (
        <EmptyState icon={<Sparkles />} title={t("noDataTitle")} description={t("noDataRange", { range: rangeLabel })} />
      ) : (
        <>
          <ChartFrame
            title={t("leads.bySourceOverTime")}
            description={rangeLabel}
            legend={series}
            table={{
              head: [t("table.period"), ...series.map((s) => s.label)],
              rows: data.series.map((row) => [formatBucket(row.bucket, data.bucket, locale, { long: true }), ...series.map((s) => String(row[s.key] ?? 0))]),
            }}
          >
            <TimeBars data={data.series} series={series} bucket={data.bucket} format={{ kind: "count" }} ariaLabel={t("leads.bySourceOverTime")} />
          </ChartFrame>
          <div className="grid gap-4 xl:grid-cols-2">
            <ChartFrame title={t("leads.byStatus")} table={{ head: [t("table.status"), t("table.leads")], rows: data.byStatus.map((s) => [t(`statuses.${s.status}` as "statuses.new"), String(s.count)]) }}>
              <CategoryBars data={data.byStatus.map((s) => ({ name: t(`statuses.${s.status}` as "statuses.new"), value: s.count }))} format={{ kind: "count" }} label={t("table.leads")} ariaLabel={t("leads.byStatus")} />
            </ChartFrame>
            <ChartFrame
              title={t("leads.aiClasses")}
              description={t("leads.aiClassesHint")}
              table={{ head: [t("table.class"), t("table.leads")], rows: data.classification.map((c) => [t(`classes.${c.label}` as "classes.hot"), String(c.count)]) }}
            >
              <CategoryBars data={data.classification.map((c) => ({ name: t(`classes.${c.label}` as "classes.hot"), value: c.count }))} format={{ kind: "count" }} label={t("table.leads")} slot={1} ariaLabel={t("leads.aiClasses")} />
            </ChartFrame>
          </div>
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------- team */

export async function TeamView({ data }: { data: TeamReport }) {
  const { t, locale } = await ctx();
  const money: ValueFormat = { kind: "money", currency: data.currency };
  const members = data.members;
  if (!members.length) return <EmptyState icon={<Users />} title={t("noDataTitle")} />;
  return (
    <div className="space-y-6">
      <ChartFrame
        title={t("team.wonByMember")}
        table={{ head: [t("table.member"), t("revenue.won")], rows: members.map((mb) => [mb.name, formatValue(mb.wonValueCents, money, locale)]) }}
      >
        <CategoryBars data={members.map((mb) => ({ name: mb.name, value: mb.wonValueCents }))} format={money} label={t("revenue.won")} ariaLabel={t("team.wonByMember")} />
      </ChartFrame>
      <div className="overflow-hidden">
        <Table>
          <THead>
            <TR className="hover:bg-transparent">
              <TH>{t("table.member")}</TH>
              <TH>{t("team.won")}</TH>
              <TH>{t("revenue.winRate")}</TH>
              <TH>{t("team.activities")}</TH>
              <TH>{t("team.tasksDone")}</TH>
              <TH>{t("team.conversations")}</TH>
              <TH>{t("team.firstResponse")}</TH>
            </TR>
          </THead>
          <TBody>
            {members.map((mb) => (
              <TR key={mb.userId} data-testid="team-row" className="whitespace-nowrap">
                <TD className="font-medium">{mb.name}</TD>
                <TD className="tabular">
                  {mb.wonCount} · {formatValue(mb.wonValueCents, money, locale)}
                </TD>
                <TD className="tabular">{formatPercent(mb.winRate, locale)}</TD>
                <TD className="tabular text-muted-foreground">
                  {t("team.activityBreakdown", { calls: mb.activities.call, meetings: mb.activities.meeting, emails: mb.activities.email, notes: mb.activities.note })}
                </TD>
                <TD className="tabular">{mb.tasksCompleted}</TD>
                <TD className="tabular">{mb.conversationsHandled}</TD>
                <TD className="tabular">
                  {formatDuration(mb.medianFirstResponseSeconds, locale)}
                  {mb.responses > 0 && <span className="text-xs text-muted-foreground"> ({t("team.responses", { count: mb.responses })})</span>}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        <p className="mt-2 text-xs text-muted-foreground">{t("team.firstResponseHint")}</p>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- customers */

export async function CustomersView({ data, rangeLabel }: { data: CustomersReport; rangeLabel: string }) {
  const { t, tc, locale } = await ctx();
  const lc = looseTranslator(tc);
  const stageLabel = (s: string) => (lc.has(`stages.${s}`) ? lc.t(`stages.${s}`) : s);
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <KpiTile label={t("customers.total")} value={formatValue(data.totals.total, { kind: "count" }, locale)} icon={<Users />} />
        <KpiTile
          label={t("customers.new")}
          value={formatValue(data.totals.created, { kind: "count" }, locale)}
          icon={<Sparkles />}
          testId="kpi-customers-new"
          delta={{ pct: data.totals.changePct, formatted: signedPct(data.totals.changePct, locale), periodLabel: t("vsPrevious") }}
        />
        <KpiTile label={t("customers.active")} value={formatValue(data.totals.active, { kind: "count" }, locale)} icon={<Target />} hint={t("customers.activeHint")} />
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <ChartFrame
          className="xl:col-span-2"
          title={t("customers.newOverTime")}
          description={rangeLabel}
          table={{ head: [t("table.period"), t("customers.new")], rows: data.series.map((s) => [formatBucket(s.bucket, data.bucket, locale, { long: true }), String(s.created)]) }}
        >
          <TrendArea data={data.series} dataKey="created" label={t("customers.new")} bucket={data.bucket} format={{ kind: "count" }} ariaLabel={t("customers.newOverTime")} />
        </ChartFrame>
        <ChartFrame
          title={t("customers.lifecycle")}
          description={t("customers.lifecycleHint")}
          table={{ head: [t("table.stage"), t("table.contacts")], rows: data.lifecycle.map((l) => [stageLabel(l.stage), String(l.count)]) }}
        >
          {data.lifecycle.length ? (
            <CategoryBars data={data.lifecycle.map((l) => ({ name: stageLabel(l.stage), value: l.count }))} format={{ kind: "count" }} label={t("table.contacts")} ariaLabel={t("customers.lifecycle")} />
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">{t("noDataTitle")}</p>
          )}
        </ChartFrame>
      </div>
    </div>
  );
}

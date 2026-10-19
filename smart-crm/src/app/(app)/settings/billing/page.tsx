import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { AlertTriangle, Sparkles } from "lucide-react";
import { requireTenant } from "@/server/tenancy";
import { getBillingOverview, listInvoices } from "@/modules/billing/service";
import { trialDaysLeft } from "@/modules/billing/entitlements";
import { planPriceCents } from "@/modules/billing/plans";
import { PlanPicker } from "@/modules/billing/components/plan-picker";
import { SubscriptionActions } from "@/modules/billing/components/subscription-actions";
import { UsageMeter } from "@/modules/billing/components/usage-meter";
import { Alert, Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, PageHeader } from "@/components/ui/primitives";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDate, formatDateTime, formatMoney, formatNumber } from "@/lib/format";

export async function generateMetadata() {
  return { title: (await getTranslations("settings"))("sections.billing") };
}

const STATUS_TONE: Record<string, "success" | "warning" | "danger" | "ai" | "neutral"> = {
  active: "success",
  trialing: "ai",
  past_due: "warning",
  canceled: "danger",
  incomplete: "warning",
  paused: "neutral",
};

export default async function BillingPage({ searchParams }: PageProps<"/settings/billing">) {
  const { ctx } = await requireTenant();
  if (!ctx.can("billing.view")) redirect("/settings");
  const { checkout } = await searchParams;
  const t = await getTranslations("billing");
  const locale = (await getLocale()) as "he" | "en";
  const [overview, invoices] = await Promise.all([getBillingOverview(ctx), listInvoices(ctx)]);
  const { subscription: sub, plan } = overview;
  const canManage = ctx.can("billing.manage") && !ctx.readOnly;
  const trialDays = trialDaysLeft({ status: sub.status, trialEndsAt: sub.trialEndsAt });
  const perSeat = planPriceCents(plan, sub.interval);
  const fmt = (n: number) => formatNumber(n, locale);
  const actionLabel = (action: string) => {
    const key = `actions.${action.replace(/^billing\./, "")}` as "actions.plan_changed";
    return t.has(key) ? t(key) : action;
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("subtitle")} />

      {overview.providerKind === "mock" && (
        <Alert tone="info" title={t("mockTitle")}>
          {t("mockBody")}
        </Alert>
      )}
      {checkout === "success" && <Alert tone="success">{t("checkoutSuccess")}</Alert>}
      {checkout === "canceled" && <Alert tone="warning">{t("checkoutCanceled")}</Alert>}
      {sub.status === "past_due" && (
        <Alert tone="danger" title={t("pastDueTitle")}>
          {t("pastDueBody")}
        </Alert>
      )}
      {sub.status === "canceled" && (
        <Alert tone="danger" title={t("canceledTitle")}>
          {t("canceledBody")}
        </Alert>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>{t("currentPlanTitle")}</CardTitle>
              <CardDescription>{t("currentPlanHelp")}</CardDescription>
            </div>
            <Badge tone={STATUS_TONE[sub.status] ?? "neutral"} data-testid="subscription-status">
              {t(`status.${sub.status}` as "status.active")}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-2xl font-semibold" data-testid="current-plan-name">
                {plan.name[locale]}
              </span>
              {perSeat > 0 && (
                <span className="text-sm text-muted-foreground">
                  {formatMoney(perSeat, plan.currency, locale)} {t(sub.interval === "year" ? "perSeatYear" : "perSeatMonth")} ×{" "}
                  {t("seatsCount", { n: sub.seats })} ={" "}
                  <span className="tabular font-medium text-foreground">{formatMoney(perSeat * Math.max(1, sub.seats), plan.currency, locale)}</span>
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {trialDays !== null ? (
                <span className="inline-flex items-center gap-1.5 text-ai-foreground">
                  <Sparkles className="size-4" /> {t("trialEnds", { days: trialDays, date: formatDate(sub.trialEndsAt, locale) })}
                </span>
              ) : sub.cancelAtPeriodEnd ? (
                <span className="inline-flex items-center gap-1.5 text-warning-foreground">
                  <AlertTriangle className="size-4" /> {t("endsOn", { date: formatDate(sub.currentPeriodEnd, locale) })}
                </span>
              ) : sub.currentPeriodEnd && perSeat > 0 ? (
                t("renewsOn", { date: formatDate(sub.currentPeriodEnd, locale) })
              ) : null}
            </p>
            {canManage ? (
              <SubscriptionActions canCancel={perSeat > 0 && !sub.cancelAtPeriodEnd && sub.status !== "canceled"} canResume={sub.cancelAtPeriodEnd} />
            ) : (
              <p className="text-xs text-muted-foreground">{t("ownerOnly")}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("usageTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4" data-testid="usage-meters">
            <UsageMeter label={t("usage.seats")} used={overview.seatsUsed} limit={overview.seatLimit} formatValue={fmt} unlimitedLabel={t("unlimited")} />
            {overview.usage.map((u) => (
              <UsageMeter key={u.key} label={t(`usage.${u.key}`)} used={u.used} limit={u.limit} formatValue={fmt} unlimitedLabel={t("unlimited")} />
            ))}
            <p className="text-xs text-muted-foreground">{t("usageResets")}</p>
          </CardContent>
        </Card>
      </div>

      <PlanPicker
        plans={overview.plans}
        current={{ planId: sub.planId, interval: sub.interval, status: sub.status, cancelAtPeriodEnd: sub.cancelAtPeriodEnd }}
        canManage={canManage}
      />

      <Card>
        <CardHeader>
          <div>
            <CardTitle>{t("invoicesTitle")}</CardTitle>
            <CardDescription>{t("invoicesHelp")}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {invoices.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("noInvoices")}</p>
          ) : (
            <Table>
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>{t("invoiceNumber")}</TH>
                  <TH>{t("period")}</TH>
                  <TH>{t("amount")}</TH>
                  <TH>{t("invoiceStatus")}</TH>
                  <TH>
                    <span className="sr-only">{t("viewInvoice")}</span>
                  </TH>
                </TR>
              </THead>
              <TBody>
                {invoices.map((inv) => (
                  <TR key={inv.id}>
                    <TD className="font-medium">
                      <span dir="ltr">{inv.number ?? inv.id}</span> {inv.sample && <Badge tone="warning">{t("sample")}</Badge>}
                    </TD>
                    <TD className="text-muted-foreground">
                      {formatDate(inv.periodStart, locale)} – {formatDate(inv.periodEnd, locale)}
                    </TD>
                    <TD className="tabular">{formatMoney(inv.amountCents, inv.currency, locale)}</TD>
                    <TD>
                      <Badge tone={inv.status === "paid" ? "success" : inv.status === "open" ? "warning" : "neutral"}>{t(`invoiceStatuses.${inv.status}`)}</Badge>
                    </TD>
                    <TD className="text-end">
                      {inv.hostedUrl && (
                        <a href={inv.hostedUrl} target="_blank" rel="noreferrer noopener" className="text-sm font-medium text-primary hover:underline">
                          {t("viewInvoice")}
                        </a>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("historyTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {overview.history.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">{t("noHistory")}</p>
          ) : (
            <ul className="divide-y divide-border text-sm" data-testid="billing-history">
              {overview.history.map((h) => (
                <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span>
                    <span className="font-medium">{actionLabel(h.action)}</span>
                    {typeof h.metadata.to === "string" && <span className="text-muted-foreground"> · {h.metadata.to}</span>}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {h.actorName ?? t("systemActor")} · {formatDateTime(h.createdAt, locale)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

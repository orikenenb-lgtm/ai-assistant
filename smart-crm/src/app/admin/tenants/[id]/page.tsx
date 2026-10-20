import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { requireSuperAdmin } from "@/modules/admin/request";
import { getTenantDetail, listFeatureFlags } from "@/modules/admin/service";
import { listPlans } from "@/modules/billing/plans";
import { isAppError } from "@/server/errors";
import { db } from "@/server/db";
import {
  AdminPlanForm,
  DeletionControls,
  OverrideEditor,
  StartSupportButton,
  StatusControls,
  TenantFlagOverrides,
} from "@/modules/admin/components/tenant-controls";
import { Avatar, Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, StatCard } from "@/components/ui/primitives";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";

export default async function AdminTenantPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireSuperAdmin();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let d: Awaited<ReturnType<typeof getTenantDetail>>;
  try {
    d = await getTenantDetail(actor, id);
  } catch (e) {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const t = await getTranslations("admin");
  const tm = await getTranslations("members");
  const locale = (await getLocale()) as "he" | "en";
  const [plans, flags] = await Promise.all([listPlans(db(), { includeInactive: true }), listFeatureFlags(actor)]);
  const n = (v: number) => formatNumber(v, locale);
  const { tenant, subscription: sub } = d;
  const isMember = d.members.some((m) => m.userId === actor.userId);
  const stripeManaged = Boolean(sub && sub.provider === "stripe" && sub.providerSubscriptionId && sub.status !== "canceled");

  const breadcrumbLabel = (await getTranslations("common"))("breadcrumb");
  return (
    <div className="space-y-6">
      <nav aria-label={breadcrumbLabel} className="text-sm text-muted-foreground">
        <Link href="/admin/tenants" className="hover:text-foreground">
          {t("tenants.title")}
        </Link>{" "}
        / <span className="text-foreground">{tenant.name}</span>
      </nav>

      <Card className="p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <Avatar name={tenant.name} size="lg" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{tenant.name}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span dir="ltr">{tenant.slug}</span>
              <span dir="ltr" className="font-mono text-xs">
                {tenant.id}
              </span>
              {tenant.deletedAt ? (
                <Badge tone="danger">{t("tenant.deletionScheduled", { date: formatDate(tenant.purgeAfter, locale) })}</Badge>
              ) : (
                <Badge tone={tenant.status === "active" ? "success" : "warning"} data-testid="tenant-status">
                  {t(`tenantStatus.${tenant.status}` as "tenantStatus.active")}
                </Badge>
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <StartSupportButton tenantId={tenant.id} tenantName={tenant.name} disabled={isMember || Boolean(tenant.deletedAt)} />
            {!tenant.deletedAt && <StatusControls tenantId={tenant.id} status={tenant.status} />}
            <DeletionControls tenantId={tenant.id} slug={tenant.slug} deleted={Boolean(tenant.deletedAt)} />
          </div>
        </div>
        {isMember && <p className="mt-3 text-xs text-muted-foreground">{t("support.memberNote")}</p>}
      </Card>

      <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-6">
        <StatCard label={t("tenant.members")} value={n(d.members.filter((m) => m.status === "active").length)} />
        <StatCard label={t("limits.max_contacts")} value={n(d.usage.contacts)} />
        <StatCard label={t("tenant.conversations")} value={n(d.usage.conversations)} />
        <StatCard label={t("limits.ai_tokens_monthly")} value={n(d.usage.aiTokens)} />
        <StatCard label={t("limits.whatsapp_messages_monthly")} value={n(d.usage.whatsappMessages)} />
        <StatCard label={t("limits.storage_mb")} value={n(d.usage.storageMb)} />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>{t("tenant.subscription")}</CardTitle>
              <CardDescription>
                {d.plan ? d.plan.name[locale] : "—"}
                {sub && (
                  <>
                    {" · "}
                    {t(`subStatus.${sub.status}` as "subStatus.active")} · {sub.provider}
                    {sub.trialEndsAt && sub.status === "trialing" && ` · ${t("tenant.trialUntil", { date: formatDate(sub.trialEndsAt, locale) })}`}
                    {sub.cancelAtPeriodEnd && ` · ${t("tenant.cancelAtPeriodEnd")}`}
                  </>
                )}
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <AdminPlanForm
              tenantId={tenant.id}
              plans={plans.map((p) => ({ id: p.id, name: p.name[locale] }))}
              currentPlanId={sub?.planId ?? null}
              currentInterval={(sub?.billingInterval as "month" | "year") ?? "month"}
              stripeManaged={stripeManaged}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("tenant.membersTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>{t("tenant.member")}</TH>
                  <TH>{t("tenant.role")}</TH>
                  <TH>{t("tenants.status")}</TH>
                </TR>
              </THead>
              <TBody>
                {d.members.map((m) => (
                  <TR key={m.userId}>
                    <TD>
                      <span className="block font-medium">{m.fullName || "—"}</span>
                      <span className="block text-xs text-muted-foreground" dir="ltr">
                        {m.email}
                      </span>
                    </TD>
                    <TD>{tm(`roles.${m.role}` as "roles.agent")}</TD>
                    <TD>
                      <Badge tone={m.status === "active" ? "success" : "neutral"}>{tm(m.status === "active" ? "active" : "disabled")}</Badge>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>{t("tenant.overrideTitle")}</CardTitle>
            <CardDescription>{t("tenant.overrideHelp")}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <OverrideEditor
            tenantId={tenant.id}
            planFeatures={d.plan?.features ?? []}
            initial={{
              limits: (d.override?.limits ?? {}) as Record<string, number>,
              featuresAdd: d.override?.featuresAdd ?? [],
              featuresRemove: d.override?.featuresRemove ?? [],
              note: d.override?.note ?? null,
            }}
          />
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("flags.title")}</CardTitle>
          </CardHeader>
          <CardContent>
            <TenantFlagOverrides
              tenantId={tenant.id}
              flags={flags.map((f) => ({ key: f.key, globalEnabled: f.enabled, override: d.flags.find((o) => o.flagKey === f.key)?.enabled ?? null }))}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("support.recent")}</CardTitle>
          </CardHeader>
          <CardContent>
            {d.sessions.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("support.none")}</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {d.sessions.map((s) => (
                  <li key={s.id} className="rounded-lg border border-border px-3 py-2">
                    <p className="font-medium">
                      {s.adminName ?? "—"} · {formatDateTime(s.startedAt, locale)}
                    </p>
                    <p className="text-muted-foreground" dir="auto">
                      {s.reason}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

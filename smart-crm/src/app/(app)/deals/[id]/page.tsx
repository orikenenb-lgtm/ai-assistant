import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Building2, CalendarClock, FileText, Mail, Phone, User } from "lucide-react";
import { requireTenant } from "@/server/tenancy";
import { isAppError } from "@/server/errors";
import { dealStageHistory, getDeal } from "@/modules/sales/deals";
import { listLostReasons, listPipelines } from "@/modules/sales/pipelines";
import { DealFormDialog } from "@/modules/sales/components/deal-form-dialog";
import { DealDeleteButton, DealStageProgress, DealStatusButtons, DealTagsEditor } from "@/modules/sales/components/deal-actions-ui";
import { DetailRow, RecordTabs, formatCustomValue } from "@/modules/sales/components/shared";
import { dealStatusTone } from "@/modules/sales/components/badges";
import type { DealStatus } from "@/modules/sales/schemas";
import { listTags } from "@/modules/crm/tags";
import { listAssignableMembers } from "@/modules/org/members";
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { formatPhone } from "@/lib/phone";

async function load(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const tc = await requireTenant();
  try {
    return { tc, data: await getDeal(tc.ctx, id) };
  } catch (e) {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  }
}

function todayIn(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export async function generateMetadata({ params }: PageProps<"/deals/[id]">) {
  const { id } = await params;
  const { data } = await load(id);
  return { title: data.deal.title };
}

export default async function DealPage({ params }: PageProps<"/deals/[id]">) {
  const { id } = await params;
  const { tc, data } = await load(id);
  const { ctx, user, tenant } = tc;
  const { deal: d, pipeline, contact, company, owner, lostReason, tags, customFieldDefs } = data;
  const t = await getTranslations("deals");
  const tcm = await getTranslations("common");
  const locale = (await getLocale()) as "he" | "en";
  const [allTags, members, pipelines, lostReasons, history] = await Promise.all([
    listTags(ctx),
    listAssignableMembers(ctx),
    listPipelines(ctx),
    listLostReasons(ctx, { activeOnly: true }),
    dealStageHistory(ctx, d.id),
  ]);
  const canEdit = ctx.can("deals.update") && !ctx.readOnly;
  const status = d.status as DealStatus;
  const stages = pipeline?.stages ?? [];
  const stage = stages.find((s) => s.id === d.stageId);
  const stageName = (sid: string | null) => stages.find((s) => s.id === sid)?.name ?? "—";
  const effectiveProbability = d.probability ?? stage?.probability ?? 0;
  const overdue = status === "open" && d.expectedCloseDate != null && d.expectedCloseDate < todayIn(tenant.timezone);

  // The edit form needs the deal's pipeline even when it is archived.
  const pipelineOptions = (pipeline && !pipelines.some((p) => p.id === pipeline.id) ? [...pipelines, pipeline] : pipelines).map((p) => ({
    id: p.id,
    name: p.name,
    isDefault: p.isDefault,
    stages: p.stages.map((s) => ({ id: s.id, name: s.name, kind: s.kind, probability: s.probability })),
  }));

  return (
    <div className="space-y-6">
      <nav aria-label="breadcrumb" className="text-sm text-muted-foreground">
        <Link href="/deals" className="hover:text-foreground">
          {t("title")}
        </Link>{" "}
        / <span className="text-foreground">{d.title}</span>
      </nav>

      <Card className="p-5 sm:p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-semibold tracking-tight" dir="auto">
              {d.title}
            </h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span className="tabular text-lg font-semibold text-foreground" data-testid="deal-value">
                {formatMoney(d.valueCents, d.currency, locale)}
              </span>
              <Badge tone={dealStatusTone(status)} data-testid="deal-status">
                {t(`statuses.${status}`)}
              </Badge>
              {pipeline && <span>{pipeline.name}</span>}
              {company && (
                <Link href={`/companies/${company.id}`} className="inline-flex items-center gap-1 hover:text-foreground hover:underline" dir="auto">
                  <Building2 className="size-3.5" /> {company.name}
                </Link>
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canEdit && <DealStatusButtons dealId={d.id} status={status} reasons={lostReasons} />}
            {canEdit && (
              <DealFormDialog
                members={members}
                tags={allTags}
                customFieldDefs={customFieldDefs}
                pipelines={pipelineOptions}
                defaultCurrency={tenant.currency}
                trigger={
                  <Button variant="secondary" size="sm">
                    {tcm("edit")}
                  </Button>
                }
                initial={{
                  id: d.id,
                  title: d.title,
                  valueCents: d.valueCents,
                  currency: d.currency,
                  pipelineId: d.pipelineId,
                  stageId: d.stageId,
                  probability: d.probability,
                  expectedCloseDate: d.expectedCloseDate,
                  contact: contact ? { id: contact.id, name: contact.name ?? "—" } : null,
                  company: company ? { id: company.id, name: company.name } : null,
                  ownerId: d.ownerId,
                  customFields: d.customFields as Record<string, unknown>,
                  tagIds: tags.map((x) => x.id),
                }}
              />
            )}
            {ctx.can("deals.delete") && !ctx.readOnly && <DealDeleteButton dealId={d.id} name={d.title} />}
          </div>
        </div>
        {stages.length > 0 && (
          <div className="mt-5 border-t border-border pt-4">
            <DealStageProgress
              dealId={d.id}
              stages={stages.map((s) => ({ id: s.id, name: s.name, kind: s.kind, color: s.color, probability: s.probability }))}
              currentStageId={d.stageId}
              status={status}
              canEdit={canEdit}
            />
          </div>
        )}
        {status === "won" && d.wonAt && (
          <Alert tone="success" className="mt-5">
            {t("wonOn", { date: formatDate(d.wonAt, locale, tenant.timezone) })}
          </Alert>
        )}
        {status === "lost" && (
          <Alert tone="danger" className="mt-5" title={d.lostAt ? t("lostOn", { date: formatDate(d.lostAt, locale, tenant.timezone) }) : t("statuses.lost")}>
            <span className="block">
              {t("lostInfo")}: {lostReason?.label ?? t("noReason")}
            </span>
            {d.lostNote && (
              <span className="mt-1 block whitespace-pre-wrap" dir="auto">
                {d.lostNote}
              </span>
            )}
          </Alert>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t("details")}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-3 text-sm">
                <DetailRow label={t("stage")}>
                  {stage ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="size-2 rounded-full" style={{ backgroundColor: stage.color }} aria-hidden />
                      {stage.name}
                    </span>
                  ) : (
                    "—"
                  )}
                </DetailRow>
                <DetailRow label={t("probability")}>
                  {d.probability != null ? `${d.probability}%` : t("probabilityDefault", { value: effectiveProbability })}
                </DetailRow>
                {status === "open" && (
                  <DetailRow label={t("weightedValue")}>{formatMoney(Math.round((d.valueCents * effectiveProbability) / 100), d.currency, locale)}</DetailRow>
                )}
                <DetailRow icon={<CalendarClock className="size-4" />} label={t("expectedClose")}>
                  {d.expectedCloseDate ? (
                    <span className={overdue ? "text-danger-foreground" : undefined}>
                      {formatDate(d.expectedCloseDate, locale)}
                      {overdue && <Badge tone="danger" className="ms-2">{t("overdue")}</Badge>}
                    </span>
                  ) : (
                    t("closeDateMissing")
                  )}
                </DetailRow>
                <DetailRow icon={<User className="size-4" />} label={tcm("owner")}>
                  {owner?.fullName ?? tcm("unassigned")}
                </DetailRow>
                <DetailRow label={t("createdAt")}>{formatDateTime(d.createdAt, locale, tenant.timezone)}</DetailRow>
                {customFieldDefs.map((def) => (
                  <DetailRow key={def.id} label={def.label}>
                    {formatCustomValue((d.customFields as Record<string, unknown>)[def.key], tcm("yes"), tcm("no"))}
                  </DetailRow>
                ))}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("linked")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">{t("contact")}</p>
                {contact ? (
                  <div className="space-y-1">
                    <Link href={`/contacts/${contact.id}`} className="font-medium hover:underline" dir="auto">
                      {contact.name}
                    </Link>
                    {contact.phone && (
                      <a href={`tel:${contact.phone}`} className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground" dir="ltr">
                        <Phone className="size-3.5" /> {formatPhone(contact.phone)}
                      </a>
                    )}
                    {contact.email && (
                      <a href={`mailto:${contact.email}`} className="flex items-center gap-1.5 break-all text-muted-foreground hover:text-foreground" dir="ltr">
                        <Mail className="size-3.5" /> {contact.email}
                      </a>
                    )}
                  </div>
                ) : (
                  <p className="text-muted-foreground">—</p>
                )}
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">{t("company")}</p>
                {company ? (
                  <Link href={`/companies/${company.id}`} className="font-medium hover:underline" dir="auto">
                    {company.name}
                  </Link>
                ) : (
                  <p className="text-muted-foreground">—</p>
                )}
              </div>
              {d.leadId && (
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">{t("fromLead")}</p>
                  <Link href={`/leads/${d.leadId}`} className="font-medium hover:underline">
                    {t("viewLead")}
                  </Link>
                </div>
              )}
              <div className="border-t border-border pt-4">
                <Button variant="secondary" size="sm" asChild>
                  <Link href={`/quotes?deal=${d.id}`}>
                    <FileText /> {t("viewQuotes")}
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{tcm("tags")}</CardTitle>
            </CardHeader>
            <CardContent>
              <DealTagsEditor dealId={d.id} allTags={allTags} initial={tags.map((x) => x.id)} canEdit={canEdit} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("history")}</CardTitle>
            </CardHeader>
            <CardContent>
              {history.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("noHistory")}</p>
              ) : (
                <ol className="space-y-3 border-s border-border ps-4 text-sm" data-testid="stage-history">
                  {history.map(({ h, by }) => (
                    <li key={h.id} className="relative">
                      <span className="absolute -start-[21px] top-1.5 size-2 rounded-full bg-primary" aria-hidden />
                      <p className="font-medium">
                        {h.fromStageId ? t("historyMoved", { from: stageName(h.fromStageId), to: stageName(h.toStageId) }) : t("historyCreated", { stage: stageName(h.toStageId) })}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(h.changedAt, locale, tenant.timezone)}
                        {by ? ` · ${t("byUser", { name: by })}` : ""}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>
        <RecordTabs kind="deal" entityId={d.id} currentUserId={user.userId} canEdit={canEdit} canModerate={ctx.role === "owner" || ctx.role === "manager"} />
      </div>
    </div>
  );
}

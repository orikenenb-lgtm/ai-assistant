import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Building2, Mail, Phone, Sparkles } from "lucide-react";
import { requireTenant } from "@/server/tenancy";
import { isAppError } from "@/server/errors";
import { getLead, leadDisplayName } from "@/modules/sales/leads";
import { listPipelines } from "@/modules/sales/pipelines";
import { LeadFormDialog } from "@/modules/sales/components/lead-form-dialog";
import { ConvertLeadDialog, LeadDeleteButton, LeadStatusActions, LeadTagsEditor } from "@/modules/sales/components/lead-detail";
import { DetailRow, RecordTabs, formatCustomValue } from "@/modules/sales/components/shared";
import { aiTone, leadStatusTone } from "@/modules/sales/components/badges";
import type { LeadStatus } from "@/modules/sales/schemas";
import { listTags } from "@/modules/crm/tags";
import { listAssignableMembers } from "@/modules/org/members";
import { Alert, Avatar, Badge, Card, CardContent, CardHeader, CardTitle } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatMoney } from "@/lib/format";
import { formatPhone } from "@/lib/phone";

async function load(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const tc = await requireTenant();
  try {
    return { tc, data: await getLead(tc.ctx, id) };
  } catch (e) {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  }
}

export async function generateMetadata({ params }: PageProps<"/leads/[id]">) {
  const { id } = await params;
  const { data } = await load(id);
  return { title: leadDisplayName(data.lead) };
}

export default async function LeadPage({ params }: PageProps<"/leads/[id]">) {
  const { id } = await params;
  const { tc, data } = await load(id);
  const { ctx, user, tenant } = tc;
  const { lead: l, owner, contact, deal, tags, customFieldDefs } = data;
  const t = await getTranslations("leads");
  const tcm = await getTranslations("common");
  const locale = (await getLocale()) as "he" | "en";
  const [allTags, members, pipelines] = await Promise.all([listTags(ctx), listAssignableMembers(ctx), ctx.can("deals.view") ? listPipelines(ctx) : Promise.resolve([])]);
  const name = leadDisplayName(l);
  const canEdit = ctx.can("leads.update") && !ctx.readOnly;
  const status = l.status as LeadStatus;
  const converted = status === "converted";

  return (
    <div className="space-y-6">
      <nav aria-label="breadcrumb" className="text-sm text-muted-foreground">
        <Link href="/leads" className="hover:text-foreground">
          {t("title")}
        </Link>{" "}
        / <span className="text-foreground">{name}</span>
      </nav>

      <Card className="p-5 sm:p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <Avatar name={name} size="lg" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-semibold tracking-tight" dir="auto">
              {name}
            </h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              {l.companyName && (
                <span className="inline-flex items-center gap-1" dir="auto">
                  <Building2 className="size-3.5" /> {l.companyName}
                </span>
              )}
              <Badge tone={leadStatusTone(status)} data-testid="lead-status">
                {t(`statuses.${status}`)}
              </Badge>
              {l.aiClassification && (
                <Badge tone={aiTone(l.aiClassification)}>
                  <Sparkles /> {t(`aiClassifications.${l.aiClassification}` as "aiClassifications.hot")}
                </Badge>
              )}
              {l.score != null && <Badge tone="outline">{l.score}/100</Badge>}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!converted && ctx.can("leads.convert") && !ctx.readOnly && (
              <ConvertLeadDialog
                leadId={l.id}
                companyName={l.companyName}
                defaultTitle={l.companyName || name}
                defaultValue={l.estimatedValueCents}
                canCreateDeal={ctx.can("deals.create")}
                pipelines={pipelines.map((p) => ({ id: p.id, name: p.name, isDefault: p.isDefault, stages: p.stages.map((s) => ({ id: s.id, name: s.name, kind: s.kind })) }))}
              />
            )}
            {canEdit && (
              <LeadFormDialog
                members={members}
                tags={allTags}
                customFieldDefs={customFieldDefs}
                trigger={
                  <Button variant="secondary" size="sm">
                    {tcm("edit")}
                  </Button>
                }
                initial={{
                  id: l.id,
                  fullName: l.fullName,
                  email: l.email,
                  phone: l.phone,
                  companyName: l.companyName,
                  source: l.source,
                  score: l.score,
                  estimatedValueCents: l.estimatedValueCents,
                  message: l.message,
                  ownerId: l.ownerId,
                  customFields: l.customFields,
                  tagIds: tags.map((x) => x.id),
                }}
              />
            )}
            {ctx.can("leads.delete") && !ctx.readOnly && <LeadDeleteButton leadId={l.id} name={name} />}
          </div>
        </div>
        {canEdit && !converted && (
          <div className="mt-5 border-t border-border pt-4">
            <LeadStatusActions leadId={l.id} status={status} />
          </div>
        )}
        {converted && (
          <Alert tone="ai" className="mt-5">
            <span className="flex flex-wrap items-center gap-3">
              {t("convertedTo")}
              {contact && (
                <Link href={`/contacts/${contact.id}`} className="font-medium underline">
                  {t("viewContact")}: {contact.name}
                </Link>
              )}
              {deal && (
                <Link href={`/deals/${deal.id}`} className="font-medium underline">
                  {t("viewDeal")}: {deal.title}
                </Link>
              )}
            </span>
          </Alert>
        )}
        {status === "unqualified" && l.unqualifiedReason && (
          <Alert tone="warning" className="mt-5" title={t("unqualifiedReason")}>
            <span dir="auto">{l.unqualifiedReason}</span>
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
                <DetailRow icon={<Phone className="size-4" />} label={tcm("phone")}>
                  {l.phone ? (
                    <a href={`tel:${l.phone}`} dir="ltr" className="hover:underline">
                      {formatPhone(l.phone)}
                    </a>
                  ) : (
                    "—"
                  )}
                </DetailRow>
                <DetailRow icon={<Mail className="size-4" />} label={tcm("email")}>
                  {l.email ? (
                    <a href={`mailto:${l.email}`} dir="ltr" className="break-all hover:underline">
                      {l.email}
                    </a>
                  ) : (
                    "—"
                  )}
                </DetailRow>
                <DetailRow label={t("source")}>{t(`sources.${l.source}` as "sources.manual")}</DetailRow>
                <DetailRow label={t("estimatedValue")}>
                  {l.estimatedValueCents != null ? formatMoney(l.estimatedValueCents, tenant.currency, locale) : "—"}
                </DetailRow>
                <DetailRow label={tcm("owner")}>{owner?.fullName ?? tcm("unassigned")}</DetailRow>
                <DetailRow label={t("receivedAt")}>{formatDateTime(l.createdAt, locale)}</DetailRow>
                {customFieldDefs.map((d) => (
                  <DetailRow key={d.id} label={d.label}>
                    {formatCustomValue(l.customFields[d.key], tcm("yes"), tcm("no"))}
                  </DetailRow>
                ))}
              </dl>
              {l.message && (
                <div className="mt-4 border-t border-border pt-4">
                  <p className="mb-1 text-xs font-medium text-muted-foreground">{t("message")}</p>
                  <p className="whitespace-pre-wrap text-sm" dir="auto">
                    {l.message}
                  </p>
                </div>
              )}
              {l.aiClassificationReason && (
                <div className="mt-4 border-t border-border pt-4">
                  <p className="mb-1 text-xs font-medium text-muted-foreground">{t("aiReason")}</p>
                  <p className="whitespace-pre-wrap text-sm" dir="auto">
                    {l.aiClassificationReason}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{tcm("tags")}</CardTitle>
            </CardHeader>
            <CardContent>
              <LeadTagsEditor leadId={l.id} allTags={allTags} initial={tags.map((x) => x.id)} canEdit={canEdit} />
            </CardContent>
          </Card>
        </div>
        <RecordTabs kind="lead" entityId={l.id} currentUserId={user.userId} canEdit={canEdit} canModerate={ctx.role === "owner" || ctx.role === "manager"} />
      </div>
    </div>
  );
}

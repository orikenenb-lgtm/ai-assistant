import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { and, desc, eq, isNull } from "drizzle-orm";
import { Building2, Mail, MessageCircle, Phone } from "lucide-react";
import { requireTenant } from "@/server/tenancy";
import { isAppError } from "@/server/errors";
import { schema } from "@/server/db";
import { consentHistory, contactDisplayName, getContact } from "@/modules/crm/contacts/service";
import { listTags } from "@/modules/crm/tags";
import { listAssignableMembers } from "@/modules/org/members";
import { ContactFormDialog } from "@/modules/crm/components/contact-form-dialog";
import { ContactDetailTabs, ContactHeaderActions, ConsentCard, ContactTagsEditor } from "@/modules/crm/components/contact-detail";
import { stageTone } from "@/modules/crm/components/stage-badge";
import { Avatar, Badge, Card, CardContent, CardHeader, CardTitle } from "@/components/ui/primitives";
import { ContactAiPanel } from "@/modules/ai/components/contact-ai-panel";
import { isMockAi } from "@/modules/ai/runtime";
import { db } from "@/server/db";
import { getEntitlements } from "@/modules/billing/entitlements";
import { Button } from "@/components/ui/button";
import { formatDate, formatMoney } from "@/lib/format";
import { formatPhone } from "@/lib/phone";

export async function generateMetadata({ params }: PageProps<"/contacts/[id]">) {
  const { id } = await params;
  const { ctx } = await requireTenant();
  try {
    const { contact } = await getContact(ctx, id);
    return { title: contactDisplayName(contact) };
  } catch {
    return { title: "—" };
  }
}

export default async function ContactPage({ params }: PageProps<"/contacts/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const tc0 = await requireTenant();
  const { ctx, user } = tc0;
  let data: Awaited<ReturnType<typeof getContact>>;
  try {
    data = await getContact(ctx, id);
  } catch (e) {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const { contact: c, company, owner, tags, customFieldDefs, counts } = data;
  const t = await getTranslations("contacts");
  const tc = await getTranslations("common");
  const locale = (await getLocale()) as "he" | "en";
  const [allTags, members, consents, deals, tasks] = await Promise.all([
    listTags(ctx),
    listAssignableMembers(ctx),
    consentHistory(ctx, id),
    ctx.run((tx) =>
      tx
        .select({ id: schema.deals.id, title: schema.deals.title, valueCents: schema.deals.valueCents, currency: schema.deals.currency, status: schema.deals.status, stage: schema.pipelineStages.name })
        .from(schema.deals)
        .innerJoin(schema.pipelineStages, eq(schema.pipelineStages.id, schema.deals.stageId))
        .where(and(eq(schema.deals.tenantId, ctx.tenantId), eq(schema.deals.contactId, id), isNull(schema.deals.deletedAt)))
        .orderBy(desc(schema.deals.createdAt))
        .limit(20),
    ),
    ctx.run((tx) =>
      tx
        .select({ id: schema.tasks.id, title: schema.tasks.title, status: schema.tasks.status, dueAt: schema.tasks.dueAt, priority: schema.tasks.priority })
        .from(schema.tasks)
        .where(and(eq(schema.tasks.tenantId, ctx.tenantId), eq(schema.tasks.contactId, id)))
        .orderBy(desc(schema.tasks.createdAt))
        .limit(20),
    ),
  ]);
  const name = contactDisplayName(c);
  const canEdit = ctx.can("contacts.update") && !ctx.readOnly;

  const breadcrumbLabel = (await getTranslations("common"))("breadcrumb");
  return (
    <div className="space-y-6">
      <nav aria-label={breadcrumbLabel} className="text-sm text-muted-foreground">
        <Link href="/contacts" className="hover:text-foreground">
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
              {c.title && <span dir="auto">{c.title}</span>}
              {company && (
                <Link href={`/companies/${company.id}`} className="inline-flex items-center gap-1 hover:text-foreground">
                  <Building2 className="size-3.5" /> {company.name}
                </Link>
              )}
              <Badge tone={stageTone(c.lifecycleStage)}>{t(`stages.${c.lifecycleStage}` as "stages.lead")}</Badge>
              <Badge tone={c.whatsappConsent === "opted_in" ? "success" : c.whatsappConsent === "opted_out" ? "danger" : "neutral"}>
                WhatsApp: {t(`consentStatus.${c.whatsappConsent}` as "consentStatus.unknown")}
              </Badge>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {c.phone && ctx.can("inbox.view") && (
              <Button asChild variant="soft" size="sm">
                <Link href={`/inbox?contact=${c.id}`}>
                  <MessageCircle /> WhatsApp
                </Link>
              </Button>
            )}
            {canEdit && (
              <ContactFormDialog
                members={members}
                tags={allTags}
                customFieldDefs={customFieldDefs}
                trigger={
                  <Button variant="secondary" size="sm">
                    {tc("edit")}
                  </Button>
                }
                initial={{
                  id: c.id,
                  firstName: c.firstName,
                  lastName: c.lastName,
                  email: c.email,
                  phone: c.phone,
                  title: c.title,
                  source: c.source,
                  lifecycleStage: c.lifecycleStage,
                  ownerId: c.ownerId,
                  company,
                  customFields: c.customFields,
                  tagIds: tags.map((x) => x.id),
                }}
              />
            )}
            <ContactHeaderActions contactId={c.id} name={name} canDelete={ctx.can("contacts.delete") && !ctx.readOnly} />
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className="space-y-6">
          {ctx.can("ai.use") && (await getEntitlements(db(), ctx.tenantId)).features.has("ai") && <ContactAiPanel contactId={c.id} mock={isMockAi()} />}
          <Card>
            <CardHeader>
              <CardTitle>{t("details")}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-3 text-sm">
                <DetailRow icon={<Phone className="size-4" />} label={tc("phone")}>
                  {c.phone ? (
                    <a href={`tel:${c.phone}`} dir="ltr" className="hover:underline">
                      {formatPhone(c.phone)}
                    </a>
                  ) : (
                    "—"
                  )}
                </DetailRow>
                <DetailRow icon={<Mail className="size-4" />} label={tc("email")}>
                  {c.email ? (
                    <a href={`mailto:${c.email}`} dir="ltr" className="break-all hover:underline">
                      {c.email}
                    </a>
                  ) : (
                    "—"
                  )}
                </DetailRow>
                <DetailRow label={tc("owner")}>{owner?.fullName ?? tc("unassigned")}</DetailRow>
                <DetailRow label={t("source")}>{c.source ?? "—"}</DetailRow>
                <DetailRow label={tc("createdAt")}>{formatDate(c.createdAt, locale)}</DetailRow>
                {customFieldDefs.map((d) => {
                  const v = c.customFields[d.key];
                  return (
                    <DetailRow key={d.id} label={d.label}>
                      {v === undefined || v === null || v === ""
                        ? "—"
                        : Array.isArray(v)
                          ? v.join(", ")
                          : typeof v === "boolean"
                            ? v
                              ? tc("yes")
                              : tc("no")
                            : String(v)}
                    </DetailRow>
                  );
                })}
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{tc("tags")}</CardTitle>
            </CardHeader>
            <CardContent>
              <ContactTagsEditor contactId={c.id} allTags={allTags} initial={tags.map((x) => x.id)} canEdit={canEdit} />
            </CardContent>
          </Card>
          <ConsentCard
            contactId={c.id}
            status={c.whatsappConsent as "unknown" | "opted_in" | "opted_out"}
            canEdit={ctx.can("inbox.consent") && !ctx.readOnly}
            history={consents.map((h) => ({ id: h.c.id, status: h.c.status, source: h.c.source, evidence: h.c.evidence, by: h.by, at: h.c.createdAt }))}
          />
        </div>

        <ContactDetailTabs
          contactId={c.id}
          currentUserId={user.userId}
          canEdit={canEdit}
          canModerate={ctx.role === "owner" || ctx.role === "manager"}
          counts={{ deals: counts.deals, tasks: counts.open_tasks }}
          deals={deals.map((d) => ({ id: d.id, title: d.title, value: formatMoney(d.valueCents, d.currency, locale), status: d.status, stage: d.stage }))}
          tasks={tasks.map((x) => ({ id: x.id, title: x.title, status: x.status, priority: x.priority, due: x.dueAt ? formatDate(x.dueAt, locale) : null }))}
        />
      </div>
    </div>
  );
}

function DetailRow({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="flex items-center gap-2 text-muted-foreground">
        {icon}
        {label}
      </dt>
      <dd className="min-w-0 text-end font-medium" dir="auto">
        {children}
      </dd>
    </div>
  );
}

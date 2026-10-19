import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Building2, Briefcase, User } from "lucide-react";
import { requireTenant } from "@/server/tenancy";
import { isAppError } from "@/server/errors";
import { getQuote } from "@/modules/documents/service";
import { listTemplates } from "@/modules/documents/templates";
import type { QuoteStatus } from "@/modules/documents/status";
import { QuoteStatusBadge } from "@/modules/documents/components/quote-status-badge";
import { QuoteActions } from "@/modules/documents/components/quote-actions";
import { QuoteEditor } from "@/modules/documents/components/quote-editor";
import { QuoteView } from "@/modules/documents/components/quote-view";
import { Alert, Card, CardContent, CardHeader, CardTitle } from "@/components/ui/primitives";
import { formatDate, formatDateTime } from "@/lib/format";

export async function generateMetadata({ params }: PageProps<"/quotes/[id]">) {
  const { id } = await params;
  const { ctx } = await requireTenant();
  try {
    const { quote } = await getQuote(ctx, id);
    return { title: `#${quote.number} · ${quote.title}` };
  } catch {
    return { title: "—" };
  }
}

const decimal = (n: number) => String(n);

export default async function QuotePage({ params }: PageProps<"/quotes/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { ctx } = await requireTenant();
  let data: Awaited<ReturnType<typeof getQuote>>;
  try {
    data = await getQuote(ctx, id);
  } catch (e) {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    if (isAppError(e) && e.code === "FORBIDDEN") return <Alert tone="danger">{(await getTranslations("errors"))("forbidden")}</Alert>;
    throw e;
  }
  const { quote: q, items, contact, company, deal } = data;
  const status = q.status as QuoteStatus;
  const t = await getTranslations("quotes");
  const locale = (await getLocale()) as "he" | "en";
  const canUpdate = ctx.can("documents.update") && !ctx.readOnly;
  const editable = status === "draft" && canUpdate;
  const templates = editable ? await listTemplates(ctx) : [];

  const timeline: { key: string; label: string; at: Date; detail?: string | null }[] = [
    { key: "created", label: t("timeline.created"), at: q.createdAt, detail: data.createdByName ? t("timeline.by", { name: data.createdByName }) : null },
    ...(q.sentAt ? [{ key: "sent", label: t("timeline.sent"), at: q.sentAt }] : []),
    ...(q.viewedAt ? [{ key: "viewed", label: t("timeline.viewed"), at: q.viewedAt, detail: q.viewCount ? t("timeline.views", { count: q.viewCount }) : null }] : []),
    ...(q.acceptedAt
      ? [{ key: "accepted", label: t("timeline.accepted"), at: q.acceptedAt, detail: q.decidedByName ? t("timeline.by", { name: q.decidedByName }) : null }]
      : []),
    ...(q.rejectedAt
      ? [{ key: "rejected", label: t("timeline.rejected"), at: q.rejectedAt, detail: q.decidedByName ? t("timeline.by", { name: q.decidedByName }) : null }]
      : []),
    ...(status === "canceled" || status === "expired" ? [{ key: status, label: t(`status.${status}`), at: q.updatedAt }] : []),
  ];

  return (
    <div className="space-y-6">
      <nav aria-label="breadcrumb" className="text-sm text-muted-foreground">
        <Link href="/quotes" className="hover:text-foreground">
          {t("title")}
        </Link>{" "}
        / <span className="text-foreground">#{q.number}</span>
      </nav>

      <Card className="p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">{t("public.quoteNumber", { number: q.number })}</p>
            <h1 className="mt-1 truncate text-2xl font-semibold tracking-tight" dir="auto">
              {q.title}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <QuoteStatusBadge status={status} />
              {contact && (
                <Link href={`/contacts/${contact.id}`} className="inline-flex items-center gap-1 hover:text-foreground">
                  <User className="size-3.5" /> <span dir="auto">{contact.name}</span>
                </Link>
              )}
              {company && (
                <Link href={`/companies/${company.id}`} className="inline-flex items-center gap-1 hover:text-foreground">
                  <Building2 className="size-3.5" /> <span dir="auto">{company.name}</span>
                </Link>
              )}
              {deal && (
                <Link href={`/deals/${deal.id}`} className="inline-flex items-center gap-1 hover:text-foreground">
                  <Briefcase className="size-3.5" /> <span dir="auto">{deal.title}</span>
                </Link>
              )}
              <span>{t("public.issued", { date: formatDate(q.issueDate, locale, "UTC") })}</span>
              {q.validUntil && <span>{t("public.validUntil", { date: formatDate(q.validUntil, locale, "UTC") })}</span>}
            </div>
          </div>
          <QuoteActions
            quote={{ id: q.id, number: q.number, status }}
            contactEmail={contact?.email ?? null}
            canCreate={ctx.can("documents.create") && !ctx.readOnly}
            canUpdate={canUpdate}
            canDelete={ctx.can("documents.delete") && !ctx.readOnly}
            canInvoice={data.canInvoice}
            invoicingLabel={data.invoicingLabel}
          />
        </div>
      </Card>

      {editable ? (
        <QuoteEditor
          templates={templates.map((x) => ({ id: x.id, name: x.name, terms: x.terms }))}
          initial={{
            id: q.id,
            title: q.title,
            language: q.language === "en" ? "en" : "he",
            currency: q.currency,
            issueDate: q.issueDate,
            validUntil: q.validUntil,
            taxRatePercent: decimal(q.taxRateBp / 100),
            discountPercent: decimal(q.discountBp / 100),
            notes: q.notes ?? "",
            terms: q.terms ?? "",
            templateId: q.templateId,
            contact: contact ? { id: contact.id, name: contact.name } : null,
            company,
            deal: deal ? { id: deal.id, name: deal.title } : null,
            items: items.map((i) => ({
              description: i.description,
              quantity: decimal(i.quantityMilli / 1000),
              unitPrice: decimal(i.unitPriceCents / 100),
              discountPercent: decimal(i.discountBp / 100),
            })),
          }}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <Card>
            <CardContent className="space-y-4 p-5">
              {status !== "draft" && <Alert tone="info">{t("readOnlyNotice")}</Alert>}
              <QuoteView
                locale={locale}
                data={{
                  currency: q.currency,
                  discountBp: q.discountBp,
                  taxRateBp: q.taxRateBp,
                  subtotalCents: q.subtotalCents,
                  discountCents: q.discountCents,
                  taxCents: q.taxCents,
                  totalCents: q.totalCents,
                  notes: q.notes,
                  terms: q.terms,
                  items,
                }}
                labels={{
                  items: {
                    description: t("items.description"),
                    quantity: t("items.quantity"),
                    unitPrice: t("items.unitPrice"),
                    discount: t("items.discount"),
                    total: t("items.total"),
                  },
                  totals: {
                    subtotal: t("totals.subtotal"),
                    discount: t("totals.discount"),
                    beforeVat: t("totals.beforeVat"),
                    vat: t("totals.vat", { rate: q.taxRateBp / 100 }),
                    total: t("totals.total"),
                  },
                  notes: t("fields.notes"),
                  terms: t("fields.terms"),
                }}
              />
              <p className="text-xs text-muted-foreground">{t("disclaimer")}</p>
            </CardContent>
          </Card>
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>{t("timeline.title")}</CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="space-y-4 border-s border-border ps-4" data-testid="quote-timeline">
                  {timeline.map((e) => (
                    <li key={e.key} className="relative">
                      <span className="absolute -start-[21px] top-1.5 size-2.5 rounded-full bg-primary" aria-hidden />
                      <p className="text-sm font-medium">{e.label}</p>
                      <p className="text-xs text-muted-foreground">{formatDateTime(e.at, locale)}</p>
                      {e.detail && (
                        <p className="text-xs text-muted-foreground" dir="auto">
                          {e.detail}
                        </p>
                      )}
                    </li>
                  ))}
                </ol>
                {q.decisionNote && (
                  <p className="mt-4 whitespace-pre-wrap rounded-lg bg-muted p-3 text-sm" dir="auto">
                    {q.decisionNote}
                  </p>
                )}
              </CardContent>
            </Card>
            {q.externalInvoiceId && (
              <Alert tone="success">{t("actions.invoiced", { id: q.externalInvoiceId, provider: q.externalInvoiceProvider ?? "" })}</Alert>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { FileText, Plus } from "lucide-react";
import { requireTenant } from "@/server/tenancy";
import { db } from "@/server/db";
import { getEntitlements } from "@/modules/billing/entitlements";
import { listQuotes } from "@/modules/documents/service";
import { parseQuoteListQuery } from "@/modules/documents/schemas";
import { QUOTE_STATUSES } from "@/modules/documents/status";
import { QuoteStatusBadge } from "@/modules/documents/components/quote-status-badge";
import { Button } from "@/components/ui/button";
import { Alert, EmptyState, PageHeader } from "@/components/ui/primitives";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FilterSelect, Pagination, SearchInput } from "@/components/data/url-state";
import { formatDate, formatMoney } from "@/lib/format";

export async function generateMetadata() {
  return { title: (await getTranslations("quotes"))("title") };
}

export default async function QuotesPage({ searchParams }: PageProps<"/quotes">) {
  const { ctx } = await requireTenant();
  const t = await getTranslations("quotes");
  const tc = await getTranslations("common");
  const te = await getTranslations("errors");
  const locale = (await getLocale()) as "he" | "en";
  if (!ctx.can("documents.view")) {
    return <Alert tone="danger">{te("forbidden")}</Alert>;
  }
  const query = parseQuoteListQuery(await searchParams);
  const [{ rows, total, openTotalCents, currency }, ent] = await Promise.all([listQuotes(ctx, query), getEntitlements(db(), ctx.tenantId)]);
  const enabled = ent.features.has("documents");
  const canCreate = enabled && ctx.can("documents.create") && !ctx.readOnly;
  const filtered = Boolean(query.q || query.status);

  const newButton = canCreate ? (
    <Button asChild size="sm">
      <Link href="/quotes/new">
        <Plus /> {t("new")}
      </Link>
    </Button>
  ) : undefined;

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("subtitle", { count: total, open: formatMoney(openTotalCents, currency, locale) })}
        actions={newButton}
      />
      {!enabled && (
        <Alert tone="warning" className="mb-4">
          {te("planRequired")}
        </Alert>
      )}
      <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-center">
        <SearchInput placeholder={t("searchPlaceholder")} className="lg:max-w-sm lg:flex-1" />
        <FilterSelect param="status" label={tc("status")} options={QUOTE_STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) }))} />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<FileText />}
          title={filtered ? tc("noResults") : t("emptyTitle")}
          description={filtered ? undefined : t("emptyBody")}
          action={filtered ? undefined : newButton}
        />
      ) : (
        <>
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH className="w-20">{t("number")}</TH>
                <TH>{t("fields.title")}</TH>
                <TH className="hidden md:table-cell">{t("fields.contact")}</TH>
                <TH>{tc("status")}</TH>
                <TH className="hidden lg:table-cell">{t("fields.issueDate")}</TH>
                <TH className="hidden lg:table-cell">{t("fields.validUntil")}</TH>
                <TH className="text-end">{tc("total")}</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((q) => (
                <TR key={q.id} className="relative">
                  <TD className="tabular text-muted-foreground">#{q.number}</TD>
                  <TD>
                    <Link href={`/quotes/${q.id}`} className="block truncate font-medium after:absolute after:inset-0" dir="auto" data-testid="quote-row">
                      {q.title}
                    </Link>
                  </TD>
                  <TD className="hidden text-muted-foreground md:table-cell" dir="auto">
                    {[q.contactName, q.companyName].filter(Boolean).join(" · ") || "—"}
                  </TD>
                  <TD>
                    <QuoteStatusBadge status={q.status} />
                  </TD>
                  <TD className="hidden text-muted-foreground lg:table-cell">{formatDate(q.issueDate, locale, "UTC")}</TD>
                  <TD className="hidden text-muted-foreground lg:table-cell">{q.validUntil ? formatDate(q.validUntil, locale, "UTC") : "—"}</TD>
                  <TD className="tabular text-end font-medium">{formatMoney(q.totalCents, q.currency, locale)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Pagination page={query.page} pageSize={query.pageSize} total={total} />
        </>
      )}
    </>
  );
}

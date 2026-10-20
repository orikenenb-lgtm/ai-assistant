import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Sparkles } from "lucide-react";
import { requireTenant } from "@/server/tenancy";
import { listLeads, leadDisplayName } from "@/modules/sales/leads";
import { AI_CLASSIFICATIONS, LEAD_SOURCES, LEAD_STATUSES, leadListQuerySchema, parseQuery } from "@/modules/sales/schemas";
import { LeadFormDialog } from "@/modules/sales/components/lead-form-dialog";
import { aiTone, leadStatusTone } from "@/modules/sales/components/badges";
import { listTags } from "@/modules/crm/tags";
import { listAssignableMembers } from "@/modules/org/members";
import { getCustomFieldDefs } from "@/modules/crm/custom-fields";
import { Avatar, Badge, EmptyState, PageHeader } from "@/components/ui/primitives";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FilterSelect, Pagination, SearchInput } from "@/components/data/url-state";
import { formatPhone } from "@/lib/phone";
import { formatMoney, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

export async function generateMetadata() {
  return { title: (await getTranslations("nav"))("leads") };
}

export default async function LeadsPage({ searchParams }: PageProps<"/leads">) {
  const { ctx, tenant } = await requireTenant();
  const raw = await searchParams;
  const query = parseQuery(leadListQuerySchema, raw);
  const t = await getTranslations("leads");
  const tc = await getTranslations("common");
  const locale = (await getLocale()) as "he" | "en";
  const [{ rows, total, statusCounts }, tags, members, defs] = await Promise.all([
    listLeads(ctx, query),
    listTags(ctx),
    listAssignableMembers(ctx),
    getCustomFieldDefs(ctx, "lead"),
  ]);
  const filtered = Boolean(query.q || query.owner || query.source || query.ai || query.status);
  const canCreate = ctx.can("leads.create") && !ctx.readOnly;
  const allCount = Object.values(statusCounts).reduce((a, b) => a + (b ?? 0), 0);

  const tabHref = (status?: string) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(raw)) if (typeof v === "string" && v && k !== "status" && k !== "page") p.set(k, v);
    if (status) p.set("status", status);
    const qs = p.toString();
    return qs ? `/leads?${qs}` : "/leads";
  };

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("subtitle", { count: total })}
        actions={canCreate && <LeadFormDialog members={members} tags={tags} customFieldDefs={defs} openFromQuery />}
      />
      <nav aria-label={t("status")} className="mb-4 flex gap-1 overflow-x-auto border-b border-border">
        {[undefined, ...LEAD_STATUSES].map((s) => {
          const active = query.status === s;
          const n = s ? (statusCounts[s] ?? 0) : allCount;
          return (
            <Link
              key={s ?? "all"}
              href={tabHref(s)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {s ? t(`statuses.${s}`) : t("all")}
              <span className="tabular rounded-full bg-muted px-1.5 text-xs">{n}</span>
            </Link>
          );
        })}
      </nav>
      <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-center">
        <SearchInput placeholder={t("searchPlaceholder")} className="lg:max-w-sm lg:flex-1" />
        <div className="flex flex-wrap gap-2">
          <FilterSelect
            param="owner"
            label={tc("owner")}
            options={[{ value: "me", label: tc("me") }, { value: "unassigned", label: tc("unassigned") }, ...members.map((m) => ({ value: m.userId, label: m.fullName }))]}
          />
          <FilterSelect param="source" label={t("source")} options={LEAD_SOURCES.map((s) => ({ value: s, label: t(`sources.${s}`) }))} />
          <FilterSelect param="ai" label={t("ai")} options={AI_CLASSIFICATIONS.map((s) => ({ value: s, label: t(`aiClassifications.${s}`) }))} />
          <FilterSelect
            param="sort"
            label={t("sort")}
            allLabel={t("sorts.created_desc")}
            options={(["created_asc", "score_desc", "name_asc"] as const).map((s) => ({ value: s, label: t(`sorts.${s}`) }))}
          />
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<Sparkles />}
          title={filtered ? tc("noResults") : t("emptyTitle")}
          description={filtered ? undefined : t("emptyBody")}
          action={!filtered && canCreate ? <LeadFormDialog members={members} tags={tags} customFieldDefs={defs} /> : undefined}
        />
      ) : (
        <>
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>{tc("name")}</TH>
                <TH className="hidden md:table-cell">{t("companyName")}</TH>
                <TH>{t("status")}</TH>
                <TH className="hidden lg:table-cell">{t("source")}</TH>
                <TH className="hidden sm:table-cell">{t("ai")}</TH>
                <TH className="hidden xl:table-cell">{t("estimatedValue")}</TH>
                <TH className="hidden md:table-cell">{tc("owner")}</TH>
                <TH className="hidden lg:table-cell">{t("receivedAt")}</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((l) => (
                <TR key={l.id} className="relative">
                  <TD>
                    <Link href={`/leads/${l.id}`} className="flex items-center gap-3 font-medium after:absolute after:inset-0" data-testid="lead-row">
                      <Avatar name={leadDisplayName(l)} size="sm" />
                      <span className="min-w-0">
                        <span className="block truncate" dir="auto">
                          {leadDisplayName(l)}
                        </span>
                        <span className="block truncate text-xs font-normal text-muted-foreground" dir="ltr">
                          {l.email ?? formatPhone(l.phone)}
                        </span>
                      </span>
                    </Link>
                  </TD>
                  <TD className="hidden text-muted-foreground md:table-cell">{l.companyName ?? "—"}</TD>
                  <TD>
                    <Badge tone={leadStatusTone(l.status)}>{t(`statuses.${l.status}`)}</Badge>
                  </TD>
                  <TD className="hidden text-muted-foreground lg:table-cell">{t(`sources.${l.source}` as "sources.manual")}</TD>
                  <TD className="hidden sm:table-cell">
                    {l.aiClassification ? <Badge tone={aiTone(l.aiClassification)}>{t(`aiClassifications.${l.aiClassification}` as "aiClassifications.hot")}</Badge> : "—"}
                  </TD>
                  <TD className="tabular hidden xl:table-cell">
                    {l.estimatedValueCents != null ? formatMoney(l.estimatedValueCents, tenant.currency, locale) : "—"}
                  </TD>
                  <TD className="hidden text-muted-foreground md:table-cell">{l.ownerName ?? tc("unassigned")}</TD>
                  <TD className="hidden text-muted-foreground lg:table-cell">{formatRelative(l.createdAt, locale)}</TD>
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

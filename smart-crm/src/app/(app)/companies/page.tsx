import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Building2 } from "lucide-react";
import { requireTenant } from "@/server/tenancy";
import { companyListQuerySchema, listCompanies } from "@/modules/crm/companies/service";
import { CompanyFormDialog } from "@/modules/crm/companies/components/company-form-dialog";
import { parseQuery } from "@/modules/sales/schemas";
import { listTags } from "@/modules/crm/tags";
import { listAssignableMembers } from "@/modules/org/members";
import { getCustomFieldDefs } from "@/modules/crm/custom-fields";
import { Avatar, EmptyState, PageHeader, TagPill } from "@/components/ui/primitives";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FilterSelect, Pagination, SearchInput } from "@/components/data/url-state";
import { formatPhone } from "@/lib/phone";
import { formatRelative } from "@/lib/format";

export async function generateMetadata() {
  return { title: (await getTranslations("nav"))("companies") };
}

export default async function CompaniesPage({ searchParams }: PageProps<"/companies">) {
  const { ctx } = await requireTenant();
  const query = parseQuery(companyListQuerySchema, await searchParams);
  const t = await getTranslations("companies");
  const tc = await getTranslations("common");
  const locale = (await getLocale()) as "he" | "en";
  const [{ rows, total }, tags, members, defs] = await Promise.all([
    listCompanies(ctx, query),
    listTags(ctx),
    listAssignableMembers(ctx),
    getCustomFieldDefs(ctx, "company"),
  ]);
  const filtered = Boolean(query.q || query.owner || query.tag);
  const canCreate = ctx.can("companies.create") && !ctx.readOnly;

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("subtitle", { count: total })}
        actions={canCreate && <CompanyFormDialog members={members} tags={tags} customFieldDefs={defs} openFromQuery />}
      />
      <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-center">
        <SearchInput placeholder={t("searchPlaceholder")} className="lg:max-w-sm lg:flex-1" />
        <div className="flex flex-wrap gap-2">
          <FilterSelect
            param="owner"
            label={tc("owner")}
            options={[{ value: "me", label: tc("me") }, { value: "unassigned", label: tc("unassigned") }, ...members.map((m) => ({ value: m.userId, label: m.fullName }))]}
          />
          {tags.length > 0 && <FilterSelect param="tag" label={tc("tags")} options={tags.map((tg) => ({ value: tg.id, label: tg.name }))} />}
          <FilterSelect
            param="sort"
            label={t("sort")}
            allLabel={t("sorts.name_asc")}
            options={(["created_desc", "activity_desc"] as const).map((s) => ({ value: s, label: t(`sorts.${s}`) }))}
          />
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<Building2 />}
          title={filtered ? tc("noResults") : t("emptyTitle")}
          description={filtered ? undefined : t("emptyBody")}
          action={!filtered && canCreate ? <CompanyFormDialog members={members} tags={tags} customFieldDefs={defs} /> : undefined}
        />
      ) : (
        <>
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>{t("name")}</TH>
                <TH className="hidden md:table-cell">{t("industry")}</TH>
                <TH className="hidden lg:table-cell">{tc("phone")}</TH>
                <TH>{t("contactsCount")}</TH>
                <TH className="hidden sm:table-cell">{t("openDeals")}</TH>
                <TH className="hidden xl:table-cell">{tc("tags")}</TH>
                <TH className="hidden md:table-cell">{tc("owner")}</TH>
                <TH className="hidden lg:table-cell">{t("lastActivity")}</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((c) => (
                <TR key={c.id} className="relative">
                  <TD>
                    <Link href={`/companies/${c.id}`} className="flex items-center gap-3 font-medium after:absolute after:inset-0" data-testid="company-row">
                      <Avatar name={c.name} size="sm" />
                      <span className="min-w-0">
                        <span className="block truncate">{c.name}</span>
                        {(c.domain || c.city) && (
                          <span className="block truncate text-xs font-normal text-muted-foreground" dir="auto">
                            {[c.city, c.domain].filter(Boolean).join(" · ")}
                          </span>
                        )}
                      </span>
                    </Link>
                  </TD>
                  <TD className="hidden text-muted-foreground md:table-cell">{c.industry ?? "—"}</TD>
                  <TD className="hidden text-muted-foreground lg:table-cell">
                    <span dir="ltr">{formatPhone(c.phone) || "—"}</span>
                  </TD>
                  <TD className="tabular">{c.contactsCount}</TD>
                  <TD className="tabular hidden sm:table-cell">{c.openDealsCount}</TD>
                  <TD className="hidden xl:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {c.tags.slice(0, 3).map((tg) => (
                        <TagPill key={tg.id} name={tg.name} color={tg.color} />
                      ))}
                      {c.tags.length > 3 && <span className="text-xs text-muted-foreground">+{c.tags.length - 3}</span>}
                    </div>
                  </TD>
                  <TD className="hidden text-muted-foreground md:table-cell">{c.ownerName ?? tc("unassigned")}</TD>
                  <TD className="hidden text-muted-foreground lg:table-cell">{c.lastActivityAt ? formatRelative(c.lastActivityAt, locale) : "—"}</TD>
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

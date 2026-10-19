import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Copy, Download, Upload, Users } from "lucide-react";
import { requireTenant } from "@/server/tenancy";
import { listContacts } from "@/modules/crm/contacts/service";
import { contactDisplayName } from "@/modules/crm/contacts/service";
import { listTags } from "@/modules/crm/tags";
import { listAssignableMembers } from "@/modules/org/members";
import { getCustomFieldDefs } from "@/modules/crm/custom-fields";
import { LIFECYCLE_STAGES, parseListQuery } from "@/modules/crm/schemas";
import { ContactFormDialog } from "@/modules/crm/components/contact-form-dialog";
import { Button } from "@/components/ui/button";
import { Avatar, Badge, EmptyState, PageHeader, TagPill } from "@/components/ui/primitives";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FilterSelect, Pagination, SearchInput } from "@/components/data/url-state";
import { formatPhone } from "@/lib/phone";
import { formatRelative } from "@/lib/format";
import { stageTone } from "@/modules/crm/components/stage-badge";

export async function generateMetadata() {
  return { title: (await getTranslations("nav"))("contacts") };
}

export default async function ContactsPage({ searchParams }: PageProps<"/contacts">) {
  const { ctx } = await requireTenant();
  const query = parseListQuery(await searchParams);
  const [t, tc, locale] = [await getTranslations("contacts"), await getTranslations("common"), (await getLocale()) as "he" | "en"];
  const [{ rows, total }, tags, members, defs] = await Promise.all([
    listContacts(ctx, query),
    listTags(ctx),
    listAssignableMembers(ctx),
    getCustomFieldDefs(ctx, "contact"),
  ]);
  const filtered = Boolean(query.q || query.owner || query.stage || query.tag || query.consent || query.company);

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("subtitle", { count: total })}
        actions={
          <>
            {ctx.can("contacts.merge") && (
              <Button asChild variant="ghost" size="sm">
                <Link href="/contacts/duplicates">
                  <Copy /> {t("duplicates")}
                </Link>
              </Button>
            )}
            {ctx.can("contacts.import") && (
              <Button asChild variant="secondary" size="sm">
                <Link href="/contacts/import">
                  <Upload /> {tc("import")}
                </Link>
              </Button>
            )}
            {ctx.can("contacts.export") && (
              <Button asChild variant="secondary" size="sm">
                <a href={`/api/contacts/export?${new URLSearchParams(Object.entries(query).filter(([k, v]) => v !== undefined && !["page", "pageSize"].includes(k)).map(([k, v]) => [k, String(v)]))}`}>
                  <Download /> {tc("export")}
                </a>
              </Button>
            )}
            {ctx.can("contacts.create") && !ctx.readOnly && <ContactFormDialog members={members} tags={tags} customFieldDefs={defs} openFromQuery />}
          </>
        }
      />
      <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-center">
        <SearchInput placeholder={t("searchPlaceholder")} className="lg:max-w-sm lg:flex-1" />
        <div className="flex flex-wrap gap-2">
          <FilterSelect
            param="owner"
            label={tc("owner")}
            options={[{ value: "me", label: tc("me") }, { value: "unassigned", label: tc("unassigned") }, ...members.map((m) => ({ value: m.userId, label: m.fullName }))]}
          />
          <FilterSelect param="stage" label={t("stage")} options={LIFECYCLE_STAGES.map((s) => ({ value: s, label: t(`stages.${s}`) }))} />
          {tags.length > 0 && <FilterSelect param="tag" label={tc("tags")} options={tags.map((tg) => ({ value: tg.id, label: tg.name }))} />}
          <FilterSelect
            param="consent"
            label={t("consent")}
            options={(["opted_in", "opted_out", "unknown"] as const).map((c) => ({ value: c, label: t(`consentStatus.${c}`) }))}
          />
          <FilterSelect
            param="sort"
            label={t("sort")}
            allLabel={t("sorts.created_desc")}
            options={(["created_asc", "name_asc", "activity_desc"] as const).map((s) => ({ value: s, label: t(`sorts.${s}`) }))}
          />
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title={filtered ? tc("noResults") : t("emptyTitle")}
          description={filtered ? undefined : t("emptyBody")}
          action={
            !filtered && ctx.can("contacts.create") && !ctx.readOnly ? (
              <ContactFormDialog members={members} tags={tags} customFieldDefs={defs} />
            ) : undefined
          }
        />
      ) : (
        <>
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>{tc("name")}</TH>
                <TH className="hidden md:table-cell">{t("company")}</TH>
                <TH className="hidden lg:table-cell">{tc("phone")}</TH>
                <TH>{t("stage")}</TH>
                <TH className="hidden xl:table-cell">{tc("tags")}</TH>
                <TH className="hidden md:table-cell">{tc("owner")}</TH>
                <TH className="hidden lg:table-cell">{t("lastActivity")}</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((c) => (
                <TR key={c.id} className="relative">
                  <TD>
                    <Link href={`/contacts/${c.id}`} className="flex items-center gap-3 font-medium after:absolute after:inset-0" data-testid="contact-row">
                      <Avatar name={contactDisplayName(c)} size="sm" />
                      <span className="min-w-0">
                        <span className="block truncate">{contactDisplayName(c)}</span>
                        {c.email && (
                          <span className="block truncate text-xs font-normal text-muted-foreground" dir="ltr">
                            {c.email}
                          </span>
                        )}
                      </span>
                    </Link>
                  </TD>
                  <TD className="hidden text-muted-foreground md:table-cell">{c.companyName ?? "—"}</TD>
                  <TD className="hidden text-muted-foreground lg:table-cell">
                    <span dir="ltr">{formatPhone(c.phone) || "—"}</span>
                  </TD>
                  <TD>
                    <Badge tone={stageTone(c.lifecycleStage)}>{t(`stages.${c.lifecycleStage}` as "stages.lead")}</Badge>
                  </TD>
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

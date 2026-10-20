import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ScrollText } from "lucide-react";
import { requireSuperAdmin } from "@/modules/admin/request";
import { auditQuerySchema, listPlatformAudit } from "@/modules/admin/service";
import { Badge, EmptyState, PageHeader } from "@/components/ui/primitives";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FilterSelect, Pagination, SearchInput } from "@/components/data/url-state";
import { formatDateTime } from "@/lib/format";

export async function generateMetadata() {
  return { title: (await getTranslations("admin.nav"))("audit") };
}

export default async function AdminAuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireSuperAdmin();
  const raw = Object.fromEntries(Object.entries(await searchParams).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]).filter(([, v]) => v));
  const parsed = auditQuerySchema.safeParse(raw);
  const query = parsed.success ? parsed.data : auditQuerySchema.parse({});
  const t = await getTranslations("admin.audit");
  const locale = (await getLocale()) as "he" | "en";
  const { rows, total } = await listPlatformAudit(actor, query);
  return (
    <div>
      <PageHeader title={t("title")} description={t("subtitle", { count: total })} />
      <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-center">
        <SearchInput param="action" placeholder={t("actionFilter")} className="lg:max-w-sm lg:flex-1" />
        <FilterSelect
          param="scope"
          label={t("scope")}
          allLabel={t("scopes.all")}
          options={(["platform", "admin"] as const).map((s) => ({ value: s, label: t(`scopes.${s}`) }))}
        />
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={<ScrollText />} title={t("empty")} />
      ) : (
        <>
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>{t("when")}</TH>
                <TH>{t("action")}</TH>
                <TH>{t("actor")}</TH>
                <TH className="hidden md:table-cell">{t("tenant")}</TH>
                <TH className="hidden lg:table-cell">{t("details")}</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id}>
                  <TD className="whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(r.createdAt, locale)}</TD>
                  <TD>
                    <code className="text-xs" dir="ltr">
                      {r.action}
                    </code>
                  </TD>
                  <TD>
                    <span className="block text-sm">{r.actorName ?? "—"}</span>
                    <Badge tone={r.actorType === "admin" ? "warning" : "neutral"}>{r.actorType}</Badge>
                  </TD>
                  <TD className="hidden md:table-cell">
                    {r.tenantId ? (
                      <Link href={`/admin/tenants/${r.tenantId}`} className="hover:underline">
                        {r.tenantName ?? r.tenantId}
                      </Link>
                    ) : (
                      <Badge tone="info">{t("platform")}</Badge>
                    )}
                  </TD>
                  <TD className="hidden max-w-md lg:table-cell">
                    <code className="line-clamp-2 break-all text-xs text-muted-foreground" dir="ltr">
                      {Object.keys(r.metadata ?? {}).length ? JSON.stringify(r.metadata) : ""}
                      {r.ip ? ` · ${r.ip}` : ""}
                    </code>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Pagination page={query.page} pageSize={query.pageSize} total={total} />
        </>
      )}
    </div>
  );
}

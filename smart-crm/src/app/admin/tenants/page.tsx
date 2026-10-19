import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Building2 } from "lucide-react";
import { requireSuperAdmin } from "@/modules/admin/request";
import { listTenants, tenantListQuerySchema } from "@/modules/admin/service";
import { listPlans } from "@/modules/billing/plans";
import { db } from "@/server/db";
import { Avatar, Badge, EmptyState, PageHeader } from "@/components/ui/primitives";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FilterSelect, Pagination, SearchInput } from "@/components/data/url-state";
import { formatDate } from "@/lib/format";

export async function generateMetadata() {
  return { title: (await getTranslations("admin.nav"))("tenants") };
}

export default async function AdminTenantsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireSuperAdmin();
  const raw = Object.fromEntries(Object.entries(await searchParams).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]).filter(([, v]) => v));
  const parsed = tenantListQuerySchema.safeParse(raw);
  const query = parsed.success ? parsed.data : tenantListQuerySchema.parse({});
  const t = await getTranslations("admin");
  const locale = (await getLocale()) as "he" | "en";
  const [{ rows, total }, plans] = await Promise.all([listTenants(actor, query), listPlans(db(), { includeInactive: true })]);
  const planName = new Map(plans.map((p) => [p.id, p.name[locale]]));
  return (
    <div>
      <PageHeader title={t("tenants.title")} description={t("tenants.subtitle", { count: total })} />
      <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-center">
        <SearchInput placeholder={t("tenants.search")} className="lg:max-w-sm lg:flex-1" />
        <div className="flex flex-wrap gap-2">
          <FilterSelect param="plan" label={t("tenants.plan")} options={plans.map((p) => ({ value: p.id, label: p.name[locale] }))} />
          <FilterSelect
            param="status"
            label={t("tenants.status")}
            options={(["active", "suspended", "deleted"] as const).map((s) => ({ value: s, label: t(`tenantStatus.${s}`) }))}
          />
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={<Building2 />} title={t("tenants.empty")} />
      ) : (
        <>
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>{t("tenants.name")}</TH>
                <TH>{t("tenants.plan")}</TH>
                <TH>{t("tenants.status")}</TH>
                <TH className="hidden md:table-cell">{t("tenants.members")}</TH>
                <TH className="hidden md:table-cell">{t("tenants.created")}</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id} className="relative">
                  <TD>
                    <Link href={`/admin/tenants/${r.id}`} className="flex items-center gap-3 font-medium after:absolute after:inset-0" data-testid="admin-tenant-row">
                      <Avatar name={r.name} size="sm" />
                      <span className="min-w-0">
                        <span className="block truncate">{r.name}</span>
                        <span className="block truncate text-xs font-normal text-muted-foreground" dir="ltr">
                          {r.slug}
                        </span>
                      </span>
                    </Link>
                  </TD>
                  <TD>
                    {r.planId ? planName.get(r.planId) ?? r.planId : "—"}
                    {r.subscriptionStatus && r.subscriptionStatus !== "active" && (
                      <Badge tone={r.subscriptionStatus === "trialing" ? "ai" : "warning"} className="ms-2">
                        {t(`subStatus.${r.subscriptionStatus}` as "subStatus.trialing")}
                      </Badge>
                    )}
                  </TD>
                  <TD>
                    {r.deletedAt ? (
                      <Badge tone="danger">{t("tenantStatus.deleted")}</Badge>
                    ) : (
                      <Badge tone={r.status === "active" ? "success" : "warning"}>{t(`tenantStatus.${r.status}` as "tenantStatus.active")}</Badge>
                    )}
                  </TD>
                  <TD className="hidden tabular md:table-cell">{r.members}</TD>
                  <TD className="hidden text-muted-foreground md:table-cell">{formatDate(r.createdAt, locale)}</TD>
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

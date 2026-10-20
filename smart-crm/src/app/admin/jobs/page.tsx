import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { CheckCircle2 } from "lucide-react";
import { requireSuperAdmin } from "@/modules/admin/request";
import { listDeadJobs } from "@/modules/admin/service";
import { DeadJobActions } from "@/modules/admin/components/admin-controls";
import { EmptyState, PageHeader } from "@/components/ui/primitives";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Pagination } from "@/components/data/url-state";
import { formatDateTime } from "@/lib/format";

export async function generateMetadata() {
  return { title: (await getTranslations("admin.nav"))("jobs") };
}

export default async function AdminJobsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireSuperAdmin();
  const sp = await searchParams;
  const page = Math.max(1, Number(Array.isArray(sp.page) ? sp.page[0] : sp.page) || 1);
  const t = await getTranslations("admin.jobs");
  const locale = (await getLocale()) as "he" | "en";
  const { rows, total } = await listDeadJobs(actor, { page, pageSize: 25 });
  return (
    <div>
      <PageHeader title={t("title")} description={t("subtitle", { count: total })} />
      {rows.length === 0 ? (
        <EmptyState icon={<CheckCircle2 />} title={t("empty")} description={t("emptyBody")} />
      ) : (
        <>
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>#</TH>
                <TH>{t("type")}</TH>
                <TH className="hidden md:table-cell">{t("tenant")}</TH>
                <TH>{t("error")}</TH>
                <TH className="hidden lg:table-cell">{t("finished")}</TH>
                <TH>
                  <span className="sr-only">{t("actions")}</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((j) => (
                <TR key={j.id}>
                  <TD className="tabular text-muted-foreground">{j.id}</TD>
                  <TD className="font-mono text-xs" dir="ltr">
                    {j.type}
                    <span className="block text-muted-foreground">
                      {j.attempts}/{j.maxAttempts}
                    </span>
                  </TD>
                  <TD className="hidden md:table-cell">
                    {j.tenantId ? (
                      <Link href={`/admin/tenants/${j.tenantId}`} className="hover:underline">
                        {j.tenantName ?? j.tenantId}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </TD>
                  <TD className="max-w-md">
                    <code className="line-clamp-3 break-all text-xs text-danger-foreground" dir="ltr">
                      {j.lastError ?? "—"}
                    </code>
                  </TD>
                  <TD className="hidden text-muted-foreground lg:table-cell">{formatDateTime(j.finishedAt, locale)}</TD>
                  <TD>
                    <DeadJobActions jobId={j.id} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Pagination page={page} pageSize={25} total={total} />
        </>
      )}
    </div>
  );
}

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { inArray, and, eq } from "drizzle-orm";
import { ArrowRight, History } from "lucide-react";
import { requireTenant } from "@/server/tenancy";
import { AppError } from "@/server/errors";
import { schema } from "@/server/db";
import { getWorkflow, listRuns } from "@/modules/automation/service";
import { RunRow } from "@/modules/automation/components/run-row";
import { EmptyState, PageHeader } from "@/components/ui/primitives";
import { Table, TBody, TH, THead, TR } from "@/components/ui/table";
import { FilterSelect, Pagination } from "@/components/data/url-state";

export async function generateMetadata() {
  return { title: (await getTranslations("automation"))("runs") };
}

const STATUSES = ["pending", "running", "waiting", "completed", "failed", "canceled"] as const;

export default async function WorkflowRunsPage({ params, searchParams }: PageProps<"/automations/[id]/runs">) {
  const { id } = await params;
  const sp = await searchParams;
  const { ctx, tenant } = await requireTenant();
  if (!ctx.can("automation.view")) redirect("/dashboard");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const t = await getTranslations("automation");
  const wf = await getWorkflow(ctx, id).catch((e) => {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const status = typeof sp.status === "string" && (STATUSES as readonly string[]).includes(sp.status) ? sp.status : undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const { rows, total } = await listRuns(ctx, id, { status, page });

  // Friendly names for the records the runs acted on (contacts only; other entities link by id).
  const contactIds = rows.filter((r) => r.entityType === "contact" && r.entityId).map((r) => r.entityId!);
  const names = new Map<string, string>();
  if (contactIds.length) {
    const contacts = await ctx.run((tx) =>
      tx
        .select({ id: schema.contacts.id, firstName: schema.contacts.firstName, lastName: schema.contacts.lastName })
        .from(schema.contacts)
        .where(and(eq(schema.contacts.tenantId, ctx.tenantId), inArray(schema.contacts.id, contactIds))),
    );
    for (const c of contacts) names.set(c.id, [c.firstName, c.lastName].filter(Boolean).join(" "));
  }
  const canManage = ctx.can("automation.manage") && !ctx.readOnly;

  return (
    <>
      <Link href={`/automations/${id}`} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowRight className="size-4 ltr:rotate-180" aria-hidden /> {wf.name}
      </Link>
      <PageHeader title={t("runs")} description={wf.name} />
      <div className="mb-4 flex flex-wrap gap-2">
        <FilterSelect param="status" label={t("statusLabel")} options={STATUSES.map((s) => ({ value: s, label: t(`runStatus.${s}`) }))} />
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={<History />} title={t("noRuns")} description={t("noRunsBody")} />
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>{t("started")}</TH>
                <TH>{t("statusLabel")}</TH>
                <TH>{t("entity")}</TH>
                <TH className="text-end">{t("steps")}</TH>
                <TH>{t("error")}</TH>
                <TH className="text-end">
                  <span className="sr-only">{t("actionsColumn")}</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => (
                <RunRow
                  key={r.id}
                  canManage={canManage}
                  timeZone={tenant.timezone}
                  run={{
                    id: r.id,
                    status: r.status,
                    entityType: r.entityType,
                    entityId: r.entityId,
                    entityName: r.entityId ? (names.get(r.entityId) ?? null) : null,
                    stepsExecuted: r.stepsExecuted,
                    error: r.error,
                    startedAt: r.startedAt.toISOString(),
                    finishedAt: r.finishedAt?.toISOString() ?? null,
                    workflowVersion: r.workflowVersion,
                  }}
                />
              ))}
            </TBody>
          </Table>
          <Pagination total={total} page={page} pageSize={25} />
        </>
      )}
    </>
  );
}

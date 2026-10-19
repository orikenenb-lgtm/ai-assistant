import { getTranslations, getLocale } from "next-intl/server";
import { Download, ScrollText } from "lucide-react";
import { requireTenant } from "@/server/tenancy";
import { db } from "@/server/db";
import { getEntitlements } from "@/modules/billing/entitlements";
import { auditActors, auditEntityTypes, listAuditLogs, parseAuditQuery } from "@/modules/audit/service";
import { NoAccess } from "@/modules/settings/components/no-access";
import { Badge, Card, CardContent, EmptyState, PageHeader } from "@/components/ui/primitives";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Input, NativeSelect } from "@/components/ui/input";
import { Button, buttonVariants } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/menu";
import { Pagination } from "@/components/data/url-state";
import { formatDateTime } from "@/lib/format";

export async function generateMetadata() {
  return { title: (await getTranslations("audit"))("title") };
}

const ACTOR_TYPES = ["user", "system", "api_key", "ai", "admin", "webhook", "automation"] as const;

export default async function AuditPage({ searchParams }: PageProps<"/settings/audit">) {
  const { ctx } = await requireTenant();
  if (!ctx.can("audit.view")) return <NoAccess />;
  const [t, tc, locale] = await Promise.all([getTranslations("audit"), getTranslations("common"), getLocale()]);
  const raw = await searchParams;
  const q = parseAuditQuery(raw);
  const [{ rows, total }, actors, entityTypes, ent] = await Promise.all([
    listAuditLogs(ctx, q),
    auditActors(ctx),
    auditEntityTypes(ctx),
    getEntitlements(db(), ctx.tenantId),
  ]);
  const canExport = ent.features.has("audit_export");
  const exportQs = new URLSearchParams(
    Object.entries({ action: q.action, actor: q.actor, entityType: q.entityType, from: q.from, to: q.to }).filter((e): e is [string, string] => Boolean(e[1])),
  ).toString();
  const actorLabel = (type: string) => (ACTOR_TYPES.includes(type as (typeof ACTOR_TYPES)[number]) ? t(`actorTypes.${type as (typeof ACTOR_TYPES)[number]}`) : type);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          canExport ? (
            <a href={`/settings/audit/export${exportQs ? `?${exportQs}` : ""}`} className={buttonVariants({ variant: "secondary" })} download>
              <Download /> {t("export")}
            </a>
          ) : (
            <Tooltip content={t("exportPlan")}>
              <span>
                <Button variant="secondary" disabled>
                  <Download /> {t("export")}
                </Button>
              </span>
            </Tooltip>
          )
        }
      />

      <Card>
        <CardContent className="pt-5">
          <form method="get" className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" role="search">
            <Input name="action" defaultValue={q.action ?? ""} placeholder={t("actionPlaceholder")} aria-label={t("action")} dir="auto" />
            <NativeSelect name="actor" defaultValue={q.actor ?? ""} aria-label={t("actor")}>
              <option value="">
                {t("actor")}: {tc("all")}
              </option>
              {actors.map((a) => (
                <option key={a.userId} value={a.userId}>
                  {a.fullName}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect name="entityType" defaultValue={q.entityType ?? ""} aria-label={t("entityType")}>
              <option value="">
                {t("entityType")}: {tc("all")}
              </option>
              {entityTypes.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </NativeSelect>
            <Input type="date" name="from" defaultValue={q.from ?? ""} aria-label={t("from")} dir="ltr" />
            <Input type="date" name="to" defaultValue={q.to ?? ""} aria-label={t("to")} dir="ltr" />
            <Button type="submit" variant="secondary">
              {t("filter")}
            </Button>
          </form>

          {rows.length === 0 ? (
            <EmptyState icon={<ScrollText />} title={t("empty")} />
          ) : (
            <Table>
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>{t("when")}</TH>
                  <TH>{t("actor")}</TH>
                  <TH>{t("action")}</TH>
                  <TH className="hidden md:table-cell">{t("entityType")}</TH>
                  <TH className="hidden lg:table-cell">{t("ip")}</TH>
                  <TH className="hidden lg:table-cell">{t("details")}</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((r) => (
                  <TR key={r.id} data-testid="audit-row">
                    <TD className="whitespace-nowrap text-muted-foreground">{formatDateTime(r.createdAt, locale === "en" ? "en" : "he")}</TD>
                    <TD>
                      <span className="font-medium">{r.actorName ?? actorLabel(r.actorType)}</span>
                      {r.actorType !== "user" && (
                        <Badge tone="neutral" className="ms-1.5">
                          {actorLabel(r.actorType)}
                        </Badge>
                      )}
                    </TD>
                    <TD>
                      <code className="font-mono text-xs" dir="ltr">
                        {r.action}
                      </code>
                    </TD>
                    <TD className="hidden text-muted-foreground md:table-cell">
                      {r.entityType && (
                        <span dir="ltr">
                          {r.entityType}
                          {r.entityId && <span className="text-xs"> · {r.entityId.slice(0, 8)}</span>}
                        </span>
                      )}
                    </TD>
                    <TD className="hidden font-mono text-xs text-muted-foreground lg:table-cell" dir="ltr">
                      {r.ip ?? ""}
                    </TD>
                    <TD className="hidden max-w-xs lg:table-cell">
                      {Object.keys(r.metadata ?? {}).length > 0 && (
                        <details>
                          <summary className="cursor-pointer text-xs text-muted-foreground">{t("details")}</summary>
                          <pre className="mt-1 max-h-40 overflow-auto rounded bg-muted p-2 text-[11px]" dir="ltr">
                            {JSON.stringify(r.metadata, null, 2)}
                          </pre>
                        </details>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
          <Pagination page={q.page} pageSize={q.pageSize} total={total} />
        </CardContent>
      </Card>
    </div>
  );
}

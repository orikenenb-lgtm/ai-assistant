import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { AlertTriangle, Workflow } from "lucide-react";
import { requireTenant } from "@/server/tenancy";
import { getEntitlements } from "@/modules/billing/entitlements";
import { listWorkflows } from "@/modules/automation/service";
import { WORKFLOW_TEMPLATES } from "@/modules/automation/templates";
import { NewWorkflowDialog } from "@/modules/automation/components/new-workflow-dialog";
import { Alert, Badge, EmptyState, PageHeader } from "@/components/ui/primitives";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatNumber, formatRelative } from "@/lib/format";

export async function generateMetadata() {
  return { title: (await getTranslations("automation"))("title") };
}

const STATUS_TONE = { draft: "neutral", active: "success", paused: "warning", archived: "outline" } as const;

export default async function AutomationsPage() {
  const { ctx } = await requireTenant();
  if (!ctx.can("automation.view")) redirect("/dashboard");
  const [t, locale] = [await getTranslations("automation"), (await getLocale()) as "he" | "en"];
  const ent = await ctx.run((tx) => getEntitlements(tx, ctx.tenantId));
  if (!ent.features.has("automation")) {
    return (
      <>
        <PageHeader title={t("title")} description={t("subtitle")} />
        <Alert tone="info" title={t("planRequiredTitle")}>
          {t("planRequiredBody")}{" "}
          <Link href="/settings/billing" className="font-medium underline">
            {t("upgrade")}
          </Link>
        </Alert>
      </>
    );
  }
  const workflows = await listWorkflows(ctx);
  const canManage = ctx.can("automation.manage") && !ctx.readOnly;
  const templates = WORKFLOW_TEMPLATES.map(({ key, name, description }) => ({ key, name, description }));
  const kindOf = (triggerType: string) => (triggerType.startsWith("event:") ? "event" : triggerType) as "event" | "schedule" | "webhook" | "manual";

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} actions={canManage && <NewWorkflowDialog templates={templates} />} />
      {workflows.length === 0 ? (
        <EmptyState icon={<Workflow />} title={t("emptyTitle")} description={t("emptyBody")} action={canManage && <NewWorkflowDialog templates={templates} />} />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>{t("name")}</TH>
              <TH>{t("nodes.trigger")}</TH>
              <TH>{t("statusLabel")}</TH>
              <TH className="text-end">{t("runs7d")}</TH>
              <TH className="text-end">{t("failed7d")}</TH>
              <TH>{t("lastRun")}</TH>
            </TR>
          </THead>
          <TBody>
            {workflows.map((w) => {
              const kind = kindOf(w.triggerType);
              return (
                <TR key={w.id}>
                  <TD>
                    <Link href={`/automations/${w.id}`} className="font-medium hover:underline">
                      {w.name}
                    </Link>
                    {w.description && <p className="line-clamp-1 max-w-md text-xs text-muted-foreground">{w.description}</p>}
                  </TD>
                  <TD className="text-sm">
                    {kind === "event"
                      ? t(`events.${w.triggerType.slice(6).replaceAll(".", "_")}` as "events.contact_created")
                      : t(`triggerKinds.${kind}`)}
                  </TD>
                  <TD>
                    <Badge tone={STATUS_TONE[w.status as keyof typeof STATUS_TONE] ?? "neutral"}>{t(`status.${w.status}` as "status.draft")}</Badge>
                  </TD>
                  <TD className="tabular text-end">
                    <Link href={`/automations/${w.id}/runs`} className="hover:underline">
                      {formatNumber(w.runs7d, locale)}
                    </Link>
                  </TD>
                  <TD className="tabular text-end">
                    {w.failed7d > 0 ? (
                      <Link href={`/automations/${w.id}/runs?status=failed`} className="inline-flex items-center gap-1 text-danger-foreground hover:underline">
                        <AlertTriangle className="size-3.5" aria-hidden /> {formatNumber(w.failed7d, locale)}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </TD>
                  <TD className="text-sm text-muted-foreground">{w.lastRunAt ? formatRelative(w.lastRunAt, locale) : t("never")}</TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}
    </>
  );
}

import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireTenant } from "@/server/tenancy";
import { isMockAi } from "@/modules/ai/runtime";
import { aiUsageSummary } from "@/modules/ai/usage";
import { listProposals } from "@/modules/ai/proposals";
import { CopilotChat } from "@/modules/ai/components/copilot-chat";
import { ProposalsPanel } from "@/modules/ai/components/proposals-panel";
import { Card, CardContent, CardHeader, CardTitle, PageHeader } from "@/components/ui/primitives";
import { formatNumber } from "@/lib/format";
import { getLocale } from "next-intl/server";

export async function generateMetadata() {
  return { title: "AI Copilot" };
}

export default async function CopilotPage() {
  const { ctx } = await requireTenant();
  if (!ctx.can("ai.use")) redirect("/dashboard");
  const t = await getTranslations("ai");
  const locale = (await getLocale()) as "he" | "en";
  const [usage, proposals] = await Promise.all([aiUsageSummary(ctx), listProposals(ctx, { status: "pending", limit: 20 })]);
  const pct = usage.tokenLimit ? Math.min(100, Math.round((usage.tokensUsed / usage.tokenLimit) * 100)) : null;
  return (
    <>
      <PageHeader title="AI Copilot" description={t("pageSubtitle")} />
      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <CopilotChat mock={isMockAi()} canApprove={ctx.can("ai.approve") && !ctx.readOnly} />
        <div className="space-y-6">
          <ProposalsPanel initial={proposals} canApprove={ctx.can("ai.approve") && !ctx.readOnly} />
          <Card>
            <CardHeader>
              <CardTitle>{t("usageTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="tabular">
                {t("tokensUsed", { used: formatNumber(usage.tokensUsed, locale), limit: usage.tokenLimit ? formatNumber(usage.tokenLimit, locale) : "∞" })}
              </p>
              {pct !== null && (
                <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={t("usageTitle")}>
                  <div className={pct > 90 ? "h-full bg-danger" : "h-full bg-ai"} style={{ width: `${pct}%` }} />
                </div>
              )}
              <ul className="space-y-1 text-muted-foreground">
                {usage.byFeature.map((f) => (
                  <li key={f.feature} className="flex justify-between">
                    <span>{t(`features.${f.feature}` as "features.chat")}</span>
                    <span className="tabular">{f.calls}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

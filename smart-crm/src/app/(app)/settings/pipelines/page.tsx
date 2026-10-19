import { getTranslations } from "next-intl/server";
import { and, count, eq, isNull } from "drizzle-orm";
import { requireTenant } from "@/server/tenancy";
import { schema } from "@/server/db";
import { listLostReasons, listPipelines } from "@/modules/sales/pipelines";
import { LostReasonsManager, NewPipelineDialog, PipelineCard } from "@/modules/sales/components/pipeline-settings";
import { Alert } from "@/components/ui/primitives";

export async function generateMetadata() {
  return { title: (await getTranslations("pipelines"))("title") };
}

const MAX_PIPELINES = 20;

export default async function PipelinesSettingsPage() {
  const { ctx } = await requireTenant();
  const t = await getTranslations("pipelines");
  if (!ctx.can("pipelines.manage")) return <Alert tone="warning">{(await getTranslations("errors"))("forbidden")}</Alert>;

  const [pipelines, reasons, counts] = await Promise.all([
    listPipelines(ctx),
    listLostReasons(ctx),
    ctx.run((tx) =>
      tx
        .select({ stageId: schema.deals.stageId, n: count() })
        .from(schema.deals)
        .where(and(eq(schema.deals.tenantId, ctx.tenantId), isNull(schema.deals.deletedAt)))
        .groupBy(schema.deals.stageId),
    ),
  ]);
  const byStage = new Map(counts.map((c) => [c.stageId, Number(c.n)]));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t("title")}</h2>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        {!ctx.readOnly && <NewPipelineDialog disabled={pipelines.length >= MAX_PIPELINES} />}
      </div>
      {ctx.readOnly && <Alert tone="warning">{(await getTranslations("errors"))("readOnly")}</Alert>}
      {pipelines.map((p) => (
        <PipelineCard
          key={p.id}
          pipeline={{
            id: p.id,
            name: p.name,
            isDefault: p.isDefault,
            stages: p.stages.map((s) => ({ id: s.id, name: s.name, probability: s.probability, kind: s.kind, color: s.color, dealCount: byStage.get(s.id) ?? 0 })),
          }}
        />
      ))}
      <LostReasonsManager reasons={reasons.map((r) => ({ id: r.id, label: r.label, active: r.active }))} />
    </div>
  );
}

import { and, eq, gte, sql } from "drizzle-orm";
import { schema } from "@/server/db";
import { assertCan, type ServiceCtx } from "@/server/context";
import { getEntitlements, monthlyUsage, startOfMonth } from "@/modules/billing/entitlements";

/** This month's AI usage per feature, plus the plan quota. */
export async function aiUsageSummary(ctx: ServiceCtx) {
  assertCan(ctx, "ai.use");
  return ctx.run(async (tx) => {
    const rows = await tx
      .select({
        feature: schema.aiInteractions.feature,
        calls: sql<number>`count(*)::int`,
        tokens: sql<number>`coalesce(sum(${schema.aiInteractions.inputTokens} + ${schema.aiInteractions.outputTokens}), 0)::int`,
        costMicros: sql<number>`coalesce(sum(${schema.aiInteractions.costMicros}), 0)::bigint`,
        errors: sql<number>`count(*) filter (where ${schema.aiInteractions.status} <> 'ok')::int`,
      })
      .from(schema.aiInteractions)
      .where(and(eq(schema.aiInteractions.tenantId, ctx.tenantId), gte(schema.aiInteractions.createdAt, startOfMonth())))
      .groupBy(schema.aiInteractions.feature);
    const ent = await getEntitlements(tx, ctx.tenantId);
    return {
      byFeature: rows.map((r) => ({ ...r, costMicros: Number(r.costMicros) })),
      tokensUsed: await monthlyUsage(tx, ctx.tenantId, "ai_tokens"),
      tokenLimit: ent.limits.ai_tokens_monthly ?? null,
    };
  });
}

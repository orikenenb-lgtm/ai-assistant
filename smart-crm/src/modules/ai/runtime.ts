import { and, eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { assertCan, type ServiceCtx } from "@/server/context";
import { AppError, isAppError } from "@/server/errors";
import { hitRateLimit } from "@/server/rate-limit";
import { errorFields, logger } from "@/server/logger";
import { assertFeature, assertMonthlyQuota, getEntitlements, recordUsage } from "@/modules/billing/entitlements";
import { aiProvider, costMicros, type CompletionRequest, type CompletionResult } from "./provider";

export type AiFeature = "summarize" | "draft_reply" | "intent" | "classify_lead" | "next_actions" | "generate_tasks" | "search" | "trends" | "chat";
export type AiEntity = { type: "contact" | "company" | "deal" | "lead" | "conversation"; id: string } | null;

export const AI_LIMITS = { perUserPerMinute: 20, perTenantPerMinute: 120 };

async function isFlagEnabled(tenantId: string, key: string): Promise<boolean> {
  const [global] = await db().select().from(schema.featureFlags).where(eq(schema.featureFlags.key, key));
  const [override] = await db()
    .select()
    .from(schema.tenantFeatureFlags)
    .where(and(eq(schema.tenantFeatureFlags.tenantId, tenantId), eq(schema.tenantFeatureFlags.flagKey, key)));
  return override ? override.enabled : Boolean(global?.enabled);
}

async function logInteraction(input: {
  ctx: ServiceCtx;
  feature: AiFeature;
  entity: AiEntity;
  provider: string;
  model: string;
  usage?: { inputTokens: number; outputTokens: number };
  latencyMs?: number;
  status: "ok" | "error" | "rate_limited" | "quota_exceeded" | "blocked";
  error?: string;
  output?: unknown;
}) {
  // ai_interactions is append-only for the system context (app users can only read).
  const [row] = await db()
    .insert(schema.aiInteractions)
    .values({
      tenantId: input.ctx.tenantId,
      userId: input.ctx.userId,
      feature: input.feature,
      provider: input.provider,
      model: input.model,
      inputTokens: input.usage?.inputTokens ?? 0,
      outputTokens: input.usage?.outputTokens ?? 0,
      costMicros: input.usage ? costMicros(input.usage, input.provider) : 0,
      latencyMs: input.latencyMs ?? null,
      status: input.status,
      error: input.error?.slice(0, 500) ?? null,
      entityType: input.entity?.type ?? null,
      entityId: input.entity?.id ?? null,
      output: (input.output ?? null) as never,
    })
    .returning({ id: schema.aiInteractions.id });
  return row.id;
}

/**
 * Every AI call goes through here: permission + plan + feature flag checks,
 * per-user/per-tenant rate limits, monthly token quota, provider call,
 * metering (tokens, cost, latency) and an interaction log row.
 */
export async function runAi(
  ctx: ServiceCtx,
  feature: AiFeature,
  entity: AiEntity,
  request: CompletionRequest,
  opts: { estimatedTokens?: number } = {},
): Promise<CompletionResult & { interactionId: string }> {
  assertCan(ctx, "ai.use");
  const provider = aiProvider();
  const ent = await getEntitlements(db(), ctx.tenantId);
  assertFeature(ent, "ai");
  if (!(await isFlagEnabled(ctx.tenantId, "ai.copilot"))) throw new AppError("PLAN_REQUIRED", "ai.disabled");

  const userLimit = await hitRateLimit(`ai:user:${ctx.userId ?? ctx.actorType}`, AI_LIMITS.perUserPerMinute, 60);
  const tenantLimit = await hitRateLimit(`ai:tenant:${ctx.tenantId}`, AI_LIMITS.perTenantPerMinute, 60);
  if (!userLimit.allowed || !tenantLimit.allowed) {
    await logInteraction({ ctx, feature, entity, provider: provider.name, model: provider.model, status: "rate_limited" });
    throw new AppError("RATE_LIMITED", "errors.rateLimited");
  }
  try {
    await assertMonthlyQuota(db(), ctx.tenantId, "ai_tokens", opts.estimatedTokens ?? 1000);
  } catch (e) {
    await logInteraction({ ctx, feature, entity, provider: provider.name, model: provider.model, status: "quota_exceeded" });
    throw e;
  }

  const started = Date.now();
  try {
    const result = await provider.complete(request);
    const latencyMs = Date.now() - started;
    const interactionId = await logInteraction({
      ctx,
      feature,
      entity,
      provider: provider.name,
      model: result.model,
      usage: result.usage,
      latencyMs,
      status: "ok",
      output: result.content ? { content: result.content.slice(0, 4000) } : { toolCalls: result.toolCalls.map((c) => c.name) },
    });
    const tokens = result.usage.inputTokens + result.usage.outputTokens;
    await recordUsage(db(), { tenantId: ctx.tenantId, metric: "ai_tokens", quantity: tokens, refType: "ai_interaction", refId: interactionId });
    const micros = costMicros(result.usage, provider.name);
    if (micros > 0) await recordUsage(db(), { tenantId: ctx.tenantId, metric: "ai_cost_micros", quantity: micros, refType: "ai_interaction", refId: interactionId });
    return { ...result, interactionId };
  } catch (e) {
    if (isAppError(e)) throw e;
    logger().error({ feature, ...errorFields(e) }, "AI provider call failed");
    await logInteraction({
      ctx,
      feature,
      entity,
      provider: provider.name,
      model: provider.model,
      latencyMs: Date.now() - started,
      status: "error",
      error: e instanceof Error ? e.message : String(e),
    });
    throw new AppError("PROVIDER_ERROR", "ai.providerError");
  }
}

/** Parses a JSON completion, tolerating fenced code blocks. */
export function parseJson<T>(content: string | null): T {
  if (!content) throw new AppError("PROVIDER_ERROR", "ai.badOutput");
  const cleaned = content.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new AppError("PROVIDER_ERROR", "ai.badOutput");
  }
}

export function isMockAi() {
  return aiProvider().name === "mock";
}

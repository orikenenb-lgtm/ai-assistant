import { and, eq } from "drizzle-orm";
import { schema, type Executor } from "@/server/db";

/**
 * Runtime feature flag check: a tenant override wins over the global value;
 * unknown flags are off. Plan entitlements are separate (billing/entitlements).
 */
export async function featureFlagEnabled(tx: Executor, tenantId: string | null, key: string): Promise<boolean> {
  if (tenantId) {
    const [o] = await tx
      .select({ enabled: schema.tenantFeatureFlags.enabled })
      .from(schema.tenantFeatureFlags)
      .where(and(eq(schema.tenantFeatureFlags.tenantId, tenantId), eq(schema.tenantFeatureFlags.flagKey, key)))
      .limit(1);
    if (o) return o.enabled;
  }
  const [f] = await tx.select({ enabled: schema.featureFlags.enabled }).from(schema.featureFlags).where(eq(schema.featureFlags.key, key)).limit(1);
  return f?.enabled ?? false;
}

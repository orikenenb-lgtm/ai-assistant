import { and, eq, isNull, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { schema, withSystemTx, type Tx } from "@/server/db";
import { AppError, isUniqueViolation } from "@/server/errors";

export type CreateOrgInput = {
  name: string;
  locale: "he" | "en";
  timezone?: string;
  currency?: string;
};

const DEFAULT_STAGES = {
  he: [
    { name: "ליד חדש", probability: 10, kind: "open", color: "#64748b" },
    { name: "שיחת היכרות", probability: 25, kind: "open", color: "#0ea5e9" },
    { name: "הצעת מחיר", probability: 50, kind: "open", color: "#6366f1" },
    { name: "משא ומתן", probability: 75, kind: "open", color: "#f59e0b" },
    { name: "נסגר בהצלחה", probability: 100, kind: "won", color: "#10b981" },
    { name: "אבוד", probability: 0, kind: "lost", color: "#ef4444" },
  ],
  en: [
    { name: "New", probability: 10, kind: "open", color: "#64748b" },
    { name: "Discovery", probability: 25, kind: "open", color: "#0ea5e9" },
    { name: "Proposal", probability: 50, kind: "open", color: "#6366f1" },
    { name: "Negotiation", probability: 75, kind: "open", color: "#f59e0b" },
    { name: "Won", probability: 100, kind: "won", color: "#10b981" },
    { name: "Lost", probability: 0, kind: "lost", color: "#ef4444" },
  ],
} as const;

const DEFAULT_LOST_REASONS = {
  he: ["מחיר", "בחר במתחרה", "תזמון לא מתאים", "אין תקציב", "לא הגיב"],
  en: ["Price", "Chose a competitor", "Bad timing", "No budget", "Unresponsive"],
};

const TRIAL_PLAN = "pro";
const TRIAL_DAYS = 14;

export function slugify(name: string): string {
  const ascii = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const suffix = randomBytes(3).toString("hex");
  return ascii.length >= 3 ? `${ascii}-${suffix}` : `org-${suffix}`;
}

/** Seeds the defaults every new organization starts with. */
async function seedTenantDefaults(tx: Tx, tenantId: string, locale: "he" | "en") {
  const [pipeline] = await tx
    .insert(schema.pipelines)
    .values({ tenantId, name: locale === "he" ? "מכירות" : "Sales", isDefault: true, position: 0 })
    .returning({ id: schema.pipelines.id });
  await tx.insert(schema.pipelineStages).values(
    DEFAULT_STAGES[locale].map((s, i) => ({ tenantId, pipelineId: pipeline.id, position: i, ...s })),
  );
  await tx.insert(schema.lostReasons).values(DEFAULT_LOST_REASONS[locale].map((label, i) => ({ tenantId, label, position: i })));
  await tx.insert(schema.documentTemplates).values({
    tenantId,
    name: locale === "he" ? "הצעת מחיר רגילה" : "Standard quote",
    isDefault: true,
    terms:
      locale === "he"
        ? "ההצעה בתוקף עד התאריך המצוין. המחירים אינם כוללים מע״מ אלא אם צוין אחרת. מסמך זה אינו חשבונית מס."
        : "This quote is valid until the date shown. Prices exclude VAT unless stated. This document is not a tax invoice.",
  });
}

export async function createOrganization(userId: string, input: CreateOrgInput) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await withSystemTx(async (tx) => {
        const [tenant] = await tx
          .insert(schema.tenants)
          .values({
            name: input.name.trim(),
            slug: slugify(input.name),
            locale: input.locale,
            timezone: input.timezone ?? "Asia/Jerusalem",
            currency: input.currency ?? "ILS",
            createdBy: userId,
          })
          .returning();
        await tx.insert(schema.memberships).values({ tenantId: tenant.id, userId, role: "owner" });
        await tx.insert(schema.subscriptions).values({
          tenantId: tenant.id,
          planId: TRIAL_PLAN,
          status: "trialing",
          seats: 1,
          provider: "mock",
          trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 86400_000),
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + TRIAL_DAYS * 86400_000),
        });
        await seedTenantDefaults(tx, tenant.id, input.locale);
        await tx.update(schema.profiles).set({ lastTenantId: tenant.id }).where(eq(schema.profiles.id, userId));
        await tx.insert(schema.auditLogs).values({
          tenantId: tenant.id,
          actorUserId: userId,
          actorType: "user",
          action: "org.created",
          entityType: "tenant",
          entityId: tenant.id,
          metadata: { name: tenant.name, plan: TRIAL_PLAN, trialDays: TRIAL_DAYS },
        });
        return tenant;
      });
    } catch (e) {
      if (isUniqueViolation(e) && attempt < 2) continue; // slug collision: retry with a new suffix
      throw e;
    }
  }
  throw new AppError("CONFLICT", "errors.conflict");
}

/** Verifies membership before switching; returns false when not a member. */
export async function isActiveMember(userId: string, tenantId: string, tx?: Tx): Promise<boolean> {
  const run = async (t: Tx) => {
    const rows = await t
      .select({ id: schema.memberships.id })
      .from(schema.memberships)
      .innerJoin(schema.tenants, eq(schema.tenants.id, schema.memberships.tenantId))
      .where(
        and(
          eq(schema.memberships.userId, userId),
          eq(schema.memberships.tenantId, tenantId),
          eq(schema.memberships.status, "active"),
          isNull(schema.tenants.deletedAt),
        ),
      )
      .limit(1);
    return rows.length > 0;
  };
  return tx ? run(tx) : withSystemTx(run);
}

export async function setLastTenant(userId: string, tenantId: string) {
  await withSystemTx((tx) =>
    tx.execute(sql`update public.profiles set last_tenant_id = ${tenantId} where id = ${userId}`),
  );
}

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { closeDb, db, schema, withUserTx } from "@/server/db";
import { AppError } from "@/server/errors";
import { supportCtx, userCtx } from "@/server/context";
import { enqueueJob } from "@/server/jobs/queue";
import type { AdminActor } from "@/modules/admin/guard";
import { assertSuperAdmin } from "@/modules/admin/guard";
import { featureFlagEnabled } from "@/modules/admin/flags";
import {
  activeSupportFor,
  adminChangePlan,
  cancelDeadJob,
  cancelTenantDeletion,
  createFeatureFlag,
  endSupportSession,
  getPlatformStats,
  getTenantDetail,
  listDeadJobs,
  listFeatureFlags,
  listPlansAdmin,
  listPlatformAudit,
  listSupportSessions,
  listTenants,
  retryDeadJob,
  scheduleTenantDeletion,
  setFeatureFlag,
  setTenantFeatureFlag,
  setTenantOverride,
  setTenantStatus,
  startSupportSession,
  tenantListQuerySchema,
  updatePlan,
} from "@/modules/admin/service";
import { getEntitlements } from "@/modules/billing/entitlements";
import { createContact, listContacts } from "@/modules/crm/contacts/service";
import { contactInputSchema, listQuerySchema } from "@/modules/crm/schemas";
import { createTeam, createUser } from "../support/factories";

type Team = Awaited<ReturnType<typeof createTeam>>;
let T: Team;
let admin: AdminActor;
let outsider: AdminActor;

async function expectAppError(p: Promise<unknown>, code: string, message?: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code && (!message || e.message === message));
}

async function expectRlsError(p: Promise<unknown>) {
  await expect(p).rejects.toSatisfy((e: unknown) => {
    const msg = `${(e as Error).message} ${((e as { cause?: Error }).cause?.message ?? "")}`;
    return /row-level security/.test(msg);
  });
}

const contact = (firstName: string) => contactInputSchema.parse({ firstName });
const q = () => listQuerySchema.parse({});

beforeAll(async () => {
  T = await createTeam("Admin Target Co");
  const a = await createUser({ superAdmin: true, fullName: "Platform Admin" });
  admin = { userId: a.id, ip: "203.0.113.7", userAgent: "vitest-admin" };
  // A tenant owner is not a platform admin.
  outsider = { userId: T.owner.id, ip: "198.51.100.1", userAgent: "vitest" };
});

afterAll(async () => {
  await closeDb();
});

describe("admin guard", () => {
  it("denies every admin function to non-admins (including tenant owners and unknown users)", async () => {
    const tid = T.tenant.id;
    const calls: [string, (actor: AdminActor) => Promise<unknown>][] = [
      ["stats", (a) => getPlatformStats(a)],
      ["listTenants", (a) => listTenants(a, tenantListQuerySchema.parse({}))],
      ["tenantDetail", (a) => getTenantDetail(a, tid)],
      ["override", (a) => setTenantOverride(a, tid, { limits: {}, featuresAdd: ["api"], featuresRemove: [] })],
      ["changePlan", (a) => adminChangePlan(a, tid, "business", "month")],
      ["suspend", (a) => setTenantStatus(a, tid, "suspended", "trying to suspend")],
      ["delete", (a) => scheduleTenantDeletion(a, tid, T.tenant.slug, "trying to delete")],
      ["undelete", (a) => cancelTenantDeletion(a, tid)],
      ["plans", (a) => listPlansAdmin(a)],
      ["updatePlan", (a) => updatePlan(a, "starter", {} as never)],
      ["flags", (a) => listFeatureFlags(a)],
      ["createFlag", (a) => createFeatureFlag(a, "evil.flag", "")],
      ["setFlag", (a) => setFeatureFlag(a, "evil.flag", true)],
      ["tenantFlag", (a) => setTenantFeatureFlag(a, tid, "evil.flag", true)],
      ["deadJobs", (a) => listDeadJobs(a)],
      ["retryJob", (a) => retryDeadJob(a, 1)],
      ["cancelJob", (a) => cancelDeadJob(a, 1)],
      ["support", (a) => startSupportSession(a, { tenantId: tid, reason: "I would like to look around", minutes: 30 })],
      ["endSupport", (a) => endSupportSession(a)],
      ["sessions", (a) => listSupportSessions(a)],
      ["audit", (a) => listPlatformAudit(a, { scope: "all", page: 1, pageSize: 50 })],
      ["activeSupport", (a) => activeSupportFor(a)],
    ];
    const nobody: AdminActor = { userId: "00000000-0000-0000-0000-000000000000", ip: null, userAgent: null };
    for (const [name, call] of calls) {
      for (const actor of [outsider, nobody]) {
        await expect(call(actor), name).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === "FORBIDDEN");
      }
    }
    await expectAppError(assertSuperAdmin(null), "FORBIDDEN");
    // Nothing leaked through: tenant untouched, no support session, no flag.
    const [t] = await db().select().from(schema.tenants).where(eq(schema.tenants.id, tid));
    expect(t).toMatchObject({ status: "active", deletedAt: null });
    expect(await db().select().from(schema.featureFlags).where(eq(schema.featureFlags.key, "evil.flag"))).toEqual([]);
    expect(await db().select().from(schema.supportSessions).where(eq(schema.supportSessions.adminUserId, T.owner.id))).toEqual([]);
  });

  it("allows super admins", async () => {
    const stats = await getPlatformStats(admin);
    expect(stats.tenants.total).toBeGreaterThanOrEqual(1);
    const { rows } = await listTenants(admin, tenantListQuerySchema.parse({ q: "Admin Target" }));
    expect(rows.map((r) => r.id)).toContain(T.tenant.id);
    const detail = await getTenantDetail(admin, T.tenant.id);
    expect(detail.members).toHaveLength(3);
  });
});

describe("plan overrides", () => {
  it("adds and removes features and limits for one tenant, audited with ip and user agent", async () => {
    const tid = T.tenant.id;
    const base = await getEntitlements(db(), tid);
    expect(base.features.has("api")).toBe(true); // pro trial
    await setTenantOverride(admin, tid, { limits: { max_contacts: 123, seats: 7 }, featuresAdd: [], featuresRemove: ["api", "webhooks"], note: "Contract #42" });
    let ent = await getEntitlements(db(), tid);
    expect(ent.features.has("api")).toBe(false);
    expect(ent.features.has("webhooks")).toBe(false);
    expect(ent.limits.max_contacts).toBe(123);
    expect(ent.seatLimit).toBe(7);

    await adminChangePlan(admin, tid, "starter", "month");
    await setTenantOverride(admin, tid, { limits: {}, featuresAdd: ["api"], featuresRemove: [] });
    ent = await getEntitlements(db(), tid);
    expect(ent.planId).toBe("starter");
    expect(ent.features.has("api")).toBe(true); // not in Starter, added by override
    expect(ent.limits.max_contacts).toBe(5000);

    await setTenantOverride(admin, tid, { limits: {}, featuresAdd: [], featuresRemove: [] });
    ent = await getEntitlements(db(), tid);
    expect(ent.features.has("api")).toBe(false);

    await expectAppError(setTenantOverride(admin, tid, { limits: {}, featuresAdd: ["ai"], featuresRemove: ["ai"] }), "VALIDATION", "admin.featureConflict");

    const logs = await db()
      .select()
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.tenantId, tid), eq(schema.auditLogs.action, "billing.admin_override_updated")));
    expect(logs).toHaveLength(3);
    expect(logs.every((l) => l.actorType === "admin" && l.actorUserId === admin.userId && l.ip === "203.0.113.7" && l.userAgent === "vitest-admin")).toBe(true);
    const [planLog] = await db()
      .select()
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.tenantId, tid), eq(schema.auditLogs.action, "billing.admin_plan_changed")));
    expect(planLog.metadata).toMatchObject({ from: "pro", to: "starter", forced: false });
  });

  it("refuses plan changes that strand members unless forced", async () => {
    const X = await createTeam("Admin Force Co");
    await expectAppError(adminChangePlan(admin, X.tenant.id, "free", "month"), "PRECONDITION", "billing.tooManyMembers");
    await adminChangePlan(admin, X.tenant.id, "free", "month", { force: true });
    expect((await getEntitlements(db(), X.tenant.id)).planId).toBe("free");
  });
});

describe("tenant status", () => {
  it("a suspended tenant is read-only for its members until reactivated", async () => {
    const S = await createTeam("Suspend Me Co");
    await createContact(S.ownerCtx, contact("Before"));
    await expectAppError(setTenantStatus(admin, S.tenant.id, "suspended", "no"), "VALIDATION", "admin.reasonRequired");
    await setTenantStatus(admin, S.tenant.id, "suspended", "Abuse report #17");

    // Database level: reads work, writes are refused by RLS.
    await withUserTx(S.owner.id, async (tx) => {
      expect((await tx.select().from(schema.contacts)).map((c) => c.firstName)).toEqual(["Before"]);
    });
    await expectRlsError(withUserTx(S.owner.id, (tx) => tx.insert(schema.contacts).values({ tenantId: S.tenant.id, firstName: "During" })));
    // Service level: the request context is read-only (as built by getTenantContext).
    const ro = userCtx({ tenantId: S.tenant.id, userId: S.owner.id, role: "owner", readOnly: true });
    await expectAppError(createContact(ro, contact("During")), "READ_ONLY");
    expect((await listContacts(ro, q())).total).toBe(1);

    await setTenantStatus(admin, S.tenant.id, "active", "Resolved with customer");
    await createContact(S.ownerCtx, contact("After"));
    const actions = (await db().select().from(schema.auditLogs).where(eq(schema.auditLogs.tenantId, S.tenant.id))).map((l) => l.action);
    expect(actions).toEqual(expect.arrayContaining(["admin.tenant_suspended", "admin.tenant_reactivated"]));
  });

  it("schedules deletion only with the exact slug, and can cancel it", async () => {
    const D = await createTeam("Delete Me Co");
    await expectAppError(scheduleTenantDeletion(admin, D.tenant.id, "wrong-slug", "Customer request"), "VALIDATION", "admin.confirmSlugMismatch");
    await scheduleTenantDeletion(admin, D.tenant.id, D.tenant.slug, "Customer request by email");
    let [t] = await db().select().from(schema.tenants).where(eq(schema.tenants.id, D.tenant.id));
    expect(t.deletedAt).toBeInstanceOf(Date);
    expect(t.purgeAfter!.getTime() - Date.now()).toBeGreaterThan(29 * 86400_000);
    // Members lose access immediately.
    await withUserTx(D.owner.id, async (tx) => {
      expect(await tx.select().from(schema.contacts)).toEqual([]);
    });
    await expectAppError(startSupportSession(admin, { tenantId: D.tenant.id, reason: "Check before purge please", minutes: 15 }), "PRECONDITION", "admin.tenantDeleted");
    await cancelTenantDeletion(admin, D.tenant.id);
    [t] = await db().select().from(schema.tenants).where(eq(schema.tenants.id, D.tenant.id));
    expect(t).toMatchObject({ deletedAt: null, purgeAfter: null });
  });
});

describe("support mode", () => {
  it("is read-only, time-boxed and audited", async () => {
    const C = await createTeam("Support Me Co");
    await createContact(C.ownerCtx, contact("Customer Contact"));
    await expect(startSupportSession(admin, { tenantId: C.tenant.id, reason: "too short", minutes: 30 })).rejects.toThrow();
    await expect(startSupportSession(admin, { tenantId: C.tenant.id, reason: "Ticket 1234: import looks wrong", minutes: 17 })).rejects.toThrow();

    const session = await startSupportSession(admin, { tenantId: C.tenant.id, reason: "Ticket 1234: import looks wrong", minutes: 30 });
    expect(session.expiresAt.getTime() - session.startedAt.getTime()).toBe(30 * 60_000);
    expect((await activeSupportFor(admin))?.tenantId).toBe(C.tenant.id);

    const ctx = supportCtx({ tenantId: C.tenant.id, userId: admin.userId });
    const { rows } = await listContacts(ctx, q());
    expect(rows.map((r) => r.firstName)).toEqual(["Customer Contact"]);
    await expectAppError(createContact(ctx, contact("Admin Wrote This")), "READ_ONLY");
    await expectRlsError(withUserTx(admin.userId, (tx) => tx.insert(schema.contacts).values({ tenantId: C.tenant.id, firstName: "Sneaky" })));
    // No access to other tenants.
    await withUserTx(admin.userId, async (tx) => {
      const tenants = new Set((await tx.select().from(schema.contacts)).map((c) => c.tenantId));
      expect([...tenants]).toEqual([C.tenant.id]);
    });

    // Starting another session ends the first one (one at a time).
    const other = await createTeam("Support Other Co");
    await startSupportSession(admin, { tenantId: other.tenant.id, reason: "Ticket 1235: billing question", minutes: 15 });
    const [first] = await db().select().from(schema.supportSessions).where(eq(schema.supportSessions.id, session.id));
    expect(first.endedAt).toBeInstanceOf(Date);
    expect((await listContacts(ctx, q())).rows).toEqual([]);

    // Expiry: once expires_at passes, RLS stops granting reads.
    await db().update(schema.supportSessions).set({ startedAt: new Date(Date.now() - 3600_000), expiresAt: new Date(Date.now() - 1000) }).where(and(eq(schema.supportSessions.adminUserId, admin.userId), sql`ended_at is null`));
    await withUserTx(admin.userId, async (tx) => {
      expect(await tx.select().from(schema.contacts)).toEqual([]);
    });
    expect(await activeSupportFor(admin)).toBeNull();

    const left = await endSupportSession(admin);
    expect(left).toEqual([other.tenant.id]);
    const audit = await db()
      .select()
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.actorUserId, admin.userId), sql`action like 'admin.support_%'`));
    expect(audit.map((a) => a.action).sort()).toEqual(["admin.support_ended", "admin.support_started", "admin.support_started"]);
    expect(audit.find((a) => a.tenantId === C.tenant.id)?.metadata).toMatchObject({ reason: "Ticket 1234: import looks wrong", minutes: 30 });
  });

  it("is not needed (and refused) for tenants the admin belongs to", async () => {
    const own = await createTeam("Admin Owned Co");
    await db().insert(schema.memberships).values({ tenantId: own.tenant.id, userId: admin.userId, role: "manager" });
    await expectAppError(startSupportSession(admin, { tenantId: own.tenant.id, reason: "Looking at my own org", minutes: 15 }), "PRECONDITION", "admin.alreadyMember");
  });
});

describe("feature flags", () => {
  it("toggles globally and per tenant", async () => {
    const key = `test.flag_${Date.now()}`;
    await createFeatureFlag(admin, key, "Integration test flag");
    await expectAppError(createFeatureFlag(admin, key, "dup"), "CONFLICT", "admin.flagExists");
    expect(await featureFlagEnabled(db(), T.tenant.id, key)).toBe(false);
    await setTenantFeatureFlag(admin, T.tenant.id, key, true);
    expect(await featureFlagEnabled(db(), T.tenant.id, key)).toBe(true);
    await setFeatureFlag(admin, key, true);
    await setTenantFeatureFlag(admin, T.tenant.id, key, false);
    expect(await featureFlagEnabled(db(), T.tenant.id, key)).toBe(false);
    expect(await featureFlagEnabled(db(), null, key)).toBe(true);
    await setTenantFeatureFlag(admin, T.tenant.id, key, null);
    expect(await featureFlagEnabled(db(), T.tenant.id, key)).toBe(true);
    const flag = (await listFeatureFlags(admin)).find((f) => f.key === key);
    expect(flag).toMatchObject({ enabled: true, overrides: [] });
    await expectAppError(setFeatureFlag(admin, "missing.flag", true), "NOT_FOUND");
  });
});

describe("plans editor", () => {
  it("validates edits and protects plans in use", async () => {
    const plans = await listPlansAdmin(admin);
    const starter = plans.find((p) => p.id === "starter")!;
    const input = {
      nameHe: starter.name.he,
      nameEn: "Starter Plus",
      descriptionHe: "",
      descriptionEn: "",
      priceMonthlyCents: 15900,
      priceYearlyCents: 159000,
      trialDays: 14,
      seatLimit: 6,
      limits: { max_contacts: 6000 },
      features: ["crm", "tasks", "whatsapp"] as ("crm" | "tasks" | "whatsapp")[],
      isPublic: true,
      active: true,
      stripePriceMonth: "price_StarterPlus1",
      stripePriceYear: "",
    };
    await expectAppError(updatePlan(admin, "starter", { ...input, features: ["tasks"] }), "VALIDATION", "admin.crmRequired");
    await expectAppError(updatePlan(admin, "starter", { ...input, active: false }), "PRECONDITION", "admin.planInUse");
    await expectAppError(updatePlan(admin, "free", { ...input, active: false }), "PRECONDITION", "admin.planInUse");
    await expect(updatePlan(admin, "starter", { ...input, stripePriceMonth: "not-a-price" })).rejects.toThrow();
    await updatePlan(admin, "starter", input);
    const [row] = await db().select().from(schema.plans).where(eq(schema.plans.id, "starter"));
    expect(row).toMatchObject({ nameEn: "Starter Plus", priceMonthlyCents: 15900, seatLimit: 6 });
    expect(row.providerPriceIds).toEqual({ stripe: { month: "price_StarterPlus1" } });
    // Restore for other tests.
    await updatePlan(admin, "starter", {
      ...input,
      nameEn: starter.name.en,
      descriptionHe: starter.description.he,
      descriptionEn: starter.description.en,
      priceMonthlyCents: starter.priceMonthlyCents,
      priceYearlyCents: starter.priceYearlyCents,
      seatLimit: starter.seatLimit,
      limits: starter.limits as typeof input.limits,
      features: starter.features as typeof input.features,
      stripePriceMonth: "",
    });
  });
});

describe("dead-letter queue", () => {
  it("retries and cancels dead jobs", async () => {
    const a = (await enqueueJob(db(), { tenantId: T.tenant.id, type: "test.admin_dead", payload: {} }))!;
    const b = (await enqueueJob(db(), { tenantId: null, type: "test.admin_dead", payload: {} }))!;
    await db().execute(sql`update public.jobs set status = 'dead', attempts = max_attempts, last_error = 'boom', finished_at = now() where id in (${a}, ${b})`);
    const { rows } = await listDeadJobs(admin);
    expect(rows.map((r) => r.id)).toEqual(expect.arrayContaining([a, b]));
    await retryDeadJob(admin, a);
    await cancelDeadJob(admin, b);
    const states = await db().select({ id: schema.jobs.id, status: schema.jobs.status }).from(schema.jobs).where(sql`id in (${a}, ${b})`);
    expect(Object.fromEntries(states.map((s) => [s.id, s.status]))).toEqual({ [a]: "queued", [b]: "canceled" });
    await expectAppError(cancelDeadJob(admin, b), "NOT_FOUND");
    await db().execute(sql`delete from public.jobs where type = 'test.admin_dead'`);
    const { rows: audit } = await listPlatformAudit(admin, { scope: "admin", action: "admin.job_", page: 1, pageSize: 50 });
    expect(audit.map((r) => r.action)).toEqual(expect.arrayContaining(["admin.job_retried", "admin.job_canceled"]));
  });
});

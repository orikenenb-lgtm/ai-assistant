/**
 * Analytics aggregates against real Postgres with hand-computed expectations.
 * Dates sit around Israel's DST switch (2026-03-27) to prove bucketing happens
 * in the tenant's time zone, not UTC.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq, sql } from "drizzle-orm";
import { closeDb, db, schema } from "@/server/db";
import { AppError } from "@/server/errors";
import { customersReport, dashboardData, firstResponseByUser, leadsReport, pipelineReport, resolveScope, revenueReport, teamReport } from "@/modules/analytics/service";
import { exportReportCsv } from "@/modules/analytics/export";
import { localDate } from "@/modules/analytics/range";
import { createTeam } from "../support/factories";

type Team = Awaited<ReturnType<typeof createTeam>>;
let A: Team;
let B: Team;
let stages: (typeof schema.pipelineStages.$inferSelect)[];
let pipelineId: string;

const RANGE = { preset: "custom" as const, from: "2026-03-01", to: "2026-04-30", interval: "month" as const };
const TZ = "Asia/Jerusalem";

async function stagesOf(tenantId: string) {
  const [p] = await db().select().from(schema.pipelines).where(eq(schema.pipelines.tenantId, tenantId));
  const s = await db().select().from(schema.pipelineStages).where(eq(schema.pipelineStages.pipelineId, p.id)).orderBy(asc(schema.pipelineStages.position));
  return { pipelineId: p.id, stages: s };
}

async function deal(team: Team, v: Partial<typeof schema.deals.$inferInsert> & { stagePos: number }) {
  const { stages: st, pipelineId: pid } = await stagesOf(team.tenant.id);
  const { stagePos, ...rest } = v;
  const [row] = await db()
    .insert(schema.deals)
    .values({ tenantId: team.tenant.id, pipelineId: pid, stageId: st[stagePos].id, title: "Deal", ...rest })
    .returning();
  return row;
}

async function expectAppError(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code);
}

beforeAll(async () => {
  A = await createTeam("Analytics A");
  B = await createTeam("Analytics B");
  ({ stages, pipelineId } = await stagesOf(A.tenant.id));
  const won = stages.find((s) => s.kind === "won")!.position;
  const lost = stages.find((s) => s.kind === "lost")!.position;
  const [reason] = await db().select().from(schema.lostReasons).where(and(eq(schema.lostReasons.tenantId, A.tenant.id), eq(schema.lostReasons.label, "מחיר")));

  // 23:30 local on Mar 31 (still March) vs 00:30 local on Apr 1 (April) — both are 20:30/21:30 UTC.
  await deal(A, { stagePos: won, status: "won", valueCents: 100_000, ownerId: A.agent.id, wonAt: new Date("2026-03-31T20:30:00Z"), createdAt: new Date("2026-03-02T09:00:00Z") });
  await deal(A, { stagePos: won, status: "won", valueCents: 300_000, ownerId: A.manager.id, wonAt: new Date("2026-03-31T21:30:00Z"), createdAt: new Date("2026-03-03T09:00:00Z") });
  await deal(A, { stagePos: lost, status: "lost", valueCents: 50_000, ownerId: A.agent.id, lostAt: new Date("2026-04-10T10:00:00Z"), lostReasonId: reason.id });
  await deal(A, { stagePos: won, status: "won", valueCents: 70_000, currency: "USD", ownerId: A.manager.id, wonAt: new Date("2026-04-12T10:00:00Z") });
  // Open deals: stage probability 50 → weighted 100,000; override 80 → weighted 320,000.
  const today = localDate(new Date(), TZ);
  await deal(A, { stagePos: 2, valueCents: 200_000, ownerId: A.agent.id, expectedCloseDate: today, createdAt: new Date("2026-04-05T09:00:00Z") });
  await deal(A, { stagePos: 1, valueCents: 400_000, probability: 80, ownerId: A.manager.id });
  // Tenant B noise that must never leak into A's numbers.
  await deal(B, { stagePos: stages.findIndex((s) => s.kind === "won"), status: "won", valueCents: 9_999_900, ownerId: B.owner.id, wonAt: new Date("2026-04-02T10:00:00Z") });

  // Leads: 3 created in range, 2 converted after 2 days and 1 day → median 1.5 days.
  await db().insert(schema.leads).values([
    { tenantId: A.tenant.id, fullName: "L1", source: "website", status: "converted", ownerId: A.agent.id, createdAt: new Date("2026-04-02T08:00:00Z"), convertedAt: new Date("2026-04-04T08:00:00Z") },
    { tenantId: A.tenant.id, fullName: "L2", source: "whatsapp", status: "new", ownerId: A.manager.id, createdAt: new Date("2026-04-03T08:00:00Z"), aiClassification: "hot" },
    { tenantId: A.tenant.id, fullName: "L3", source: "website", status: "converted", ownerId: A.manager.id, createdAt: new Date("2026-04-20T08:00:00Z"), convertedAt: new Date("2026-04-21T08:00:00Z") },
    { tenantId: B.tenant.id, fullName: "BL", source: "website", status: "new", createdAt: new Date("2026-04-02T08:00:00Z") },
  ]);

  // Conversation: customer turn answered by the agent after 60s, next turn answered by the manager after 280s.
  const [contact] = await db().insert(schema.contacts).values({ tenantId: A.tenant.id, firstName: "Chat", phone: "+972501112233", createdAt: new Date("2026-04-01T08:00:00Z") }).returning();
  const [wa] = await db()
    .insert(schema.whatsappAccounts)
    .values({ tenantId: A.tenant.id, provider: "mock", displayName: "WA", phoneNumber: "+972500000001", phoneNumberId: `pn_an_${A.tenant.id.slice(0, 6)}`, wabaId: "waba" })
    .returning();
  const [conv] = await db().insert(schema.conversations).values({ tenantId: A.tenant.id, whatsappAccountId: wa.id, contactId: contact.id, unreadCount: 2 }).returning();
  const t0 = new Date("2026-04-15T09:00:00Z").getTime();
  const msg = (offsetSec: number, direction: "inbound" | "outbound", userId?: string) => ({
    tenantId: A.tenant.id,
    conversationId: conv.id,
    direction,
    type: "text",
    body: "x",
    status: direction === "inbound" ? "received" : "sent",
    senderType: direction === "inbound" ? "contact" : "user",
    senderUserId: userId ?? null,
    createdAt: new Date(t0 + offsetSec * 1000),
  });
  await db().insert(schema.messages).values([
    msg(0, "inbound"),
    msg(60, "outbound", A.agent.id),
    msg(120, "inbound"),
    msg(130, "inbound"),
    msg(400, "outbound", A.manager.id),
  ]);

  await db().insert(schema.tasks).values([
    { tenantId: A.tenant.id, title: "done", status: "done", completedAt: new Date("2026-04-16T10:00:00Z"), completedBy: A.agent.id, assigneeId: A.agent.id },
    { tenantId: A.tenant.id, title: "overdue", assigneeId: A.agent.id, dueAt: new Date(Date.now() - 3 * 86_400_000) },
  ]);
  await db().insert(schema.activities).values([
    { tenantId: A.tenant.id, type: "call", contactId: contact.id, actorId: A.agent.id, occurredAt: new Date("2026-04-15T10:00:00Z") },
    { tenantId: A.tenant.id, type: "meeting", contactId: contact.id, actorId: A.manager.id, occurredAt: new Date("2026-04-16T10:00:00Z") },
  ]);
});

afterAll(async () => {
  await closeDb();
});

describe("revenue", () => {
  it("buckets months in the tenant time zone and computes win rate (team scope)", async () => {
    const scope = await resolveScope(A.ownerCtx, RANGE);
    expect(scope.range.bucket).toBe("month");
    const r = await revenueReport(A.ownerCtx, scope);
    expect(r.series).toEqual([
      { bucket: "2026-03-01", wonCount: 1, wonValueCents: 100_000 },
      { bucket: "2026-04-01", wonCount: 1, wonValueCents: 300_000 },
    ]);
    expect(r.totals).toMatchObject({ wonCount: 2, wonValueCents: 400_000, lostCount: 1, avgDealCents: 200_000 });
    expect(r.totals.winRate).toBeCloseTo(2 / 3);
    expect(r.excludedOtherCurrency).toBe(1);
    expect(r.lostReasons).toEqual([{ label: "מחיר", count: 1 }]);
  });

  it("forces agents to their own records even if the URL asks for someone else", async () => {
    const scope = await resolveScope(A.agentCtx, { ...RANGE, owner: A.manager.id });
    expect(scope.ownerId).toBe(A.agent.id);
    const r = await revenueReport(A.agentCtx, scope);
    expect(r.totals).toMatchObject({ wonCount: 1, wonValueCents: 100_000, lostCount: 1, winRate: 0.5 });
  });

  it("owner filter narrows the team view", async () => {
    const scope = await resolveScope(A.ownerCtx, { ...RANGE, owner: A.manager.id });
    const r = await revenueReport(A.ownerCtx, scope);
    expect(r.totals).toMatchObject({ wonCount: 1, wonValueCents: 300_000, lostCount: 0 });
  });

  it("never counts another tenant's data", async () => {
    const r = await revenueReport(B.ownerCtx, await resolveScope(B.ownerCtx, RANGE));
    expect(r.totals.wonValueCents).toBe(9_999_900);
    const a = await revenueReport(A.ownerCtx, await resolveScope(A.ownerCtx, RANGE));
    expect(a.totals.wonValueCents).toBe(400_000);
  });
});

describe("pipeline", () => {
  it("snapshots open value by stage, weighted forecast and funnel reach", async () => {
    const p = await pipelineReport(A.ownerCtx, await resolveScope(A.ownerCtx, RANGE));
    expect(p.pipelineId).toBe(pipelineId);
    expect(p.totals).toMatchObject({ openCount: 2, openValueCents: 600_000, weightedValueCents: 420_000 });
    const byPos = (pos: number) => p.stages.find((s) => s.stageId === stages[pos].id)!;
    expect(byPos(2)).toMatchObject({ openCount: 1, openValueCents: 200_000, weightedValueCents: 100_000 });
    expect(byPos(1)).toMatchObject({ openCount: 1, openValueCents: 400_000, weightedValueCents: 320_000 });
    // The deal created in range entered at stage #2 → counted at stages 0..2 of the funnel.
    expect([0, 1, 2, 3].map((i) => byPos(i).reachedCount)).toEqual([3, 3, 3, 2]);
    expect(p.forecast[0]).toMatchObject({ count: 1, valueCents: 200_000, weightedValueCents: 100_000 });
    expect(p.noCloseDate).toEqual({ count: 1, valueCents: 400_000 });
  });

  it("agent scope only sees their open deals", async () => {
    const p = await pipelineReport(A.agentCtx, await resolveScope(A.agentCtx, RANGE));
    expect(p.totals).toMatchObject({ openCount: 1, openValueCents: 200_000, weightedValueCents: 100_000 });
  });
});

describe("leads", () => {
  it("conversion rate, median time to convert, sources and AI classes", async () => {
    const l = await leadsReport(A.ownerCtx, await resolveScope(A.ownerCtx, RANGE));
    expect(l.totals.created).toBe(3);
    expect(l.totals.converted).toBe(2);
    expect(l.totals.conversionRate).toBeCloseTo(2 / 3);
    expect(l.totals.medianSecondsToConvert).toBe(1.5 * 86_400);
    expect(l.bySource).toEqual([
      { source: "website", count: 2 },
      { source: "whatsapp", count: 1 },
    ]);
    expect(l.classification).toEqual(expect.arrayContaining([{ label: "hot", count: 1 }, { label: "unclassified", count: 2 }]));
  });
});

describe("team", () => {
  it("first-response median per user, activities, tasks and win rates", async () => {
    const scope = await resolveScope(A.ownerCtx, RANGE);
    const resp = await A.ownerCtx.run((tx) => firstResponseByUser(tx, scope));
    expect(resp).toEqual(
      expect.arrayContaining([
        { userId: A.agent.id, medianSeconds: 60, count: 1 },
        { userId: A.manager.id, medianSeconds: 280, count: 1 },
      ]),
    );
    const t = await teamReport(A.ownerCtx, scope);
    const agent = t.members.find((m) => m.userId === A.agent.id)!;
    expect(agent).toMatchObject({ wonCount: 1, lostCount: 1, winRate: 0.5, tasksCompleted: 1, conversationsHandled: 1, medianFirstResponseSeconds: 60 });
    expect(agent.activities.call).toBe(1);
    const manager = t.members.find((m) => m.userId === A.manager.id)!;
    // Two wins (one in USD): the count includes both, the value only the tenant currency.
    expect(manager).toMatchObject({ wonCount: 2, wonValueCents: 300_000, medianFirstResponseSeconds: 280 });
    expect(manager.activities.meeting).toBe(1);
  });

  it("agents only see their own row", async () => {
    const t = await teamReport(A.agentCtx, await resolveScope(A.agentCtx, RANGE));
    expect(t.members.map((m) => m.userId)).toEqual([A.agent.id]);
  });
});

describe("customers", () => {
  it("counts new and active contacts", async () => {
    const c = await customersReport(A.ownerCtx, await resolveScope(A.ownerCtx, RANGE));
    expect(c.totals.created).toBe(1);
    expect(c.totals.active).toBe(1);
    expect(c.lifecycle).toEqual([{ stage: "lead", count: 1 }]);
  });
});

describe("dashboard", () => {
  it("team KPIs for managers, personal KPIs for agents", async () => {
    const team = await dashboardData(A.managerCtx);
    expect(team.kpis).toMatchObject({ openDeals: 2, openPipelineCents: 600_000, weightedPipelineCents: 420_000, openConversations: 1, unreadMessages: 2 });
    expect(team.pipeline.stages.reduce((a, s) => a + s.valueCents, 0)).toBe(600_000);
    expect(team.wonByMonth).toHaveLength(12);
    expect(team.hasData.deals).toBeGreaterThan(0);

    const mine = await dashboardData(A.agentCtx);
    expect(mine.agentScoped).toBe(true);
    expect(mine.kpis).toMatchObject({ openDeals: 1, openPipelineCents: 200_000, tasksOverdue: 1, openConversations: 0 });
    expect(mine.myTasksToday.map((x) => x.title)).toEqual(["overdue"]);
    expect(mine.myTasksToday[0].overdue).toBe(true);
    expect(mine.closingSoon.map((d) => d.valueCents)).toEqual([200_000]);
  });

  it("a fresh tenant gets zeros, not errors", async () => {
    const fresh = await createTeam("Fresh");
    const d = await dashboardData(fresh.ownerCtx);
    expect(d.hasData).toEqual({ contacts: 0, deals: 0, leads: 0 });
    expect(d.kpis.conversionRate90d).toBeNull();
    expect(d.kpis.wonChangePct).toBeNull();
  });
});

describe("CSV export", () => {
  it("exports a BOM-prefixed CSV and writes an audit entry", async () => {
    const csv = await exportReportCsv(A.ownerCtx, "revenue", await resolveScope(A.ownerCtx, RANGE));
    expect(csv.startsWith("﻿bucket_start,won_deals,won_value_ILS\r\n2026-03-01,1,1000.00\r\n2026-04-01,1,3000.00")).toBe(true);
    expect(csv).toContain("מחיר,1");
    const [{ n }] = await db().execute<{ n: number }>(sql`select count(*)::int as n from public.audit_logs where tenant_id = ${A.tenant.id} and action = 'analytics.exported'`);
    expect(n).toBe(1);
  });

  it("agents cannot export", async () => {
    await expectAppError(exportReportCsv(A.agentCtx, "team", await resolveScope(A.agentCtx, RANGE)), "FORBIDDEN");
  });
});

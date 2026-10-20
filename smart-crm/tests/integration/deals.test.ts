import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { closeDb, db, schema } from "@/server/db";
import { dealInputSchema, dealListQuerySchema, leadInputSchema } from "@/modules/sales/schemas";
import {
  createDeal,
  dealStageHistory,
  deleteDeal,
  getBoard,
  getDeal,
  getForecast,
  listDeals,
  loseDeal,
  moveDeal,
  reopenDeal,
  updateDeal,
  winDeal,
} from "@/modules/sales/deals";
import { listLostReasons, listPipelines, type PipelineView } from "@/modules/sales/pipelines";
import { contactInputSchema } from "@/modules/crm/schemas";
import { createContact } from "@/modules/crm/contacts/service";
import { listTimeline } from "@/modules/crm/activities";
import { AppError } from "@/server/errors";
import { createTeam } from "../support/factories";

type Team = Awaited<ReturnType<typeof createTeam>>;
let T: Team;
let Other: Team;
let P: PipelineView;

const deal = (v: Record<string, unknown>) => dealInputSchema.parse({ pipelineId: P.id, stageId: P.stages[0].id, ...v });
const q = (v: Record<string, unknown> = {}) => dealListQuerySchema.parse(v);

async function expectAppError(p: Promise<unknown>, code: string, message?: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code && (!message || e.message === message));
}

beforeAll(async () => {
  T = await createTeam("Deals Co");
  Other = await createTeam("Other Deals Co");
  [P] = await listPipelines(T.ownerCtx);
});
afterAll(async () => {
  await closeDb();
});

describe("deal input", () => {
  it("converts major units to cents and validates", () => {
    expect(dealInputSchema.parse({ title: "x", value: "12,345.67", pipelineId: crypto.randomUUID(), stageId: crypto.randomUUID() }).value).toBe(1234567);
    expect(dealInputSchema.safeParse({ title: "", pipelineId: crypto.randomUUID(), stageId: crypto.randomUUID() }).success).toBe(false);
    expect(dealInputSchema.safeParse({ title: "x", value: "-5", pipelineId: crypto.randomUUID(), stageId: crypto.randomUUID() }).success).toBe(false);
    expect(dealInputSchema.safeParse({ title: "x", probability: 150, pipelineId: crypto.randomUUID(), stageId: crypto.randomUUID() }).success).toBe(false);
  });

  it("keeps an empty probability override empty (falls back to the stage probability)", () => {
    const base = { title: "x", pipelineId: crypto.randomUUID(), stageId: crypto.randomUUID() };
    expect(dealInputSchema.parse({ ...base, probability: "" }).probability).toBeNull();
    expect(dealInputSchema.parse({ ...base, probability: null }).probability).toBeNull();
    expect(dealInputSchema.parse(base).probability).toBeNull();
    expect(dealInputSchema.parse({ ...base, probability: "0" }).probability).toBe(0);
    expect(dealInputSchema.parse({ ...base, probability: "35" }).probability).toBe(35);
    expect(leadInputSchema.parse({ fullName: "x", score: "" }).score).toBeNull();
  });
});

describe("deals service", () => {
  it("creates a deal with timeline entries on the deal and its contact, and an event", async () => {
    const contact = await createContact(T.agentCtx, contactInputSchema.parse({ firstName: "Deal", lastName: "Contact" }));
    const d = await createDeal(T.agentCtx, deal({ title: "Spring order", value: 5000, contactId: contact.id }));
    expect(d).toMatchObject({ valueCents: 500000, status: "open", ownerId: T.agent.id });
    const got = await getDeal(T.agentCtx, d.id);
    expect(got.contact?.name).toBe("Deal Contact");
    expect((await listTimeline(T.agentCtx, "contact", contact.id)).items.map((i) => i.type)).toContain("deal_created");
    const [{ n }] = await db().execute<{ n: number }>(sql`select count(*)::int as n from public.jobs where payload->>'type' = 'deal.created' and payload->>'entityId' = ${d.id}`);
    expect(n).toBe(1);
    const history = await dealStageHistory(T.agentCtx, d.id);
    expect(history.map((h) => h.h.toStageId)).toEqual([P.stages[0].id]);
  });

  it("moves deals between stages with ordering and stage history from the DB trigger", async () => {
    const a = await createDeal(T.ownerCtx, deal({ title: "A" }));
    const b = await createDeal(T.ownerCtx, deal({ title: "B", stageId: P.stages[1].id }));
    const c = await createDeal(T.ownerCtx, deal({ title: "C", stageId: P.stages[1].id }));
    // Drop A between B and C.
    const moved = await moveDeal(T.ownerCtx, { id: a.id, stageId: P.stages[1].id, beforeId: b.id, afterId: c.id });
    expect(moved.stageId).toBe(P.stages[1].id);
    const board = await getBoard(T.ownerCtx, {});
    const col = board.deals.filter((d) => d.stageId === P.stages[1].id && ["A", "B", "C"].includes(d.title)).map((d) => d.title);
    expect(col).toEqual(["B", "A", "C"]);
    const hist = await dealStageHistory(T.ownerCtx, a.id);
    expect(hist.map((h) => [h.h.fromStageId, h.h.toStageId])).toEqual([
      [null, P.stages[0].id],
      [P.stages[0].id, P.stages[1].id],
    ]);
    expect(hist[1].h.changedBy).toBe(T.owner.id);
  });

  it("renumbers a column when positions get too close", async () => {
    const x = await createDeal(T.ownerCtx, deal({ title: "X", stageId: P.stages[2].id }));
    const y = await createDeal(T.ownerCtx, deal({ title: "Y", stageId: P.stages[2].id }));
    await db().update(schema.deals).set({ position: 1 }).where(eq(schema.deals.id, x.id));
    await db().update(schema.deals).set({ position: 1 + 1e-9 }).where(eq(schema.deals.id, y.id));
    const z = await createDeal(T.ownerCtx, deal({ title: "Z" }));
    await moveDeal(T.ownerCtx, { id: z.id, stageId: P.stages[2].id, beforeId: x.id, afterId: y.id });
    const rows = await db().select().from(schema.deals).where(eq(schema.deals.stageId, P.stages[2].id));
    const positions = rows.map((r) => r.position).sort((m, n) => m - n);
    for (let i = 1; i < positions.length; i++) expect(positions[i] - positions[i - 1]).toBeGreaterThanOrEqual(1);
  });

  it("win / lose / reopen keep status, stage and timestamps consistent and notify the owner", async () => {
    const d = await createDeal(T.ownerCtx, deal({ title: "Close me", value: 1000, ownerId: T.agent.id }));
    await winDeal(T.managerCtx, d.id);
    let row = (await getDeal(T.ownerCtx, d.id)).deal;
    const wonStage = P.stages.find((s) => s.kind === "won")!;
    expect(row).toMatchObject({ status: "won", stageId: wonStage.id });
    expect(row.wonAt).not.toBeNull();
    const notes = await db().select().from(schema.notifications).where(and(eq(schema.notifications.userId, T.agent.id), eq(schema.notifications.type, "deal_won")));
    expect(notes.length).toBeGreaterThanOrEqual(1);

    const [reason] = await listLostReasons(T.ownerCtx);
    await loseDeal(T.ownerCtx, d.id, { lostReasonId: reason.id, lostNote: "הלקוח בחר במתחרה" });
    row = (await getDeal(T.ownerCtx, d.id)).deal;
    expect(row).toMatchObject({ status: "lost", lostReasonId: reason.id, wonAt: null });
    expect(row.lostAt).not.toBeNull();

    await reopenDeal(T.ownerCtx, d.id);
    row = (await getDeal(T.ownerCtx, d.id)).deal;
    expect(row).toMatchObject({ status: "open", wonAt: null, lostAt: null, lostReasonId: null });
    const kinds = P.stages.filter((s) => s.kind === "open").map((s) => s.id);
    expect(kinds).toContain(row.stageId);

    // Dragging onto the lost column must go through the lost dialog.
    const lost = P.stages.find((s) => s.kind === "lost")!;
    await expectAppError(moveDeal(T.ownerCtx, { id: d.id, stageId: lost.id }), "VALIDATION", "deals.useLostDialog");
    // Dropping on the won column wins it.
    await moveDeal(T.ownerCtx, { id: d.id, stageId: wonStage.id });
    expect((await getDeal(T.ownerCtx, d.id)).deal.status).toBe("won");
    const types = (await listTimeline(T.ownerCtx, "deal", d.id)).items.map((i) => i.type);
    expect(types).toEqual(expect.arrayContaining(["deal_won", "deal_lost", "deal_stage_changed"]));
  });

  it("rejects stages from another pipeline and lost reasons from another tenant", async () => {
    const [theirs] = await listPipelines(Other.ownerCtx);
    await expectAppError(createDeal(T.ownerCtx, deal({ title: "bad", stageId: theirs.stages[0].id })), "VALIDATION");
    const [theirReason] = await listLostReasons(Other.ownerCtx);
    const d = await createDeal(T.ownerCtx, deal({ title: "r" }));
    await expectAppError(loseDeal(T.ownerCtx, d.id, { lostReasonId: theirReason.id, lostNote: null }), "VALIDATION");
  });

  it("filters the list and enforces delete permission and tenant isolation", async () => {
    const d = await createDeal(T.ownerCtx, deal({ title: "Filter target", expectedCloseDate: "2030-05-10" }));
    const byRange = await listDeals(T.ownerCtx, q({ from: "2030-05-01", to: "2030-05-31", view: "list" }));
    expect(byRange.rows.map((r) => r.id)).toEqual([d.id]);
    expect(byRange.rows[0].stageName).toBe(P.stages[0].name);
    await expectAppError(deleteDeal(T.agentCtx, d.id), "FORBIDDEN");
    await deleteDeal(T.ownerCtx, d.id);
    await expectAppError(getDeal(T.ownerCtx, d.id), "NOT_FOUND");
    const theirs = await createDeal(Other.ownerCtx, dealInputSchema.parse({ title: "Theirs", pipelineId: (await listPipelines(Other.ownerCtx))[0].id, stageId: (await listPipelines(Other.ownerCtx))[0].stages[0].id }));
    await expectAppError(getDeal(T.ownerCtx, theirs.id), "NOT_FOUND");
    await expectAppError(updateDeal(T.ownerCtx, theirs.id, deal({ title: "hack" })), "NOT_FOUND");
    await expectAppError(moveDeal(T.ownerCtx, { id: theirs.id, stageId: P.stages[1].id }), "NOT_FOUND");
  });
});

describe("forecast", () => {
  it("weights open deals by deal probability, falling back to stage probability", async () => {
    const team = await createTeam("Forecast Co");
    const [p] = await listPipelines(team.ownerCtx);
    const s0 = p.stages[0]; // 10%
    const s2 = p.stages[2]; // 50%
    await createDeal(team.ownerCtx, dealInputSchema.parse({ title: "a", value: 1000, pipelineId: p.id, stageId: s0.id, expectedCloseDate: "2031-01-15" }));
    await createDeal(team.ownerCtx, dealInputSchema.parse({ title: "b", value: 2000, pipelineId: p.id, stageId: s2.id, expectedCloseDate: "2031-01-20" }));
    await createDeal(team.ownerCtx, dealInputSchema.parse({ title: "c", value: 4000, probability: 25, pipelineId: p.id, stageId: s2.id }));
    await createDeal(team.ownerCtx, dealInputSchema.parse({ title: "usd", value: 999, currency: "USD", pipelineId: p.id, stageId: s0.id }));
    const won = await createDeal(team.ownerCtx, dealInputSchema.parse({ title: "won", value: 300, pipelineId: p.id, stageId: s0.id }));
    await winDeal(team.ownerCtx, won.id);
    const f = await getForecast(team.ownerCtx, { currency: "ILS" });
    expect(f.openCount).toBe(3);
    expect(f.openValueCents).toBe(700000);
    // 1000*10% + 2000*50% + 4000*25% = 100 + 1000 + 1000 = 2100 → cents
    expect(f.weightedValueCents).toBe(210000);
    expect(f.wonThisMonthCents).toBe(30000);
    expect(f.byMonth).toEqual([
      { month: "2031-01", count: 2, valueCents: 300000, weightedCents: 110000 },
      { month: null, count: 1, valueCents: 400000, weightedCents: 100000 },
    ]);
    expect(f.otherCurrencies).toEqual([{ currency: "USD", openValueCents: 99900 }]);
  });
});

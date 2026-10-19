import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, db, schema } from "@/server/db";
import {
  addStage,
  archivePipeline,
  createLostReason,
  createPipeline,
  deleteLostReason,
  deleteStage,
  listLostReasons,
  listPipelines,
  reorderStages,
  setDefaultPipeline,
  updateStage,
} from "@/modules/sales/pipelines";
import { createDeal } from "@/modules/sales/deals";
import { dealInputSchema } from "@/modules/sales/schemas";
import { AppError } from "@/server/errors";
import { createTeam } from "../support/factories";

type Team = Awaited<ReturnType<typeof createTeam>>;
let T: Team;
let Other: Team;

async function expectAppError(p: Promise<unknown>, code: string, message?: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code && (!message || e.message === message));
}

beforeAll(async () => {
  T = await createTeam("Pipelines Co");
  Other = await createTeam("Other Pipelines Co");
});
afterAll(async () => {
  await closeDb();
});

describe("pipelines", () => {
  it("new tenants get a default pipeline with exactly one won and one lost stage", async () => {
    const [p] = await listPipelines(T.agentCtx);
    expect(p.isDefault).toBe(true);
    expect(p.stages.filter((s) => s.kind === "won")).toHaveLength(1);
    expect(p.stages.filter((s) => s.kind === "lost")).toHaveLength(1);
    expect(p.stages.map((s) => s.position)).toEqual(p.stages.map((_, i) => i));
  });

  it("agents cannot manage pipelines", async () => {
    await expectAppError(createPipeline(T.agentCtx, { name: "Nope" }), "FORBIDDEN");
  });

  it("adds stages before the closed stages and reorders open stages only", async () => {
    const created = await createPipeline(T.managerCtx, { name: "Wholesale", locale: "he" });
    const stage = await addStage(T.managerCtx, created.id, { name: "משא ומתן", probability: 70, kind: "open", color: "#f59e0b" });
    let p = (await listPipelines(T.managerCtx)).find((x) => x.id === created.id)!;
    expect(p.stages.map((s) => s.kind)).toEqual(["open", "open", "open", "won", "lost"]);
    expect(p.stages[2].id).toBe(stage.id);

    const open = p.stages.filter((s) => s.kind === "open").map((s) => s.id).reverse();
    await reorderStages(T.managerCtx, created.id, open);
    p = (await listPipelines(T.managerCtx)).find((x) => x.id === created.id)!;
    expect(p.stages.filter((s) => s.kind === "open").map((s) => s.id)).toEqual(open);
    expect(p.stages.slice(-2).map((s) => s.kind)).toEqual(["won", "lost"]);
    // Closed stages cannot be part of a reorder.
    await expectAppError(reorderStages(T.managerCtx, created.id, p.stages.map((s) => s.id)), "VALIDATION");
    // Cannot add a second won stage or turn an open stage into a second won stage.
    await expectAppError(addStage(T.managerCtx, created.id, { name: "won2", probability: 100, kind: "won", color: "#10b981" }), "VALIDATION");
    await expectAppError(updateStage(T.managerCtx, stage.id, { name: "x", probability: 100, kind: "won", color: "#10b981" }), "VALIDATION", "pipelines.oneWonOneLost");
  });

  it("deleting a stage with deals requires a target stage and moves the deals", async () => {
    const [p] = await listPipelines(T.ownerCtx);
    const [first, second] = p.stages;
    const deal = await createDeal(T.ownerCtx, dealInputSchema.parse({ title: "Move me", pipelineId: p.id, stageId: second.id, value: 100 }));
    await expectAppError(deleteStage(T.ownerCtx, second.id, null), "VALIDATION", "pipelines.chooseTargetStage");
    await deleteStage(T.ownerCtx, second.id, first.id);
    const [row] = await db().select().from(schema.deals).where(eq(schema.deals.id, deal.id));
    expect(row.stageId).toBe(first.id);
    const after = (await listPipelines(T.ownerCtx)).find((x) => x.id === p.id)!;
    expect(after.stages.map((s) => s.position)).toEqual(after.stages.map((_, i) => i));
    // Closed stages cannot be deleted.
    const won = after.stages.find((s) => s.kind === "won")!;
    await expectAppError(deleteStage(T.ownerCtx, won.id, first.id), "VALIDATION", "pipelines.cannotDeleteClosedStage");
  });

  it("default pipeline switching and archiving rules", async () => {
    const extra = await createPipeline(T.ownerCtx, { name: "Projects" });
    const [p] = (await listPipelines(T.ownerCtx)).filter((x) => x.isDefault);
    await expectAppError(archivePipeline(T.ownerCtx, p.id), "VALIDATION", "pipelines.cannotArchiveDefault");
    await setDefaultPipeline(T.ownerCtx, extra.id);
    const pipes = await listPipelines(T.ownerCtx);
    expect(pipes.filter((x) => x.isDefault).map((x) => x.id)).toEqual([extra.id]);
    // The old default has an open deal → cannot archive.
    await expectAppError(archivePipeline(T.ownerCtx, p.id), "VALIDATION", "pipelines.hasOpenDeals");
    const empty = await createPipeline(T.ownerCtx, { name: "Empty" });
    await archivePipeline(T.ownerCtx, empty.id);
    expect((await listPipelines(T.ownerCtx)).map((x) => x.id)).not.toContain(empty.id);
  });

  it("lost reasons CRUD with uniqueness", async () => {
    const r = await createLostReason(T.ownerCtx, "יקר מדי");
    await expectAppError(createLostReason(T.ownerCtx, "יקר מדי"), "CONFLICT");
    expect((await listLostReasons(T.agentCtx)).map((x) => x.label)).toContain("יקר מדי");
    await deleteLostReason(T.ownerCtx, r.id);
    expect((await listLostReasons(T.agentCtx)).map((x) => x.label)).not.toContain("יקר מדי");
  });

  it("isolates tenants", async () => {
    const [theirs] = await listPipelines(Other.ownerCtx);
    await expectAppError(setDefaultPipeline(T.ownerCtx, theirs.id), "NOT_FOUND");
    await expectAppError(addStage(T.ownerCtx, theirs.id, { name: "x", probability: 1, kind: "open", color: "#000000" }), "NOT_FOUND");
    expect((await listPipelines(T.ownerCtx)).map((x) => x.id)).not.toContain(theirs.id);
  });
});

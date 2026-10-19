import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { closeDb, db, schema } from "@/server/db";
import { createApiKey } from "@/modules/api/keys";
import { listPipelines, type PipelineView } from "@/modules/sales/pipelines";
import { GET as listDealsRoute, POST as createDealRoute } from "@/app/api/v1/deals/route";
import { DELETE as deleteDealRoute, GET as getDealRoute, PATCH as patchDealRoute } from "@/app/api/v1/deals/[id]/route";
import { GET as listTasksRoute, POST as createTaskRoute } from "@/app/api/v1/tasks/route";
import { DELETE as deleteTaskRoute, GET as getTaskRoute, PATCH as patchTaskRoute } from "@/app/api/v1/tasks/[id]/route";
import { createTeam } from "../support/factories";

/** Public API v1: deals and tasks endpoints (scopes, validation, services, tenant isolation). */

type Team = Awaited<ReturnType<typeof createTeam>>;
let A: Team;
let B: Team;
let P: PipelineView;
let keyA: string;
let keyReadOnly: string;
let keyB: string;

const BASE = "http://localhost:3000/api/v1";
const req = (path: string, key: string, init: { method?: string; body?: unknown } = {}) =>
  new NextRequest(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${key}`, ...(init.body ? { "content-type": "application/json" } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
const noParams = { params: Promise.resolve({}) } as never;
const withId = (id: string) => ({ params: Promise.resolve({ id }) }) as never;

beforeAll(async () => {
  A = await createTeam("API Sales A");
  B = await createTeam("API Sales B");
  [P] = await listPipelines(A.ownerCtx);
  keyA = (await createApiKey(A.ownerCtx, { name: "CRM sync", scopes: ["deals:read", "deals:write", "tasks:read", "tasks:write"] })).key;
  keyReadOnly = (await createApiKey(A.ownerCtx, { name: "BI", scopes: ["deals:read", "tasks:read"] })).key;
  keyB = (await createApiKey(B.ownerCtx, { name: "B", scopes: ["deals:read", "deals:write", "tasks:read", "tasks:write"] })).key;
});
afterAll(async () => {
  await closeDb();
});

describe("deals", () => {
  it("creates, reads, patches (stage move), lists, deletes", async () => {
    const [contact] = await db().insert(schema.contacts).values({ tenantId: A.tenant.id, firstName: "API buyer" }).returning();
    const created = await createDealRoute(
      req("/deals", keyA, { method: "POST", body: { title: "API deal", valueCents: 123_450, pipelineId: P.id, stageId: P.stages[0].id, contactId: contact.id } }),
      noParams,
    );
    expect(created.status).toBe(201);
    const { data: deal } = await created.json();
    expect(deal).toMatchObject({ title: "API deal", valueCents: 123_450, status: "open", contactId: contact.id });

    const next = P.stages.find((s) => s.kind === "open" && s.id !== P.stages[0].id)!;
    const patched = await patchDealRoute(req(`/deals/${deal.id}`, keyA, { method: "PATCH", body: { stageId: next.id, probability: 60 } }), withId(deal.id));
    expect(patched.status).toBe(200);
    expect((await patched.json()).data).toMatchObject({ stageId: next.id, probability: 60, title: "API deal", valueCents: 123_450 });
    const history = await db().select().from(schema.dealStageHistory).where(eq(schema.dealStageHistory.dealId, deal.id));
    expect(history.some((h) => h.toStageId === next.id)).toBe(true);

    const list = await (await listDealsRoute(req(`/deals?contactId=${contact.id}`, keyA), noParams)).json();
    expect(list.data.map((d: { id: string }) => d.id)).toEqual([deal.id]);
    expect(list.pagination.total).toBe(1);

    expect((await getDealRoute(req(`/deals/${deal.id}`, keyReadOnly), withId(deal.id))).status).toBe(200);
    expect((await deleteDealRoute(req(`/deals/${deal.id}`, keyReadOnly, { method: "DELETE" }), withId(deal.id))).status).toBe(403);
    expect((await deleteDealRoute(req(`/deals/${deal.id}`, keyA, { method: "DELETE" }), withId(deal.id))).status).toBe(204);
    expect((await getDealRoute(req(`/deals/${deal.id}`, keyA), withId(deal.id))).status).toBe(404);
  });

  it("validates input and refuses foreign pipelines, stages and records", async () => {
    const bad = await createDealRoute(req("/deals", keyA, { method: "POST", body: { title: "", pipelineId: "x" } }), noParams);
    expect(bad.status).toBe(422);
    const [PB] = await listPipelines(B.ownerCtx);
    const foreign = await createDealRoute(req("/deals", keyA, { method: "POST", body: { title: "Cross", pipelineId: PB.id, stageId: PB.stages[0].id } }), noParams);
    expect([404, 422]).toContain(foreign.status);
    const [mine] = (await (await createDealRoute(req("/deals", keyA, { method: "POST", body: { title: "Mine", pipelineId: P.id, stageId: P.stages[0].id } }), noParams)).json()).data
      ? [(await (await listDealsRoute(req("/deals?q=mine", keyA), noParams)).json()).data[0]]
      : [];
    expect((await getDealRoute(req(`/deals/${mine.id}`, keyB), withId(mine.id))).status).toBe(404);
    expect((await patchDealRoute(req(`/deals/${mine.id}`, keyB, { method: "PATCH", body: { title: "pwned" } }), withId(mine.id))).status).toBe(404);
    const listB = await (await listDealsRoute(req("/deals", keyB), noParams)).json();
    expect(listB.data.find((d: { id: string }) => d.id === mine.id)).toBeUndefined();
  });
});

describe("tasks", () => {
  it("creates with a due date, completes via PATCH, filters and deletes", async () => {
    const due = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const res = await createTaskRoute(req("/tasks", keyA, { method: "POST", body: { title: "API task", dueAt: due, priority: "high", assigneeId: A.agent.id } }), noParams);
    expect(res.status).toBe(201);
    const { data: task } = await res.json();
    expect(task).toMatchObject({ title: "API task", priority: "high", status: "open", assigneeId: A.agent.id, source: "api" });
    // Minute precision: the service stores wall-clock minutes in the tenant zone.
    expect(Math.abs(new Date(task.dueAt).getTime() - Date.parse(due))).toBeLessThan(60_000);

    const done = await patchTaskRoute(req(`/tasks/${task.id}`, keyA, { method: "PATCH", body: { status: "done" } }), withId(task.id));
    expect((await done.json()).data.status).toBe("done");
    const renamed = await patchTaskRoute(req(`/tasks/${task.id}`, keyA, { method: "PATCH", body: { title: "API task (renamed)" } }), withId(task.id));
    expect((await renamed.json()).data).toMatchObject({ title: "API task (renamed)", status: "done" });

    const list = await (await listTasksRoute(req(`/tasks?status=done&assigneeId=${A.agent.id}`, keyA), noParams)).json();
    expect(list.data.map((t: { id: string }) => t.id)).toContain(task.id);
    expect((await getTaskRoute(req(`/tasks/${task.id}`, keyB), withId(task.id))).status).toBe(404);
    expect((await createTaskRoute(req("/tasks", keyReadOnly, { method: "POST", body: { title: "nope" } }), noParams)).status).toBe(403);
    expect((await deleteTaskRoute(req(`/tasks/${task.id}`, keyA, { method: "DELETE" }), withId(task.id))).status).toBe(204);
  });

  it("refuses assigning to a user of another organization", async () => {
    const res = await createTaskRoute(req("/tasks", keyA, { method: "POST", body: { title: "Cross assign", assigneeId: B.agent.id } }), noParams);
    expect(res.status).toBe(422);
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { eq, sql } from "drizzle-orm";
import { closeDb, db, schema } from "@/server/db";
import { AppError } from "@/server/errors";
import { createApiKey, listApiKeys, revokeApiKey } from "@/modules/api/keys";
import { RATE_LIMIT_PER_MINUTE } from "@/modules/api/framework";
import { GET as listContactsRoute, POST as createContactRoute } from "@/app/api/v1/contacts/route";
import { DELETE as deleteContactRoute, GET as getContactRoute, PATCH as patchContactRoute } from "@/app/api/v1/contacts/[id]/route";
import { GET as listCompaniesRoute } from "@/app/api/v1/companies/route";
import { GET as meRoute } from "@/app/api/v1/me/route";
import { createTeam } from "../support/factories";

type Team = Awaited<ReturnType<typeof createTeam>>;
let A: Team;
let B: Team;
let keyA: string;
let keyB: string;

const BASE = "http://localhost:3000/api/v1";
const req = (path: string, key: string | null, init: { method?: string; body?: unknown } = {}) =>
  new NextRequest(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), ...(init.body ? { "content-type": "application/json" } : {}) },
    body: init.body === undefined ? undefined : typeof init.body === "string" ? init.body : JSON.stringify(init.body),
  });
const noParams = { params: Promise.resolve({}) } as never;
const withId = (id: string) => ({ params: Promise.resolve({ id }) }) as never;

beforeAll(async () => {
  A = await createTeam("API Tenant A");
  B = await createTeam("API Tenant B");
  keyA = (await createApiKey(A.ownerCtx, { name: "Zapier", scopes: ["contacts:read", "contacts:write", "companies:read"] })).key;
  keyB = (await createApiKey(B.ownerCtx, { name: "B key", scopes: ["contacts:read"] })).key;
  await db().insert(schema.companies).values({ tenantId: A.tenant.id, name: "Acme API" });
  await db().insert(schema.contacts).values({ tenantId: B.tenant.id, firstName: "SecretOfB" });
});
afterAll(async () => {
  await closeDb();
});

describe("API key management", () => {
  it("creates keys in the documented format and stores only a hash", async () => {
    expect(keyA).toMatch(/^sck_[a-z0-9]{8}_[A-Za-z0-9_-]{43}$/);
    const [row] = await db().select().from(schema.apiKeys).where(eq(schema.apiKeys.tenantId, A.tenant.id));
    expect(row.keyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(keyA.slice(13));
    expect(row.prefix).toBe(keyA.slice(0, 12));
  });

  it("only owners can manage keys", async () => {
    await expect(createApiKey(A.managerCtx, { name: "x", scopes: ["contacts:read"] })).rejects.toBeInstanceOf(AppError);
    await expect(listApiKeys(A.agentCtx)).rejects.toBeInstanceOf(AppError);
    const keys = await listApiKeys(A.ownerCtx);
    expect(keys.map((k) => k.name)).toEqual(["Zapier"]);
  });
});

describe("authentication", () => {
  it("rejects missing, malformed and unknown keys with 401", async () => {
    expect((await listContactsRoute(req("/contacts", null), noParams)).status).toBe(401);
    expect((await listContactsRoute(req("/contacts", "not-a-key"), noParams)).status).toBe(401);
    const forged = `sck_abcdefgh_${"x".repeat(43)}`;
    const res = await listContactsRoute(req("/contacts", forged), noParams);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: "UNAUTHENTICATED", message: "Invalid or revoked API key" } });
  });

  it("returns key info on /me and sets rate limit headers", async () => {
    const res = await meRoute(req("/me", keyA), noParams);
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ name: "Zapier", organizationId: A.tenant.id });
    expect(res.headers.get("x-ratelimit-limit")).toBe(String(RATE_LIMIT_PER_MINUTE));
    expect(Number(res.headers.get("x-ratelimit-remaining"))).toBeGreaterThan(0);
  });

  it("rejects revoked and expired keys", async () => {
    const created = await createApiKey(A.ownerCtx, { name: "temp", scopes: ["contacts:read"] });
    expect((await listContactsRoute(req("/contacts", created.key), noParams)).status).toBe(200);
    await revokeApiKey(A.ownerCtx, created.id);
    expect((await listContactsRoute(req("/contacts", created.key), noParams)).status).toBe(401);

    const expiring = await createApiKey(A.ownerCtx, { name: "expiring", scopes: ["contacts:read"], expiresInDays: 1 });
    await db().update(schema.apiKeys).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.apiKeys.id, expiring.id));
    const res = await listContactsRoute(req("/contacts", expiring.key), noParams);
    expect(res.status).toBe(401);
    expect((await res.json()).error.message).toBe("API key expired");
  });

  it("enforces scopes", async () => {
    const res = await createContactRoute(req("/contacts", keyB, { method: "POST", body: { firstName: "x" } }), noParams);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("FORBIDDEN");
    expect((await listCompaniesRoute(req("/companies", keyB), noParams)).status).toBe(403);
  });

  it("rejects keys of suspended organizations and plans without API access", async () => {
    const C = await createTeam("Suspended");
    const { key } = await createApiKey(C.ownerCtx, { name: "c", scopes: ["contacts:read"] });
    await db().update(schema.tenants).set({ status: "suspended" }).where(eq(schema.tenants.id, C.tenant.id));
    expect((await listContactsRoute(req("/contacts", key), noParams)).status).toBe(403);
    await db().update(schema.tenants).set({ status: "active" }).where(eq(schema.tenants.id, C.tenant.id));
    await db().update(schema.subscriptions).set({ planId: "free" }).where(eq(schema.subscriptions.tenantId, C.tenant.id));
    const res = await listContactsRoute(req("/contacts", key), noParams);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("PLAN_REQUIRED");
  });

  it("returns 429 when the per-key rate limit is exhausted", async () => {
    const { key, id } = await createApiKey(A.ownerCtx, { name: "burst", scopes: ["contacts:read"] });
    const windowStart = new Date(Math.floor(Date.now() / 60_000) * 60_000);
    await db().execute(sql`insert into public.rate_limit_counters (key, window_start, count)
      values (${`api:${id}`}, ${windowStart.toISOString()}::timestamptz, ${RATE_LIMIT_PER_MINUTE})`);
    const res = await listContactsRoute(req("/contacts", key), noParams);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).not.toBeNull();
    expect(res.headers.get("x-ratelimit-remaining")).toBe("0");
  });
});

describe("contacts resource", () => {
  it("creates, reads, patches, lists and deletes contacts", async () => {
    const created = await createContactRoute(
      req("/contacts", keyA, { method: "POST", body: { firstName: "דנה", lastName: "API", phone: "050-1234567", email: "DANA@API.TEST" } }),
      noParams,
    );
    expect(created.status).toBe(201);
    const { data } = await created.json();
    expect(data).toMatchObject({ firstName: "דנה", phone: "+972501234567", email: "dana@api.test", ownerId: null });

    const patched = await patchContactRoute(req(`/contacts/${data.id}`, keyA, { method: "PATCH", body: { lifecycleStage: "customer" } }), withId(data.id));
    expect(patched.status).toBe(200);
    expect((await patched.json()).data).toMatchObject({ lifecycleStage: "customer", lastName: "API", phone: "+972501234567" });

    const list = await listContactsRoute(req("/contacts?q=דנה&pageSize=10", keyA), noParams);
    const body = await list.json();
    expect(body.data.map((c: { id: string }) => c.id)).toContain(data.id);
    expect(body.pagination).toMatchObject({ page: 1, pageSize: 10 });

    const audit = await db().select().from(schema.auditLogs).where(eq(schema.auditLogs.entityId, data.id));
    expect(audit.every((a) => a.actorType === "api_key" && a.actorUserId === null)).toBe(true);
    expect(audit[0].metadata).toHaveProperty("apiKeyId");

    expect((await deleteContactRoute(req(`/contacts/${data.id}`, keyA, { method: "DELETE" }), withId(data.id))).status).toBe(204);
    expect((await getContactRoute(req(`/contacts/${data.id}`, keyA), withId(data.id))).status).toBe(404);

    const [{ n }] = await db().execute<{ n: number }>(sql`select count(*)::int as n from public.usage_events where tenant_id = ${A.tenant.id} and metric = 'api_calls'`);
    expect(n).toBeGreaterThanOrEqual(4);
  });

  it("returns 422 with details for invalid input and bad JSON", async () => {
    const bad = await createContactRoute(req("/contacts", keyA, { method: "POST", body: { firstName: "x", phone: "12" } }), noParams);
    expect(bad.status).toBe(422);
    const err = (await bad.json()).error;
    expect(err.code).toBe("VALIDATION");
    expect(err.details[0].path).toBe("phone");

    const notJson = await createContactRoute(req("/contacts", keyA, { method: "POST", body: "{nope" }), noParams);
    expect(notJson.status).toBe(422);

    const unknownField = await patchContactRoute(
      req(`/contacts/00000000-0000-4000-8000-000000000000`, keyA, { method: "PATCH", body: { isSuperAdmin: true } }),
      withId("00000000-0000-4000-8000-000000000000"),
    );
    expect(unknownField.status).toBe(422);
  });

  it("isolates tenants: a key never sees or touches another tenant's data", async () => {
    const [foreign] = await db().select().from(schema.contacts).where(eq(schema.contacts.tenantId, B.tenant.id));
    expect((await getContactRoute(req(`/contacts/${foreign.id}`, keyA), withId(foreign.id))).status).toBe(404);
    expect((await patchContactRoute(req(`/contacts/${foreign.id}`, keyA, { method: "PATCH", body: { firstName: "pwn" } }), withId(foreign.id))).status).toBe(404);
    expect((await deleteContactRoute(req(`/contacts/${foreign.id}`, keyA, { method: "DELETE" }), withId(foreign.id))).status).toBe(404);
    const list = await (await listContactsRoute(req("/contacts?q=SecretOfB", keyA), noParams)).json();
    expect(list.data).toEqual([]);
    const companies = await (await listCompaniesRoute(req("/companies", keyA), noParams)).json();
    expect(companies.data.map((c: { name: string }) => c.name)).toEqual(["Acme API"]);
    const [stillThere] = await db().select().from(schema.contacts).where(eq(schema.contacts.id, foreign.id));
    expect(stillThere.firstName).toBe("SecretOfB");
  });
});

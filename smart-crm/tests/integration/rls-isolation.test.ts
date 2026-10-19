/**
 * Tenant isolation at the database layer. These tests talk to Postgres as the
 * `crm_app` role (exactly like the app does) and prove that RLS alone — without
 * any application filtering — keeps tenants apart.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeDb, db, schema, withUserTx } from "@/server/db";
import { addMember, createTeam, createUser } from "../support/factories";

type Team = Awaited<ReturnType<typeof createTeam>>;
let A: Team;
let B: Team;

async function seedTenantData(team: Team) {
  const t = team.tenant.id;
  const [company] = await db().insert(schema.companies).values({ tenantId: t, name: "Acme" }).returning();
  const [contact] = await db()
    .insert(schema.contacts)
    .values({ tenantId: t, firstName: "Noa", phone: "+972501234567", companyId: company.id, ownerId: team.agent.id })
    .returning();
  const [pipeline] = await db().select().from(schema.pipelines).where(sql`tenant_id = ${t}`).limit(1);
  const [stage] = await db().select().from(schema.pipelineStages).where(sql`pipeline_id = ${pipeline.id}`).limit(1);
  const [deal] = await db()
    .insert(schema.deals)
    .values({ tenantId: t, pipelineId: pipeline.id, stageId: stage.id, title: "Deal", contactId: contact.id, valueCents: 100000 })
    .returning();
  await db().insert(schema.notes).values({ tenantId: t, body: "secret note", contactId: contact.id, authorId: team.owner.id });
  await db().insert(schema.tasks).values({ tenantId: t, title: "Call", contactId: contact.id, assigneeId: team.agent.id });
  const [tag] = await db().insert(schema.tags).values({ tenantId: t, name: "VIP" }).returning();
  await db().insert(schema.contactTags).values({ tenantId: t, contactId: contact.id, tagId: tag.id });
  const [wa] = await db()
    .insert(schema.whatsappAccounts)
    .values({ tenantId: t, provider: "mock", displayName: "WA", phoneNumber: "+972500000000", phoneNumberId: `pn_${t.slice(0, 8)}`, wabaId: "waba_1" })
    .returning();
  const [conv] = await db().insert(schema.conversations).values({ tenantId: t, whatsappAccountId: wa.id, contactId: contact.id }).returning();
  await db().insert(schema.messages).values({
    tenantId: t,
    conversationId: conv.id,
    direction: "inbound",
    type: "text",
    body: "hello",
    status: "received",
    senderType: "contact",
  });
  await db().insert(schema.activities).values({ tenantId: t, type: "note", contactId: contact.id, body: "x" });
  await db().insert(schema.auditLogs).values({ tenantId: t, actorType: "system", action: "test.seed" });
  await db().insert(schema.notifications).values({ tenantId: t, userId: team.owner.id, type: "test", title: "Hi" });
  return { company, contact, deal, conv };
}


/** Drizzle wraps driver errors ("Failed query: …"); assert on the Postgres cause. */
async function expectDbError(promise: Promise<unknown>, pattern: RegExp) {
  let error: unknown;
  try {
    await promise;
  } catch (e) {
    error = e;
  }
  expect(error, "expected the query to fail").toBeDefined();
  const cause = (error as { cause?: { message?: string } }).cause;
  expect(cause?.message ?? (error as Error).message).toMatch(pattern);
}

let dataA: Awaited<ReturnType<typeof seedTenantData>>;
let dataB: Awaited<ReturnType<typeof seedTenantData>>;

beforeAll(async () => {
  A = await createTeam("Tenant A");
  B = await createTeam("Tenant B");
  dataA = await seedTenantData(A);
  dataB = await seedTenantData(B);
});

afterAll(async () => {
  await closeDb();
});

async function tenantTables(): Promise<string[]> {
  const rows = await db().execute<{ table_name: string }>(sql`
    select c.table_name from information_schema.columns c
    join information_schema.tables t on t.table_name = c.table_name and t.table_schema = c.table_schema and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name = 'tenant_id' order by 1`);
  return rows.map((r) => r.table_name);
}

describe("RLS coverage", () => {
  it("enables row level security on every public table", async () => {
    const rows = await db().execute<{ tablename: string }>(
      sql`select tablename from pg_tables where schemaname = 'public' and not rowsecurity`,
    );
    expect(rows.map((r) => r.tablename)).toEqual([]);
  });

  it("exposes nothing to anon and only realtime reads to authenticated", async () => {
    const rows = await db().execute<{ grantee: string; table_name: string; privilege_type: string }>(sql`
      select grantee, table_name, privilege_type from information_schema.role_table_grants
      where table_schema = 'public' and grantee in ('anon', 'authenticated') order by 1, 2`);
    expect(rows.map((r) => `${r.grantee}:${r.table_name}:${r.privilege_type}`)).toEqual([
      "authenticated:conversations:SELECT",
      "authenticated:messages:SELECT",
      "authenticated:notifications:SELECT",
    ]);
  });
});

describe("cross-tenant reads", () => {
  it("a member of tenant A sees zero rows of tenant B in every tenant table", async () => {
    const tables = await tenantTables();
    expect(tables.length).toBeGreaterThan(40);
    const leaks: string[] = [];
    await withUserTx(A.owner.id, async (tx) => {
      for (const table of tables) {
        // Some tables are system-only (no SELECT grant at all) — that is isolation too.
        const [{ granted }] = await tx.execute<{ granted: boolean }>(
          sql`select has_table_privilege('crm_app', ${`public.${table}`}, 'SELECT') as granted`,
        );
        if (!granted) continue;
        const [{ n }] = await tx.execute<{ n: number }>(
          sql`select count(*)::int as n from ${sql.identifier(table)} where tenant_id = ${B.tenant.id}`,
        );
        if (n > 0) leaks.push(`${table}:${n}`);
      }
    });
    expect(leaks).toEqual([]);
  });

  it("the same member does see their own tenant's data", async () => {
    await withUserTx(A.agent.id, async (tx) => {
      const contacts = await tx.select().from(schema.contacts);
      expect(contacts.map((c) => c.id)).toEqual([dataA.contact.id]);
      const messages = await tx.select().from(schema.messages);
      expect(messages).toHaveLength(1);
    });
  });

  it("an outsider with no membership sees nothing", async () => {
    const outsider = await createUser();
    await withUserTx(outsider.id, async (tx) => {
      expect(await tx.select().from(schema.contacts)).toEqual([]);
      expect(await tx.select().from(schema.tenants)).toEqual([]);
      expect(await tx.select().from(schema.memberships)).toEqual([]);
    });
  });

  it("only exposes profiles of users who share a tenant", async () => {
    await withUserTx(A.owner.id, async (tx) => {
      const ids = (await tx.select({ id: schema.profiles.id }).from(schema.profiles)).map((p) => p.id).sort();
      expect(ids).toEqual([A.owner.id, A.manager.id, A.agent.id].sort());
    });
  });
});

describe("cross-tenant writes", () => {
  it("cannot insert rows into another tenant", async () => {
    await expectDbError(
      withUserTx(A.owner.id, (tx) => tx.insert(schema.contacts).values({ tenantId: B.tenant.id, firstName: "Mallory" })),
      /row-level security/,
    );
  });

  it("cannot update or delete another tenant's rows (silently affects nothing)", async () => {
    await withUserTx(A.owner.id, async (tx) => {
      const updated = await tx
        .update(schema.contacts)
        .set({ firstName: "Hacked" })
        .where(sql`id = ${dataB.contact.id}`)
        .returning();
      expect(updated).toEqual([]);
      const deleted = await tx.delete(schema.deals).where(sql`id = ${dataB.deal.id}`).returning();
      expect(deleted).toEqual([]);
    });
    const [still] = await db().select().from(schema.contacts).where(sql`id = ${dataB.contact.id}`);
    expect(still.firstName).toBe("Noa");
  });

  it("cannot move a row into another tenant", async () => {
    await expectDbError(
      withUserTx(A.owner.id, (tx) =>
        tx.update(schema.contacts).set({ tenantId: B.tenant.id }).where(sql`id = ${dataA.contact.id}`),
      ),
      /row-level security|foreign key/,
    );
  });

  it("composite foreign keys block references to another tenant's records", async () => {
    // Even the system context (RLS bypassed) cannot link A's deal to B's contact.
    await expectDbError(
      db().update(schema.deals).set({ contactId: dataB.contact.id }).where(sql`id = ${dataA.deal.id}`),
      /foreign key/,
    );
    // Assignees must be members of the same tenant.
    await expectDbError(
      db().update(schema.contacts).set({ ownerId: B.owner.id }).where(sql`id = ${dataA.contact.id}`),
      /foreign key/,
    );
  });

  it("cannot forge audit entries for another user", async () => {
    await expectDbError(
      withUserTx(A.agent.id, (tx) =>
        tx.insert(schema.auditLogs).values({ tenantId: A.tenant.id, actorUserId: A.owner.id, actorType: "user", action: "forged.entry" }),
      ),
      /row-level security/,
    );
  });
});

describe("role-restricted tables", () => {
  it("agents cannot change pipelines, but managers can", async () => {
    const [stage] = await db().select().from(schema.pipelineStages).where(sql`tenant_id = ${A.tenant.id}`).limit(1);
    const agentUpdate = await withUserTx(A.agent.id, (tx) =>
      tx.update(schema.pipelineStages).set({ name: "Renamed" }).where(sql`id = ${stage.id}`).returning(),
    );
    expect(agentUpdate).toEqual([]);
    const managerUpdate = await withUserTx(A.manager.id, (tx) =>
      tx.update(schema.pipelineStages).set({ name: "Renamed" }).where(sql`id = ${stage.id}`).returning(),
    );
    expect(managerUpdate).toHaveLength(1);
  });

  it("only owners and managers can read the audit log", async () => {
    const agentRows = await withUserTx(A.agent.id, (tx) => tx.select().from(schema.auditLogs));
    expect(agentRows).toEqual([]);
    const ownerRows = await withUserTx(A.owner.id, (tx) => tx.select().from(schema.auditLogs));
    expect(ownerRows.length).toBeGreaterThan(0);
    expect(ownerRows.every((r) => r.tenantId === A.tenant.id)).toBe(true);
  });

  it("users cannot escalate to super admin via their profile", async () => {
    await expectDbError(
      withUserTx(A.agent.id, (tx) => tx.execute(sql`update public.profiles set is_super_admin = true where id = ${A.agent.id}`)),
      /permission denied/,
    );
  });

  it("agents cannot change memberships; the last owner cannot be removed", async () => {
    const res = await withUserTx(A.agent.id, (tx) =>
      tx.update(schema.memberships).set({ role: "owner" }).where(sql`user_id = ${A.agent.id}`).returning(),
    );
    expect(res).toEqual([]);
    await expectDbError(
      withUserTx(A.owner.id, (tx) => tx.delete(schema.memberships).where(sql`user_id = ${A.owner.id} and tenant_id = ${A.tenant.id}`)),
      /at least one active owner/,
    );
  });

  it("secrets, jobs payloads and webhook stores are not readable by app users", async () => {
    for (const table of ["secrets", "webhook_events", "email_outbox", "rate_limit_counters", "tenant_counters", "support_sessions"]) {
      await expectDbError(
        withUserTx(A.owner.id, (tx) => tx.execute(sql`select * from ${sql.identifier(table)} limit 1`)),
        /permission denied/,
      );
    }
  });
});

describe("support mode", () => {
  it("grants a super admin read-only access to one tenant while a session is active", async () => {
    const admin = await createUser({ superAdmin: true });
    await withUserTx(admin.id, async (tx) => {
      expect(await tx.select().from(schema.contacts)).toEqual([]);
    });
    await db().insert(schema.supportSessions).values({
      adminUserId: admin.id,
      tenantId: B.tenant.id,
      reason: "Customer asked for help importing contacts",
      expiresAt: new Date(Date.now() + 3600_000),
    });
    await withUserTx(admin.id, async (tx) => {
      const rows = await tx.select().from(schema.contacts);
      expect(rows.map((r) => r.tenantId)).toEqual([B.tenant.id]);
    });
    await expectDbError(
      withUserTx(admin.id, (tx) => tx.insert(schema.contacts).values({ tenantId: B.tenant.id, firstName: "Nope" })),
      /row-level security/,
    );
  });

  it("does not apply to non-admin users even with a support session row", async () => {
    const user = await createUser();
    await addMember(A.tenant.id, user.id, "agent");
    await db().insert(schema.supportSessions).values({
      adminUserId: user.id,
      tenantId: B.tenant.id,
      reason: "Attempting to read tenant B data",
      expiresAt: new Date(Date.now() + 3600_000),
    });
    await withUserTx(user.id, async (tx) => {
      const rows = await tx.select().from(schema.contacts);
      expect(rows.every((r) => r.tenantId === A.tenant.id)).toBe(true);
    });
  });
});

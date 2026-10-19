import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { closeDb, db, schema, withUserTx } from "@/server/db";
import { AppError } from "@/server/errors";
import { systemCtx } from "@/server/context";
import { drainJobs, runJob, type Job } from "@/server/jobs/runner";
import { assertSafeStorageKey, storage, storageKey } from "@/server/storage";
import "@/server/jobs/registry";
import { __setProviderFactoryForTests, connectAccount, type AccountView } from "@/modules/whatsapp/accounts";
import { MockWhatsAppProvider } from "@/modules/whatsapp/mock-provider";
import { ingestWhatsAppWebhook } from "@/modules/whatsapp/webhook";
import { buildInboundPayload } from "@/modules/whatsapp/simulator";
import { metaSignature } from "@/modules/whatsapp/signature";
import { clientOutboundSchema, sendMessage } from "@/modules/inbox/service";
import { eraseContact } from "@/modules/privacy/service";
import { notify } from "@/modules/notifications/service";
import { createWorkflow, publishWorkflow, saveDraft } from "@/modules/automation/service";
import { startManualRun } from "@/modules/automation/engine";
import { createTeam, createUser } from "../support/factories";

/** Regression tests for the internal security review (tenant isolation + attack surface). */

type Team = Awaited<ReturnType<typeof createTeam>>;
let A: Team;
let B: Team;
let accA: AccountView;
const pnid = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function expectAppError(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code);
}
async function expectDbError(p: Promise<unknown>, pattern: RegExp) {
  let error: unknown;
  try {
    await p;
  } catch (e) {
    error = e;
  }
  expect(error, "expected the query to fail").toBeDefined();
  const cause = (error as { cause?: { message?: string } }).cause;
  expect(cause?.message ?? (error as Error).message).toMatch(pattern);
}
async function inbound(acc: AccountView, fromPhone: string, text: string, entryId?: string) {
  const payload = buildInboundPayload(acc, { fromPhone, name: "לקוח", text });
  if (entryId) payload.entry![0].id = entryId;
  const raw = JSON.stringify(payload);
  await ingestWhatsAppWebhook(raw, metaSignature(raw, process.env.META_APP_SECRET!));
  await drainJobs({ workerId: "sec", types: ["whatsapp.process_webhook", "events.dispatch"] });
}

beforeAll(async () => {
  A = await createTeam("Sec A");
  B = await createTeam("Sec B");
  accA = await connectAccount(A.ownerCtx, { provider: "mock", displayName: "A", phoneNumber: "+972500000101", phoneNumberId: pnid("pnSA"), wabaId: "waba_sec_a", sendRatePerMinute: 60 });
});
afterEach(() => __setProviderFactoryForTests(null));
afterAll(async () => {
  await closeDb();
});

describe("storage keys (H1)", () => {
  it("browsers cannot send media messages with their own storage key", () => {
    expect(clientOutboundSchema.safeParse({ kind: "media", storageKey: "x", mimeType: "image/png", fileName: "a.png", sizeBytes: 1 }).success).toBe(false);
    expect(clientOutboundSchema.safeParse({ kind: "text", text: "hi" }).success).toBe(true);
  });

  it("the storage layer refuses traversal and malformed keys", async () => {
    const good = storageKey(A.tenant.id, "whatsapp-out", "חשבון.pdf");
    expect(() => assertSafeStorageKey(good)).not.toThrow();
    for (const bad of [
      `${A.tenant.id}/../${B.tenant.id}/whatsapp/x/f.pdf`,
      `${A.tenant.id}/a/../../etc/passwd`,
      `/${A.tenant.id}/a/b`,
      `${A.tenant.id}//b/c`,
      `${A.tenant.id}/a\\b/c`,
      `${A.tenant.id}/a/%2e%2e/c`,
      `not-a-tenant/a/b`,
    ]) {
      expect(() => assertSafeStorageKey(bad), bad).toThrow();
      await expect(storage().get(bad)).rejects.toBeDefined();
    }
  });

  it("sendMessage rejects media keys outside the tenant's outbound area", async () => {
    await inbound(accA, "+972541110001", "שלום");
    const [conv] = await db().select().from(schema.conversations).where(eq(schema.conversations.tenantId, A.tenant.id)).limit(1);
    for (const key of [`${A.tenant.id}/../${B.tenant.id}/whatsapp/00000000-0000-0000-0000-000000000000/f.pdf`, `${B.tenant.id}/whatsapp-out/00000000-0000-0000-0000-000000000000/f.pdf`, `${A.tenant.id}/attachments/contact/00000000-0000-0000-0000-000000000000/f.pdf`]) {
      await expectAppError(sendMessage(A.ownerCtx, conv.id, { kind: "media", storageKey: key, mimeType: "application/pdf", fileName: "f.pdf", sizeBytes: 10 }), "FORBIDDEN");
    }
  });
});

describe("WhatsApp number ownership (H2)", () => {
  it("connecting a Meta number requires the token to control it", async () => {
    __setProviderFactoryForTests(() => Object.assign(new MockWhatsAppProvider(), { verifyOwnership: async () => ({ ok: false as const, reason: "not in waba" }) }));
    const id = pnid("pnVictim");
    await expectAppError(
      connectAccount(B.ownerCtx, { provider: "meta", displayName: "stolen", phoneNumber: "+972500000102", phoneNumberId: id, wabaId: "waba_victim", accessToken: "EAAGfaketokenvalue1234567890", sendRatePerMinute: 60 }),
      "VALIDATION",
    );
    expect(await db().select().from(schema.whatsappAccounts).where(eq(schema.whatsappAccounts.phoneNumberId, id))).toHaveLength(0);
  });

  it("inbound events from a different WABA or for a disabled account are ignored", async () => {
    const phone = "+972541110002";
    await inbound(accA, phone, "from another waba", "waba_attacker");
    const [c1] = await db().select().from(schema.contacts).where(and(eq(schema.contacts.tenantId, A.tenant.id), eq(schema.contacts.phone, phone)));
    expect(c1).toBeUndefined();
    await db().update(schema.whatsappAccounts).set({ status: "disabled" }).where(eq(schema.whatsappAccounts.id, accA.id));
    await inbound(accA, phone, "to a disabled account");
    const [c2] = await db().select().from(schema.contacts).where(and(eq(schema.contacts.tenantId, A.tenant.id), eq(schema.contacts.phone, phone)));
    expect(c2).toBeUndefined();
    await db().update(schema.whatsappAccounts).set({ status: "active" }).where(eq(schema.whatsappAccounts.id, accA.id));
  });
});

describe("privacy erasure removes WhatsApp media (M1)", () => {
  it("deletes stored media files of the erased contact", async () => {
    const phone = "+972541110003";
    await inbound(accA, phone, "תמונה");
    const [contact] = await db().select().from(schema.contacts).where(and(eq(schema.contacts.tenantId, A.tenant.id), eq(schema.contacts.phone, phone)));
    const [msg] = await db()
      .select({ id: schema.messages.id })
      .from(schema.messages)
      .innerJoin(schema.conversations, eq(schema.conversations.id, schema.messages.conversationId))
      .where(eq(schema.conversations.contactId, contact.id));
    const key = storageKey(A.tenant.id, "whatsapp", "photo.png");
    await storage().put(key, Buffer.from("png"), "image/png");
    await db().update(schema.messages).set({ media: { storageKey: key, mimeType: "image/png", fileName: "photo.png" } }).where(eq(schema.messages.id, msg.id));
    await eraseContact(A.ownerCtx, contact.id, [contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.phone!);
    await expect(storage().get(key)).rejects.toBeDefined();
  });
});

describe("database-enforced role hierarchy (M2)", () => {
  it("a manager cannot promote themselves or touch other managers/owners, even with direct SQL", async () => {
    await expectDbError(
      withUserTx(A.manager.id, (tx) => tx.execute(sql`update public.memberships set role = 'owner' where tenant_id = ${A.tenant.id} and user_id = ${A.manager.id}`)),
      /only owners/,
    );
    await expectDbError(
      withUserTx(A.manager.id, (tx) => tx.execute(sql`update public.memberships set role = 'manager' where tenant_id = ${A.tenant.id} and user_id = ${A.agent.id}`)),
      /only owners/,
    );
    const outsider = await createUser({ fullName: "Outsider" });
    await expectDbError(
      withUserTx(A.manager.id, (tx) => tx.execute(sql`update public.memberships set user_id = ${outsider.id} where tenant_id = ${A.tenant.id} and user_id = ${A.agent.id}`)),
      /permission denied/,
    );
    await expectDbError(
      withUserTx(A.manager.id, (tx) => tx.execute(sql`delete from public.memberships where tenant_id = ${A.tenant.id} and user_id = ${A.owner.id}`)),
      /only owners/,
    );
    await expectDbError(
      withUserTx(A.manager.id, (tx) =>
        tx.execute(sql`insert into public.invitations (tenant_id, email, role, token_hash, invited_by, expires_at)
          values (${A.tenant.id}, 'x@example.test', 'owner', ${"a".repeat(64)}, ${A.manager.id}, now() + interval '1 day')`),
      ),
      /row-level security/,
    );
    // Owners keep full control.
    await withUserTx(A.owner.id, (tx) => tx.execute(sql`update public.memberships set status = 'active' where tenant_id = ${A.tenant.id} and user_id = ${A.manager.id}`));
  });
});

describe("job queue binding (M3)", () => {
  it("user transactions cannot squat scheduler keys or enqueue for another tenant", async () => {
    await expectDbError(
      withUserTx(A.agent.id, (tx) =>
        tx.execute(sql`insert into public.jobs (tenant_id, type, payload, idempotency_key) values (${A.tenant.id}, 'events.dispatch', '{}'::jsonb, 'sched:billing.lifecycle:999999')`),
      ),
      /row-level security/,
    );
    await expectDbError(
      withUserTx(A.agent.id, (tx) =>
        tx.execute(sql`insert into public.jobs (tenant_id, type, payload) values (${A.tenant.id}, 'events.dispatch', ${JSON.stringify({ tenantId: B.tenant.id, type: "contact.created" })}::text::jsonb)`),
      ),
      /row-level security/,
    );
    const visible = await withUserTx(A.agent.id, (tx) => tx.execute<{ n: number }>(sql`select count(*)::int as n from public.jobs where tenant_id = ${B.tenant.id}`));
    expect(visible[0].n).toBe(0);
  });

  it("the runner refuses a payload whose tenant differs from the job's", async () => {
    const job = { id: 0, tenantId: A.tenant.id, type: "events.dispatch", payload: { tenantId: B.tenant.id, type: "contact.created" }, attempts: 1, maxAttempts: 1 } as unknown as Job;
    const [row] = await db()
      .insert(schema.jobs)
      .values({ tenantId: A.tenant.id, type: "events.dispatch", payload: job.payload as Record<string, unknown>, status: "running", attempts: 1, maxAttempts: 1 })
      .returning({ id: schema.jobs.id });
    expect(await runJob({ ...job, id: Number(row.id) })).toBe("dead");
  });
});

describe("tighter per-table rules (L1, L3, L4)", () => {
  it("notifications only reach active members of the tenant", async () => {
    const outsider = await createUser({ fullName: "Not a member" });
    await notify(db(), { tenantId: A.tenant.id, userId: outsider.id, type: "mention", title: "hi" });
    expect(await db().select().from(schema.notifications).where(eq(schema.notifications.userId, outsider.id))).toHaveLength(0);
  });

  it("publishing refuses references to another tenant's users, tags or stages", async () => {
    const [foreignTag] = await db().insert(schema.tags).values({ tenantId: B.tenant.id, name: "B-only" }).returning();
    for (const params of [{ tagId: foreignTag.id }, { target: "user", userId: B.owner.id, title: "x", body: "" }]) {
      const wf = await createWorkflow(A.ownerCtx, { name: "foreign ref" });
      const action = "tagId" in params ? "add_tag" : "notify_user";
      await saveDraft(A.ownerCtx, wf.id, {
        definition: {
          nodes: [
            { id: "t", type: "trigger", config: { kind: "manual" }, position: { x: 0, y: 0 } },
            { id: "a", type: "action", config: { action, params }, position: { x: 0, y: 1 } },
          ],
          edges: [{ id: "e", source: "t", target: "a" }],
        },
      });
      await expectAppError(publishWorkflow(A.ownerCtx, wf.id), "VALIDATION");
    }
  });

  it("agents cannot rename/delete tags or forge executed AI proposals at the database", async () => {
    const [tag] = await db().insert(schema.tags).values({ tenantId: A.tenant.id, name: "keep" }).returning();
    const deleted = await withUserTx(A.agent.id, (tx) => tx.execute(sql`delete from public.tags where id = ${tag.id} returning id`));
    expect(deleted).toHaveLength(0);
    await expectDbError(
      withUserTx(A.agent.id, (tx) =>
        tx.execute(sql`insert into public.ai_action_proposals (tenant_id, requested_by, action_type, payload, status)
          values (${A.tenant.id}, ${A.agent.id}, 'add_note', '{}'::jsonb, 'executed')`),
      ),
      /row-level security/,
    );
  });

  it("suspended organizations do not start automation runs", async () => {
    const wf = await createWorkflow(A.ownerCtx, { name: "suspended" });
    await saveDraft(A.ownerCtx, wf.id, {
      definition: {
        nodes: [
          { id: "t", type: "trigger", config: { kind: "manual" }, position: { x: 0, y: 0 } },
          { id: "a", type: "action", config: { action: "add_note", params: { body: "x" } }, position: { x: 0, y: 1 } },
        ],
        edges: [{ id: "e", source: "t", target: "a" }],
      },
    });
    await publishWorkflow(A.ownerCtx, wf.id);
    const [c] = await db().insert(schema.contacts).values({ tenantId: A.tenant.id, firstName: "S" }).returning();
    const [row] = await db().select().from(schema.automationWorkflows).where(eq(schema.automationWorkflows.id, wf.id));
    await db().update(schema.tenants).set({ status: "suspended" }).where(eq(schema.tenants.id, A.tenant.id));
    try {
      expect(await startManualRun(row, c.id)).toBeNull();
    } finally {
      await db().update(schema.tenants).set({ status: "active" }).where(eq(schema.tenants.id, A.tenant.id));
    }
  });
});

describe("tenant time zones", () => {
  it("the database refuses an invalid zone, so tenant-wide jobs cannot be broken by one org", async () => {
    await expectDbError(db().update(schema.tenants).set({ timezone: "Not/AZone" }).where(eq(schema.tenants.id, A.tenant.id)), /invalid time zone/);
    await db().update(schema.tenants).set({ timezone: "Europe/London" }).where(eq(schema.tenants.id, A.tenant.id));
    await db().update(schema.tenants).set({ timezone: "Asia/Jerusalem" }).where(eq(schema.tenants.id, A.tenant.id));
  });
});

void systemCtx;

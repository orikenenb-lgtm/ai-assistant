import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { closeDb, db, schema } from "@/server/db";
import { AppError } from "@/server/errors";
import { storage } from "@/server/storage";
import { drainJobs } from "@/server/jobs/runner";
import "@/modules/privacy/jobs";
import { contactInputSchema } from "@/modules/crm/schemas";
import { createContact } from "@/modules/crm/contacts/service";
import { uploadAttachment } from "@/modules/crm/attachments";
import { addNote } from "@/modules/crm/activities";
import {
  applyRetention,
  eraseContact,
  exportDownloadUrl,
  listDataRequests,
  purgeDeletedTenants,
  requestContactExport,
  requestTenantDeletion,
  requestTenantExport,
  restoreTenant,
} from "@/modules/privacy/service";
import { createTeam } from "../support/factories";

type Team = Awaited<ReturnType<typeof createTeam>>;
let T: Team;

async function exists(key: string) {
  return storage()
    .get(key)
    .then(() => true)
    .catch(() => false);
}

beforeAll(async () => {
  T = await createTeam("Privacy Co");
});
afterAll(async () => {
  await closeDb();
});

describe("contact export", () => {
  it("builds a JSON bundle in the background and serves it via a signed link", async () => {
    const c = await createContact(T.ownerCtx, contactInputSchema.parse({ firstName: "Export", lastName: "Me", email: "export@x.test" }));
    await addNote(T.ownerCtx, "contact", c.id, "note to export");
    await requestContactExport(T.ownerCtx, c.id);
    await drainJobs({ workerId: "privacy-test", types: ["privacy.export"] });
    const [req] = await listDataRequests(T.ownerCtx);
    expect(req).toMatchObject({ type: "export", subjectType: "contact", status: "completed", downloadable: true });
    const { url } = await exportDownloadUrl(T.ownerCtx, req.id);
    expect(url).toMatch(/^\/api\/files\/raw\?token=/);
    const [row] = await db().select().from(schema.dataRequests).where(eq(schema.dataRequests.id, req.id));
    const bundle = JSON.parse((await storage().get(row.fileStorageKey!)).toString("utf8"));
    expect(bundle.contact.email).toBe("export@x.test");
    expect(bundle.notes.map((n: { body: string }) => n.body)).toContain("note to export");
  });

  it("is owner-only", async () => {
    const c = await createContact(T.ownerCtx, contactInputSchema.parse({ firstName: "Nope" }));
    await expect(requestContactExport(T.managerCtx, c.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(requestContactExport(T.agentCtx, c.id)).rejects.toBeInstanceOf(AppError);
  });

  it("exports the whole tenant without secrets", async () => {
    await requestTenantExport(T.ownerCtx);
    await drainJobs({ workerId: "privacy-test", types: ["privacy.export"] });
    const reqs = await listDataRequests(T.ownerCtx);
    const tenantReq = reqs.find((r) => r.subjectType === "tenant")!;
    expect(tenantReq.status).toBe("completed");
    const [row] = await db().select().from(schema.dataRequests).where(eq(schema.dataRequests.id, tenantReq.id));
    const bundle = JSON.parse((await storage().get(row.fileStorageKey!)).toString("utf8"));
    expect(bundle.tables.contacts.length).toBeGreaterThanOrEqual(2);
    expect(Object.keys(bundle.tables)).not.toContain("secrets");
    expect(Object.keys(bundle.tables)).not.toContain("api_keys");
  });
});

describe("contact erasure", () => {
  it("requires the exact name, then removes rows, files and audit PII", async () => {
    const c = await createContact(T.ownerCtx, contactInputSchema.parse({ firstName: "מחק", lastName: "אותי", phone: "0501239999" }));
    await addNote(T.ownerCtx, "contact", c.id, "private note");
    const file = await uploadAttachment(T.ownerCtx, "contact", c.id, { name: "id.pdf", type: "application/pdf", bytes: Buffer.from("%PDF-1.4 secret") });
    expect(await exists(file.storageKey)).toBe(true);

    await expect(eraseContact(T.ownerCtx, c.id, "wrong")).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(eraseContact(T.managerCtx, c.id, "מחק אותי")).rejects.toMatchObject({ code: "FORBIDDEN" });

    const result = await eraseContact(T.ownerCtx, c.id, "מחק אותי");
    expect(result.filesDeleted).toBe(1);
    expect(await db().select().from(schema.contacts).where(eq(schema.contacts.id, c.id))).toEqual([]);
    expect(await db().select().from(schema.notes).where(eq(schema.notes.contactId, c.id))).toEqual([]);
    expect(await db().select().from(schema.attachments).where(eq(schema.attachments.id, file.id))).toEqual([]);
    expect(await exists(file.storageKey)).toBe(false);
    const audits = await db().select().from(schema.auditLogs).where(eq(schema.auditLogs.entityId, c.id));
    expect(audits.some((a) => a.action === "privacy.contact_erased")).toBe(true);
    for (const a of audits.filter((x) => x.action !== "privacy.contact_erased")) expect(a.metadata).toEqual({ redacted: true });
  });
});

describe("tenant deletion", () => {
  it("schedules deletion with typed confirmation, can be restored, then is purged with its files", async () => {
    const D = await createTeam("Delete Me Ltd");
    const c = await createContact(D.ownerCtx, contactInputSchema.parse({ firstName: "Gone" }));
    const file = await uploadAttachment(D.ownerCtx, "contact", c.id, { name: "a.pdf", type: "application/pdf", bytes: Buffer.from("%PDF-1.4 x") });

    await expect(requestTenantDeletion(D.ownerCtx, "delete me ltd")).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(requestTenantDeletion(D.managerCtx, "Delete Me Ltd")).rejects.toMatchObject({ code: "FORBIDDEN" });
    const { purgeAfter } = await requestTenantDeletion(D.ownerCtx, "Delete Me Ltd");
    expect(purgeAfter.getTime()).toBeGreaterThan(Date.now() + 29 * 86400_000);

    // Members lose access immediately (deleted tenants are not readable).
    expect(await D.ownerCtx.run((tx) => tx.select().from(schema.contacts))).toEqual([]);
    const notes = await db().select().from(schema.notifications).where(eq(schema.notifications.tenantId, D.tenant.id));
    expect(notes.some((n) => n.type === "tenant_deletion" && n.userId === D.owner.id)).toBe(true);

    // Nothing is purged before the grace period ends; an admin can restore.
    expect(await purgeDeletedTenants(new Date())).toBe(0);
    await restoreTenant(D.tenant.id, D.owner.id);
    expect((await D.ownerCtx.run((tx) => tx.select().from(schema.contacts))).length).toBe(1);

    await requestTenantDeletion(D.ownerCtx, "Delete Me Ltd");
    const purged = await purgeDeletedTenants(new Date(Date.now() + 31 * 86400_000));
    expect(purged).toBe(1);
    expect(await db().select().from(schema.tenants).where(eq(schema.tenants.id, D.tenant.id))).toEqual([]);
    expect(await exists(file.storageKey)).toBe(false);
    const [platformAudit] = await db().execute<{ n: number }>(sql`select count(*)::int as n from public.audit_logs where action = 'privacy.tenant_purged' and entity_id = ${D.tenant.id}`);
    expect(platformAudit.n).toBe(1);
  });
});

describe("retention", () => {
  it("deletes messages and AI logs older than each tenant's setting", async () => {
    const R = await createTeam("Retention Co");
    await db()
      .update(schema.tenants)
      .set({ settings: { retention: { messagesDays: 30, aiLogsDays: 60 } } })
      .where(eq(schema.tenants.id, R.tenant.id));
    const [contact] = await db().insert(schema.contacts).values({ tenantId: R.tenant.id, firstName: "R", phone: "+972500000001" }).returning();
    const [wa] = await db()
      .insert(schema.whatsappAccounts)
      .values({ tenantId: R.tenant.id, provider: "mock", displayName: "WA", phoneNumber: "+972500000002", phoneNumberId: `pn_ret_${Date.now()}`, wabaId: "waba_ret" })
      .returning();
    const [conv] = await db().insert(schema.conversations).values({ tenantId: R.tenant.id, whatsappAccountId: wa.id, contactId: contact.id }).returning();
    const old = new Date(Date.now() - 45 * 86400_000);
    await db().insert(schema.messages).values([
      { tenantId: R.tenant.id, conversationId: conv.id, direction: "inbound", type: "text", body: "old", status: "received", senderType: "contact", createdAt: old },
      { tenantId: R.tenant.id, conversationId: conv.id, direction: "inbound", type: "text", body: "new", status: "received", senderType: "contact" },
    ]);
    await db().insert(schema.aiInteractions).values([
      { tenantId: R.tenant.id, feature: "summarize", provider: "mock", model: "mock", status: "ok", createdAt: old },
      { tenantId: R.tenant.id, feature: "summarize", provider: "mock", model: "mock", status: "ok", createdAt: new Date(Date.now() - 90 * 86400_000) },
    ]);
    // A tenant without settings keeps everything.
    const [otherOld] = await db()
      .insert(schema.aiInteractions)
      .values({ tenantId: T.tenant.id, feature: "summarize", provider: "mock", model: "mock", status: "ok", createdAt: new Date(Date.now() - 900 * 86400_000) })
      .returning();

    await applyRetention();
    const bodies = (await db().select().from(schema.messages).where(eq(schema.messages.conversationId, conv.id))).map((m) => m.body);
    expect(bodies).toEqual(["new"]);
    const ai = await db().select().from(schema.aiInteractions).where(eq(schema.aiInteractions.tenantId, R.tenant.id));
    expect(ai).toHaveLength(1);
    expect(await db().select().from(schema.aiInteractions).where(eq(schema.aiInteractions.id, otherOld.id))).toHaveLength(1);
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { closeDb, db, schema } from "@/server/db";
import { contactInputSchema, listQuerySchema } from "@/modules/crm/schemas";
import {
  createContact,
  deleteContact,
  findDuplicateCandidates,
  getContact,
  listContacts,
  listDuplicateGroups,
  mergeContacts,
  setWhatsappConsent,
  updateContact,
} from "@/modules/crm/contacts/service";
import { exportContactsCsv, importContacts } from "@/modules/crm/contacts/import-export";
import { createCustomField } from "@/modules/crm/custom-fields";
import { createTag } from "@/modules/crm/tags";
import { addNote, listNotes, listTimeline, deleteNote } from "@/modules/crm/activities";
import { AppError } from "@/server/errors";
import { createTeam } from "../support/factories";

type Team = Awaited<ReturnType<typeof createTeam>>;
let T: Team;
let Other: Team;

const input = (v: Record<string, unknown>) => contactInputSchema.parse(v);
const q = (v: Record<string, unknown> = {}) => listQuerySchema.parse(v);

async function expectAppError(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code);
}

beforeAll(async () => {
  T = await createTeam("Contacts Co");
  Other = await createTeam("Other Co");
});
afterAll(async () => {
  await closeDb();
});

describe("contact input schema", () => {
  it("normalizes Israeli phone numbers to E.164 and emails to lowercase", () => {
    const v = input({ firstName: " דנה ", phone: "050-123-4567", email: "Dana@Example.COM" });
    expect(v).toMatchObject({ firstName: "דנה", phone: "+972501234567", email: "dana@example.com" });
  });
  it("rejects invalid phones and empty contacts", () => {
    expect(contactInputSchema.safeParse({ firstName: "x", phone: "12" }).success).toBe(false);
    expect(contactInputSchema.safeParse({}).success).toBe(false);
  });
});

describe("contacts service", () => {
  it("creates, reads, updates and lists contacts with Hebrew search", async () => {
    const c = await createContact(T.agentCtx, input({ firstName: "יוסי", lastName: "כהן", phone: "0521111111", email: "yossi@kerem.test" }));
    expect(c.ownerId).toBe(T.agent.id);
    const detail = await getContact(T.agentCtx, c.id);
    expect(detail.contact.firstName).toBe("יוסי");

    await updateContact(T.agentCtx, c.id, input({ firstName: "יוסף", lastName: "כהן", phone: "0521111111", lifecycleStage: "customer" }));
    const byName = await listContacts(T.agentCtx, q({ q: "יוסף" }));
    expect(byName.rows.map((r) => r.id)).toContain(c.id);
    const byPhoneFragment = await listContacts(T.agentCtx, q({ q: "1111111" }));
    expect(byPhoneFragment.rows.map((r) => r.id)).toContain(c.id);
    const byStage = await listContacts(T.agentCtx, q({ stage: "customer" }));
    expect(byStage.rows.every((r) => r.lifecycleStage === "customer")).toBe(true);
    const mine = await listContacts(T.agentCtx, q({ owner: "me" }));
    expect(mine.rows.every((r) => r.ownerId === T.agent.id)).toBe(true);

    // Timeline has the creation entry; audit log has both writes.
    const tl = await listTimeline(T.agentCtx, "contact", c.id);
    expect(tl.items.map((i) => i.type)).toContain("contact_created");
    const audits = await db().select().from(schema.auditLogs).where(eq(schema.auditLogs.entityId, c.id));
    expect(audits.map((a) => a.action).sort()).toEqual(["contact.created", "contact.updated"]);
    // An event was queued for automations.
    const [{ n }] = await db().execute<{ n: number }>(sql`select count(*)::int as n from public.jobs where type = 'events.dispatch' and payload->>'entityId' = ${c.id}`);
    expect(n).toBeGreaterThanOrEqual(2);
  });

  it("escapes LIKE wildcards in search", async () => {
    await createContact(T.ownerCtx, input({ firstName: "Percent", lastName: "Guy" }));
    const r = await listContacts(T.ownerCtx, q({ q: "%" }));
    expect(r.rows).toEqual([]);
  });

  it("never returns another tenant's contacts, even by id", async () => {
    const foreign = await createContact(Other.ownerCtx, input({ firstName: "Foreign" }));
    await expectAppError(getContact(T.ownerCtx, foreign.id), "NOT_FOUND");
    const list = await listContacts(T.ownerCtx, q({ q: "Foreign" }));
    expect(list.rows).toEqual([]);
  });

  it("rejects linking a company from another tenant", async () => {
    const [foreignCompany] = await db().insert(schema.companies).values({ tenantId: Other.tenant.id, name: "Theirs" }).returning();
    await expectAppError(createContact(T.ownerCtx, input({ firstName: "A", companyId: foreignCompany.id })), "VALIDATION");
  });

  it("enforces permissions: agents cannot delete, owners can (soft delete)", async () => {
    const c = await createContact(T.ownerCtx, input({ firstName: "Delete", lastName: "Me" }));
    await expectAppError(deleteContact(T.agentCtx, c.id), "FORBIDDEN");
    await deleteContact(T.ownerCtx, c.id);
    await expectAppError(getContact(T.ownerCtx, c.id), "NOT_FOUND");
    const [row] = await db().select().from(schema.contacts).where(eq(schema.contacts.id, c.id));
    expect(row.deletedAt).not.toBeNull();
  });

  it("validates custom fields against definitions", async () => {
    await createCustomField(T.ownerCtx, { entityType: "contact", label: "Budget", key: "budget", fieldType: "number", options: [], required: false });
    await createCustomField(T.ownerCtx, { entityType: "contact", label: "Tier", key: "tier", fieldType: "select", options: ["Gold", "Silver"], required: false });
    const c = await createContact(T.ownerCtx, input({ firstName: "Custom", customFields: { budget: "1,500", tier: "Gold", unknown: "x" } }));
    expect(c.customFields).toEqual({ budget: 1500, tier: "Gold" });
    await expectAppError(createContact(T.ownerCtx, input({ firstName: "Bad", customFields: { tier: "Bronze" } })), "VALIDATION");
  });

  it("tags contacts and filters by tag", async () => {
    const vip = await createTag(T.ownerCtx, { name: "VIP", color: "#ef4444" });
    const c = await createContact(T.ownerCtx, input({ firstName: "Tagged", tagIds: [vip.id] }));
    const r = await listContacts(T.ownerCtx, q({ tag: vip.id }));
    expect(r.rows.map((x) => x.id)).toEqual([c.id]);
    expect(r.rows[0].tags.map((t) => t.name)).toEqual(["VIP"]);
    const foreignTag = await createTag(Other.ownerCtx, { name: "VIP", color: "#ef4444" });
    await expectAppError(createContact(T.ownerCtx, input({ firstName: "X", tagIds: [foreignTag.id] })), "VALIDATION");
  });

  it("notes: authors and managers can edit, other agents cannot", async () => {
    const c = await createContact(T.ownerCtx, input({ firstName: "Notes" }));
    const note = await addNote(T.ownerCtx, "contact", c.id, "שיחה ראשונה — מעוניין בקטלוג");
    expect((await listNotes(T.agentCtx, "contact", c.id)).map((n) => n.id)).toEqual([note.id]);
    await expectAppError(deleteNote(T.agentCtx, note.id), "FORBIDDEN");
    await deleteNote(T.managerCtx, note.id);
    expect(await listNotes(T.ownerCtx, "contact", c.id)).toEqual([]);
  });
});

describe("duplicates and merge", () => {
  it("detects duplicates by phone/email and merges everything into the primary", async () => {
    const a = await createContact(T.ownerCtx, input({ firstName: "Dup", phone: "0549999999" }));
    const b = await createContact(T.ownerCtx, input({ firstName: "Dup2", lastName: "Last", phone: "+972549999999", email: "dup@x.test" }));
    const candidates = await findDuplicateCandidates(T.ownerCtx, { phone: "+972549999999" });
    expect(candidates.map((c) => c.id).sort()).toEqual([a.id, b.id].sort());
    const groups = await listDuplicateGroups(T.ownerCtx);
    expect(groups.some((g) => g.contacts.some((c) => c.id === a.id))).toBe(true);

    await addNote(T.ownerCtx, "contact", b.id, "note on duplicate");
    await setWhatsappConsent(T.ownerCtx, b.id, { status: "opted_out", source: "manual" });
    await mergeContacts(T.ownerCtx, a.id, b.id);

    const merged = await getContact(T.ownerCtx, a.id);
    expect(merged.contact).toMatchObject({ firstName: "Dup", lastName: "Last", email: "dup@x.test", whatsappConsent: "opted_out" });
    expect((await listNotes(T.ownerCtx, "contact", a.id)).map((n) => n.body)).toContain("note on duplicate");
    await expectAppError(getContact(T.ownerCtx, b.id), "NOT_FOUND");
    await expectAppError(mergeContacts(T.agentCtx, a.id, b.id), "FORBIDDEN");
  });
});

describe("CSV import / export", () => {
  it("imports valid rows, reports invalid ones, dedupes and creates companies & tags", async () => {
    const csv = [
      "שם מלא,טלפון,אימייל,חברה,תגיות,שלב",
      "רונית לוי,050-2222222,ronit@test.co,צעצועי הצפון,סיטונאי;VIP,לקוח",
      "Bad Phone,123,,,,",
      "Avi Ben,+972-52-3333333,avi@test.co,צעצועי הצפון,,lead",
      ",,,,,",
    ].join("\n");
    const mapping = { "שם מלא": "fullName", טלפון: "phone", אימייל: "email", חברה: "companyName", תגיות: "tags", שלב: "lifecycleStage" };
    const report = await importContacts(T.managerCtx, { csv, mapping, duplicateStrategy: "skip", createCompanies: true, consentOptIn: false });
    // Blank lines are ignored by the parser, so 3 data rows remain.
    expect(report).toMatchObject({ total: 3, created: 2, skipped: 0 });
    expect(report.errors).toEqual([{ row: 3, message: "phone: 123" }]);

    const again = await importContacts(T.managerCtx, { csv, mapping, duplicateStrategy: "skip", createCompanies: true, consentOptIn: false });
    expect(again.created).toBe(0);
    expect(again.skipped).toBe(2);

    const ronit = (await listContacts(T.managerCtx, q({ q: "רונית" }))).rows[0];
    expect(ronit).toMatchObject({ lastName: "לוי", phone: "+972502222222", lifecycleStage: "customer", companyName: "צעצועי הצפון" });
    expect(ronit.tags.map((t) => t.name).sort()).toEqual(["VIP", "סיטונאי"].sort());
    const companies = await db().select().from(schema.companies).where(eq(schema.companies.name, "צעצועי הצפון"));
    expect(companies).toHaveLength(1);
  });

  it("agents cannot import or export", async () => {
    await expectAppError(importContacts(T.agentCtx, { csv: "a\nb", mapping: { a: "firstName" }, duplicateStrategy: "skip", createCompanies: false, consentOptIn: false }), "FORBIDDEN");
    await expectAppError(exportContactsCsv(T.agentCtx, q()), "FORBIDDEN");
  });

  it("exports a BOM-prefixed CSV with formula injection neutralized", async () => {
    await createContact(T.ownerCtx, input({ firstName: "=HYPERLINK(\"x\")", lastName: "Evil" }));
    const { csv, count } = await exportContactsCsv(T.ownerCtx, q());
    expect(csv.startsWith("﻿first_name,")).toBe(true);
    expect(count).toBeGreaterThan(3);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).not.toContain("Foreign");
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { closeDb, db, schema } from "@/server/db";
import { AppError } from "@/server/errors";
import { quoteInputSchema, type QuoteInput } from "@/modules/documents/schemas";
import {
  createInvoiceForQuote,
  createQuote,
  deleteQuote,
  duplicateQuote,
  expireDueQuotes,
  getPublicQuote,
  getQuote,
  listQuotes,
  quotePdf,
  publicQuotePdf,
  recordPublicView,
  regenerateQuoteLink,
  respondToQuote,
  sendQuote,
  setMockAccountingConnection,
  setQuoteStatus,
  updateQuote,
} from "@/modules/documents/service";
import { createTemplate, deleteTemplate, listTemplates, updateDocumentSettings, updateTemplate } from "@/modules/documents/templates";
import { quoteListQuerySchema } from "@/modules/documents/schemas";
import { createTeam } from "../support/factories";

type Team = Awaited<ReturnType<typeof createTeam>>;
let T: Team;
let Other: Team;
let contactId: string;

const input = (over: Record<string, unknown> = {}): QuoteInput =>
  quoteInputSchema.parse({
    title: "הצעה לקטלוג החורף",
    issueDate: "2026-10-01",
    validUntil: "2099-12-31",
    currency: "ILS",
    taxRatePercent: "18",
    discountPercent: "0",
    items: [
      { description: "דובי פרווה", quantity: "2", unitPrice: "100", discountPercent: "0" },
      { description: "LEGO Classic", quantity: "1", unitPrice: "50.50", discountPercent: "0" },
    ],
    ...over,
  });

async function expectAppError(p: Promise<unknown>, code: string) {
  let err: unknown;
  try {
    await p;
  } catch (e) {
    err = e;
  }
  expect(err instanceof AppError ? err.code : err).toBe(code);
}

beforeAll(async () => {
  T = await createTeam("Quotes Co");
  Other = await createTeam("Other Quotes Co");
  const [c] = await db()
    .insert(schema.contacts)
    .values({ tenantId: T.tenant.id, firstName: "רונית", lastName: "לוי", email: "ronit@quote.test", phone: "+972501234567" })
    .returning();
  contactId = c.id;
});

afterAll(async () => {
  await closeDb();
});

describe("quote creation and totals", () => {
  it("creates a quote with server-computed totals, items, activity and audit", async () => {
    const q = await createQuote(T.agentCtx, input({ contactId }));
    expect(q).toMatchObject({ status: "draft", subtotalCents: 25_050, taxCents: 4_509, totalCents: 29_559, taxRateBp: 1800 });
    const detail = await getQuote(T.agentCtx, q.id);
    expect(detail.items.map((i) => [i.description, i.quantityMilli, i.lineTotalCents])).toEqual([
      ["דובי פרווה", 2000, 20_000],
      ["LEGO Classic", 1000, 5_050],
    ]);
    expect(detail.contact?.name).toBe("רונית לוי");
    const acts = await db().select().from(schema.activities).where(and(eq(schema.activities.contactId, contactId), eq(schema.activities.type, "quote_created")));
    expect(acts).toHaveLength(1);
    const audits = await db().select().from(schema.auditLogs).where(eq(schema.auditLogs.entityId, q.id));
    expect(audits.map((a) => a.action)).toContain("quote.created");
  });

  it("numbers quotes gapless and unique under concurrency", async () => {
    const team = await createTeam("Numbering Co");
    const created = await Promise.all(Array.from({ length: 20 }, () => createQuote(team.ownerCtx, input())));
    const numbers = created.map((q) => q.number).sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    // A failure after the number was allocated rolls the counter back (no gap).
    const bad = { ...input(), issueDate: "2026-10-10", validUntil: "2026-10-01" } as QuoteInput;
    await expect(createQuote(team.ownerCtx, bad)).rejects.toThrow();
    const next = await createQuote(team.ownerCtx, input());
    expect(next.number).toBe(21);
    // Numbering is per tenant.
    const otherFirst = await createQuote(Other.ownerCtx, input());
    expect(otherFirst.number).toBeLessThanOrEqual(2);
  });

  it("lists, filters and searches quotes", async () => {
    const q = await createQuote(T.ownerCtx, input({ title: "הצעה מיוחדת לחנוכה", contactId }));
    const byTitle = await listQuotes(T.ownerCtx, quoteListQuerySchema.parse({ q: "חנוכה" }));
    expect(byTitle.rows.map((r) => r.id)).toEqual([q.id]);
    const byNumber = await listQuotes(T.ownerCtx, quoteListQuerySchema.parse({ q: `#${q.number}` }));
    expect(byNumber.rows.map((r) => r.id)).toContain(q.id);
    const byContact = await listQuotes(T.ownerCtx, quoteListQuerySchema.parse({ q: "רונית" }));
    expect(byContact.rows.length).toBeGreaterThanOrEqual(2);
    const drafts = await listQuotes(T.ownerCtx, quoteListQuerySchema.parse({ status: "draft" }));
    expect(drafts.rows.every((r) => r.status === "draft")).toBe(true);
  });

  it("sums the open pipeline in the tenant currency only", async () => {
    const before = await listQuotes(T.ownerCtx, quoteListQuerySchema.parse({}));
    const ils = await createQuote(T.ownerCtx, input());
    const usd = await createQuote(T.ownerCtx, input({ currency: "USD" }));
    await sendQuote(T.ownerCtx, ils.id);
    await sendQuote(T.ownerCtx, usd.id);
    const after = await listQuotes(T.ownerCtx, quoteListQuerySchema.parse({}));
    expect(after.currency).toBe("ILS");
    expect(after.openTotalCents - before.openTotalCents).toBe(ils.totalCents);
  });
});

describe("permissions and isolation", () => {
  it("rejects links to another tenant's records and hides other tenants' quotes", async () => {
    const [foreign] = await db().insert(schema.contacts).values({ tenantId: Other.tenant.id, firstName: "Foreign" }).returning();
    await expectAppError(createQuote(T.ownerCtx, input({ contactId: foreign.id })), "VALIDATION");
    const theirs = await createQuote(Other.ownerCtx, input());
    await expectAppError(getQuote(T.ownerCtx, theirs.id), "NOT_FOUND");
    await expectAppError(updateQuote(T.ownerCtx, theirs.id, input()), "NOT_FOUND");
    await expectAppError(sendQuote(T.ownerCtx, theirs.id), "NOT_FOUND");
    const list = await listQuotes(T.ownerCtx, quoteListQuerySchema.parse({}));
    expect(list.rows.some((r) => r.id === theirs.id)).toBe(false);
  });

  it("agents cannot delete quotes or manage templates; managers can", async () => {
    const q = await createQuote(T.agentCtx, input());
    await expectAppError(deleteQuote(T.agentCtx, q.id), "FORBIDDEN");
    await deleteQuote(T.managerCtx, q.id);
    await expectAppError(getQuote(T.ownerCtx, q.id), "NOT_FOUND");
    await expectAppError(createTemplate(T.agentCtx, { name: "x", headerText: null, footerText: null, terms: null, accentColor: "#123456", showLogo: true, isDefault: false }), "FORBIDDEN");
  });
});

describe("lifecycle: send → public view → accept", () => {
  it("sends, emails the customer, tracks the view and records the decision", async () => {
    const q = await createQuote(T.ownerCtx, input({ contactId }));
    const { publicUrl, emailed } = await sendQuote(T.ownerCtx, q.id, { emailTo: "ronit@quote.test" });
    expect(emailed).toBe(true);
    expect(publicUrl).toMatch(/\/q\/[A-Za-z0-9_-]{40,}$/);
    const token = publicUrl.split("/q/")[1];

    const sent = await getQuote(T.ownerCtx, q.id);
    expect(sent.quote.status).toBe("sent");
    expect(sent.quote.pdfStorageKey).toBeTruthy();
    expect(sent.quote.publicTokenHash).not.toContain(token);
    await expectAppError(updateQuote(T.ownerCtx, q.id, input()), "CONFLICT");

    const [mail] = await db().execute<{ template: string; text_body: string }>(
      sql`select template, text_body from public.email_outbox where to_email = 'ronit@quote.test' order by created_at desc limit 1`,
    );
    expect(mail.template).toBe("quote_sent");
    expect(mail.text_body).toContain(publicUrl);

    const pub = await getPublicQuote(token);
    expect(pub?.quote.id).toBe(q.id);
    expect(await getPublicQuote("x".repeat(43))).toBeNull();

    await recordPublicView(token);
    await recordPublicView(token);
    const viewed = await getQuote(T.ownerCtx, q.id);
    expect(viewed.quote).toMatchObject({ status: "viewed", viewCount: 2 });
    const notes = await db().select().from(schema.notifications).where(eq(schema.notifications.userId, T.owner.id));
    expect(notes.some((n) => n.title.includes(`#${q.number}`))).toBe(true);

    const r = await respondToQuote(token, { decision: "accepted", name: "רונית לוי", note: "מאשרת, תודה" });
    expect(r.status).toBe("accepted");
    const accepted = await getQuote(T.ownerCtx, q.id);
    expect(accepted.quote).toMatchObject({ status: "accepted", decidedByName: "רונית לוי", decisionNote: "מאשרת, תודה" });
    await expectAppError(respondToQuote(token, { decision: "rejected", name: "Someone", note: null }), "CONFLICT");

    const events = await db().execute<{ type: string }>(
      sql`select payload->>'type' as type from public.jobs where type = 'events.dispatch' and payload->>'entityId' = ${q.id}`,
    );
    expect(events.map((e) => e.type).sort()).toEqual(["quote.accepted", "quote.sent"]);

    const pdf = await publicQuotePdf(token);
    expect(pdf?.bytes.length).toBeGreaterThan(1000);
  });

  it("regenerating the link invalidates the old one", async () => {
    const q = await createQuote(T.ownerCtx, input());
    const { publicUrl } = await sendQuote(T.ownerCtx, q.id);
    const oldToken = publicUrl.split("/q/")[1];
    const { publicUrl: fresh } = await regenerateQuoteLink(T.ownerCtx, q.id);
    expect(await getPublicQuote(oldToken)).toBeNull();
    expect((await getPublicQuote(fresh.split("/q/")[1]))?.quote.id).toBe(q.id);
  });

  it("enforces the status machine for staff actions", async () => {
    const q = await createQuote(T.ownerCtx, input());
    await expectAppError(setQuoteStatus(T.ownerCtx, q.id, "accepted"), "CONFLICT");
    await sendQuote(T.ownerCtx, q.id);
    await setQuoteStatus(T.ownerCtx, q.id, "rejected", "הלקוח בחר בספק אחר");
    await expectAppError(setQuoteStatus(T.ownerCtx, q.id, "canceled"), "CONFLICT");
    const draft = await createQuote(T.ownerCtx, input());
    await setQuoteStatus(T.ownerCtx, draft.id, "canceled");
    await expectAppError(sendQuote(T.ownerCtx, draft.id), "CONFLICT");
  });

  it("expires overdue quotes and refuses decisions on them", async () => {
    const q = await createQuote(T.ownerCtx, input({ issueDate: "2020-01-01", validUntil: "2020-01-31" }));
    const { publicUrl } = await sendQuote(T.ownerCtx, q.id);
    expect(await expireDueQuotes()).toBeGreaterThanOrEqual(1);
    expect((await getQuote(T.ownerCtx, q.id)).quote.status).toBe("expired");
    await expectAppError(respondToQuote(publicUrl.split("/q/")[1], { decision: "accepted", name: "Late", note: null }), "CONFLICT");
  });

  it("duplicates any quote into a new draft", async () => {
    const q = await createQuote(T.ownerCtx, input({ contactId, discountPercent: "5" }));
    await sendQuote(T.ownerCtx, q.id);
    const copy = await duplicateQuote(T.ownerCtx, q.id);
    expect(copy).toMatchObject({ status: "draft", contactId, discountBp: 500, totalCents: q.totalCents });
    expect(copy.number).toBeGreaterThan(q.number);
  });
});

describe("PDF", () => {
  it("renders a valid PDF with the embedded Hebrew font", async () => {
    const q = await createQuote(T.ownerCtx, input({ contactId, notes: "הערה (חשובה) עם מספר 12 ו-English." }));
    const { bytes, fileName } = await quotePdf(T.agentCtx, q.id);
    expect(fileName).toBe(`הצעת-מחיר-${q.number}.pdf`);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
    // Objects are packed into compressed object streams, so inspect the object model.
    const fontNames: string[] = [];
    let embeddedFontFiles = 0;
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFDict)) continue;
      const name = obj.get(PDFName.of("FontName"));
      if (name) fontNames.push(name.toString());
      if (obj.get(PDFName.of("FontFile2"))) embeddedFontFiles++;
    }
    expect(embeddedFontFiles).toBeGreaterThanOrEqual(1);
    expect(fontNames.some((n) => n.includes("Alef"))).toBe(true);
  });

  it("paginates long quotes", async () => {
    const items = Array.from({ length: 60 }, (_, i) => ({ description: `פריט מספר ${i + 1} עם תיאור ארוך שמתפרס על פני יותר משורה אחת בטבלה`, quantity: "1", unitPrice: "10", discountPercent: "0" }));
    const q = await createQuote(T.ownerCtx, input({ items }));
    const { bytes } = await quotePdf(T.ownerCtx, q.id);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(1);
  });
});

describe("templates, settings and invoicing", () => {
  it("keeps exactly one default template and protects it from deletion", async () => {
    const before = await listTemplates(T.ownerCtx);
    expect(before.filter((t) => t.isDefault)).toHaveLength(1);
    const t2 = await createTemplate(T.managerCtx, { name: "פרימיום", headerText: "שלום", footerText: null, terms: "תנאים", accentColor: "#10b981", showLogo: false, isDefault: true });
    const after = await listTemplates(T.ownerCtx);
    expect(after.filter((t) => t.isDefault).map((t) => t.id)).toEqual([t2.id]);
    await expectAppError(deleteTemplate(T.ownerCtx, t2.id), "VALIDATION");
    const old = after.find((t) => t.id !== t2.id)!;
    await updateTemplate(T.ownerCtx, old.id, { name: old.name, headerText: null, footerText: null, terms: old.terms, accentColor: old.accentColor, showLogo: true, isDefault: true });
    await deleteTemplate(T.ownerCtx, t2.id);
    expect((await listTemplates(T.ownerCtx)).map((t) => t.id)).toEqual([old.id]);
  });

  it("uses the tenant's default VAT rate setting", async () => {
    await updateDocumentSettings(T.ownerCtx, { defaultTaxRateBp: 1700 });
    const [t] = await db().select().from(schema.tenants).where(eq(schema.tenants.id, T.tenant.id));
    expect(t.settings.defaultTaxRateBp).toBe(1700);
    await updateDocumentSettings(T.ownerCtx, { defaultTaxRateBp: 1800 });
  });

  it("creates an invoice in the connected (mock) accounting system only for accepted quotes", async () => {
    const q = await createQuote(T.ownerCtx, input());
    const { publicUrl } = await sendQuote(T.ownerCtx, q.id);
    await respondToQuote(publicUrl.split("/q/")[1], { decision: "accepted", name: "Customer", note: null });
    await expectAppError(createInvoiceForQuote(T.ownerCtx, q.id), "PRECONDITION");
    await setMockAccountingConnection(T.ownerCtx, true);
    expect((await getQuote(T.ownerCtx, q.id)).canInvoice).toBe(true);
    const { externalId } = await createInvoiceForQuote(T.ownerCtx, q.id);
    expect(externalId).toMatch(/^MOCK-INV-/);
    await expectAppError(createInvoiceForQuote(T.ownerCtx, q.id), "CONFLICT");
    const draft = await createQuote(T.ownerCtx, input());
    await expectAppError(createInvoiceForQuote(T.ownerCtx, draft.id), "CONFLICT");
    await setMockAccountingConnection(T.ownerCtx, false);
  });
});

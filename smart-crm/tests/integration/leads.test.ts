import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { closeDb, db, schema } from "@/server/db";
import { convertLeadSchema, leadInputSchema, leadListQuerySchema } from "@/modules/sales/schemas";
import { convertLead, createLead, deleteLead, getLead, listLeads, setLeadStatus, updateLead } from "@/modules/sales/leads";
import { listPipelines } from "@/modules/sales/pipelines";
import { getDeal } from "@/modules/sales/deals";
import { contactInputSchema, companyInputSchema } from "@/modules/crm/schemas";
import { createContact, getContact } from "@/modules/crm/contacts/service";
import { createCompany } from "@/modules/crm/companies/service";
import { listTimeline } from "@/modules/crm/activities";
import { AppError } from "@/server/errors";
import { createTeam } from "../support/factories";

type Team = Awaited<ReturnType<typeof createTeam>>;
let T: Team;
let Other: Team;

const lead = (v: Record<string, unknown>) => leadInputSchema.parse(v);
const q = (v: Record<string, unknown> = {}) => leadListQuerySchema.parse(v);

async function expectAppError(p: Promise<unknown>, code: string, message?: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code && (!message || e.message === message));
}

beforeAll(async () => {
  T = await createTeam("Leads Co");
  Other = await createTeam("Other Leads Co");
});
afterAll(async () => {
  await closeDb();
});

describe("leads", () => {
  it("creates leads, lists with status counts and search, notifies the assigned owner", async () => {
    const l = await createLead(T.ownerCtx, lead({ fullName: "אורית שמש", phone: "054-1112233", source: "website", ownerId: T.agent.id, estimatedValue: "2,500" }));
    expect(l).toMatchObject({ status: "new", phone: "+972541112233", estimatedValueCents: 250000, ownerId: T.agent.id });
    const list = await listLeads(T.agentCtx, q({ q: "שמש" }));
    expect(list.rows.map((r) => r.id)).toEqual([l.id]);
    expect(list.statusCounts.new).toBe(1);
    const notes = await db().select().from(schema.notifications).where(and(eq(schema.notifications.userId, T.agent.id), eq(schema.notifications.type, "lead_assigned")));
    expect(notes).toHaveLength(1);
    expect((await listTimeline(T.ownerCtx, "lead", l.id)).items.map((i) => i.type)).toContain("lead_created");
    const [{ n }] = await db().execute<{ n: number }>(sql`select count(*)::int as n from public.jobs where payload->>'type' = 'lead.created' and payload->>'entityId' = ${l.id}`);
    expect(n).toBe(1);
  });

  it("enforces the status workflow and requires a reason for unqualified", async () => {
    const l = await createLead(T.agentCtx, lead({ fullName: "Status Flow", email: "flow@x.test" }));
    await setLeadStatus(T.agentCtx, l.id, "contacted", null);
    await expectAppError(setLeadStatus(T.agentCtx, l.id, "unqualified", null), "VALIDATION");
    await setLeadStatus(T.agentCtx, l.id, "unqualified", "אין תקציב");
    const got = await getLead(T.agentCtx, l.id);
    expect(got.lead).toMatchObject({ status: "unqualified", unqualifiedReason: "אין תקציב" });
    // unqualified → qualified is not an allowed jump.
    await expectAppError(setLeadStatus(T.agentCtx, l.id, "qualified", null), "VALIDATION", "leads.invalidTransition");
    await setLeadStatus(T.agentCtx, l.id, "new", null);
    expect((await getLead(T.agentCtx, l.id)).lead.unqualifiedReason).toBeNull();
  });

  it("converts a lead into contact + company + deal exactly once", async () => {
    const [p] = await listPipelines(T.ownerCtx);
    const l = await createLead(T.agentCtx, lead({ fullName: "נועם ברק", email: "noam@barak.test", companyName: "ברק צעצועים", estimatedValue: 8000 }));
    const input = convertLeadSchema.parse({ leadId: l.id, createCompany: true, createDeal: true, pipelineId: p.id, stageId: p.stages[1].id });
    const r = await convertLead(T.agentCtx, input);
    expect(r.createdContact).toBe(true);
    const contact = await getContact(T.agentCtx, r.contactId);
    expect(contact.contact).toMatchObject({ firstName: "נועם", lastName: "ברק", email: "noam@barak.test", lifecycleStage: "opportunity" });
    expect(contact.company?.name).toBe("ברק צעצועים");
    const deal = await getDeal(T.agentCtx, r.dealId!);
    expect(deal.deal).toMatchObject({ title: "ברק צעצועים", valueCents: 800000, stageId: p.stages[1].id, leadId: l.id, contactId: r.contactId });
    const after = await getLead(T.agentCtx, l.id);
    expect(after.lead).toMatchObject({ status: "converted", contactId: r.contactId, convertedDealId: r.dealId });
    expect((await listTimeline(T.agentCtx, "lead", l.id)).items.map((i) => i.type)).toContain("lead_converted");

    await expectAppError(convertLead(T.agentCtx, input), "CONFLICT", "leads.alreadyConverted");
    // Converted leads cannot be moved back by status changes.
    await expectAppError(setLeadStatus(T.agentCtx, l.id, "new", null), "VALIDATION");
  });

  it("concurrent conversions produce a single contact and deal", async () => {
    const [p] = await listPipelines(T.ownerCtx);
    const l = await createLead(T.ownerCtx, lead({ fullName: "Race Condition", phone: "+972509876543" }));
    const input = convertLeadSchema.parse({ leadId: l.id, createDeal: true, pipelineId: p.id, stageId: p.stages[0].id });
    const results = await Promise.allSettled([convertLead(T.ownerCtx, input), convertLead(T.ownerCtx, input)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const [{ n }] = await db().execute<{ n: number }>(sql`select count(*)::int as n from public.contacts where tenant_id = ${T.tenant.id} and phone = '+972509876543'`);
    expect(n).toBe(1);
  });

  it("reuses an existing contact and company on conversion", async () => {
    const company = await createCompany(T.ownerCtx, companyInputSchema.parse({ name: "Existing Co" }));
    const existing = await createContact(T.ownerCtx, contactInputSchema.parse({ firstName: "Exist", phone: "0527778888" }));
    const l = await createLead(T.ownerCtx, lead({ fullName: "Somebody Else", phone: "+972527778888", companyName: "existing co" }));
    const r = await convertLead(T.ownerCtx, convertLeadSchema.parse({ leadId: l.id, createDeal: false }));
    expect(r).toMatchObject({ contactId: existing.id, companyId: company.id, dealId: null, createdContact: false });
    expect((await getContact(T.ownerCtx, existing.id)).contact.companyId).toBe(company.id);
  });

  it("requires pipeline and stage when creating a deal; agents can convert but not delete", async () => {
    expect(convertLeadSchema.safeParse({ leadId: crypto.randomUUID(), createDeal: true }).success).toBe(false);
    const l = await createLead(T.agentCtx, lead({ fullName: "No delete" }));
    await expectAppError(deleteLead(T.agentCtx, l.id), "FORBIDDEN");
    await deleteLead(T.managerCtx, l.id);
    await expectAppError(getLead(T.managerCtx, l.id), "NOT_FOUND");
  });

  it("isolates tenants", async () => {
    const theirs = await createLead(Other.ownerCtx, lead({ fullName: "Theirs" }));
    await expectAppError(getLead(T.ownerCtx, theirs.id), "NOT_FOUND");
    await expectAppError(updateLead(T.ownerCtx, theirs.id, lead({ fullName: "x" })), "NOT_FOUND");
    await expectAppError(convertLead(T.ownerCtx, convertLeadSchema.parse({ leadId: theirs.id, createDeal: false })), "NOT_FOUND");
    expect((await listLeads(T.ownerCtx, q({ q: "Theirs" }))).rows).toEqual([]);
  });

  it("validates input", () => {
    expect(leadInputSchema.safeParse({}).success).toBe(false);
    expect(leadInputSchema.safeParse({ fullName: "x", score: 101 }).success).toBe(false);
    expect(leadInputSchema.safeParse({ fullName: "x", source: "fax" }).success).toBe(false);
  });
});

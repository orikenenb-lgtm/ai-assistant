import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, db, schema } from "@/server/db";
import { companyInputSchema, contactInputSchema } from "@/modules/crm/schemas";
import { companyListQuerySchema, createCompany, deleteCompany, getCompany, listCompanies, setCompanyTags, updateCompany } from "@/modules/crm/companies/service";
import { createContact } from "@/modules/crm/contacts/service";
import { createTag } from "@/modules/crm/tags";
import { listTimeline } from "@/modules/crm/activities";
import { AppError } from "@/server/errors";
import { createTeam } from "../support/factories";

type Team = Awaited<ReturnType<typeof createTeam>>;
let T: Team;
let Other: Team;

const input = (v: Record<string, unknown>) => companyInputSchema.parse(v);
const q = (v: Record<string, unknown> = {}) => companyListQuerySchema.parse(v);

async function expectAppError(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code);
}

beforeAll(async () => {
  T = await createTeam("Companies Co");
  Other = await createTeam("Other Companies Co");
});
afterAll(async () => {
  await closeDb();
});

describe("companies service", () => {
  it("creates, lists with search and counts, updates and records timeline/audit/event", async () => {
    const c = await createCompany(T.agentCtx, input({ name: "צעצועי הגליל", city: "צפת", phone: "04-6971234", website: "https://galil.example" }));
    expect(c.ownerId).toBe(T.agent.id);
    expect(c.phone).toBe("+97246971234");
    await createContact(T.agentCtx, contactInputSchema.parse({ firstName: "עובד", companyId: c.id }));

    const list = await listCompanies(T.agentCtx, q({ q: "גליל" }));
    expect(list.rows).toHaveLength(1);
    expect(list.rows[0]).toMatchObject({ name: "צעצועי הגליל", contactsCount: 1, openDealsCount: 0 });

    await updateCompany(T.agentCtx, c.id, input({ name: "צעצועי הגליל העליון", city: "צפת" }));
    const detail = await getCompany(T.agentCtx, c.id);
    expect(detail.company.name).toBe("צעצועי הגליל העליון");
    expect(detail.contacts).toHaveLength(1);

    const tl = await listTimeline(T.agentCtx, "company", c.id);
    expect(tl.items.map((i) => i.type)).toContain("company_created");
    const audits = await db().select().from(schema.auditLogs).where(eq(schema.auditLogs.entityId, c.id));
    expect(audits.map((a) => a.action).sort()).toEqual(["company.created", "company.updated"]);
  });

  it("filters by tag and owner", async () => {
    const tag = await createTag(T.ownerCtx, { name: "רשת ארצית", color: "#f59e0b" });
    const a = await createCompany(T.ownerCtx, input({ name: "Tagged Ltd" }));
    await setCompanyTags(T.ownerCtx, a.id, [tag.id]);
    const byTag = await listCompanies(T.ownerCtx, q({ tag: tag.id }));
    expect(byTag.rows.map((r) => r.id)).toEqual([a.id]);
    const mine = await listCompanies(T.ownerCtx, q({ owner: "me" }));
    expect(mine.rows.every((r) => r.ownerId === T.owner.id)).toBe(true);
  });

  it("isolates tenants", async () => {
    const theirs = await createCompany(Other.ownerCtx, input({ name: "Secret Corp" }));
    await expectAppError(getCompany(T.ownerCtx, theirs.id), "NOT_FOUND");
    await expectAppError(updateCompany(T.ownerCtx, theirs.id, input({ name: "x" })), "NOT_FOUND");
    expect((await listCompanies(T.ownerCtx, q({ q: "Secret" }))).rows).toEqual([]);
    const foreignTag = await createTag(Other.ownerCtx, { name: "theirs", color: "#000000" });
    const mine = await createCompany(T.ownerCtx, input({ name: "Mine" }));
    await expectAppError(setCompanyTags(T.ownerCtx, mine.id, [foreignTag.id]), "VALIDATION");
  });

  it("only owners/managers delete; delete unlinks contacts", async () => {
    const c = await createCompany(T.ownerCtx, input({ name: "To Delete" }));
    const contact = await createContact(T.ownerCtx, contactInputSchema.parse({ firstName: "Linked", companyId: c.id }));
    await expectAppError(deleteCompany(T.agentCtx, c.id), "FORBIDDEN");
    await deleteCompany(T.managerCtx, c.id);
    await expectAppError(getCompany(T.ownerCtx, c.id), "NOT_FOUND");
    const [row] = await db().select().from(schema.contacts).where(eq(schema.contacts.id, contact.id));
    expect(row.companyId).toBeNull();
  });

  it("validates input", () => {
    expect(companyInputSchema.safeParse({ name: "" }).success).toBe(false);
    expect(companyInputSchema.safeParse({ name: "x", email: "bad" }).success).toBe(false);
    expect(companyInputSchema.safeParse({ name: "x", country: "Israel" }).success).toBe(false);
  });
});

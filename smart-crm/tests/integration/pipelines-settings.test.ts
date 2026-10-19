import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "@/server/db";
import { archiveCustomField, createCustomField, getCustomFieldDefs, reorderCustomFields } from "@/modules/crm/custom-fields";
import { createTag, deleteTag, listTags, replaceEntityTags, tagUsageCounts, updateTag } from "@/modules/crm/tags";
import { createCompany } from "@/modules/crm/companies/service";
import { companyInputSchema } from "@/modules/crm/schemas";
import { AppError } from "@/server/errors";
import { createTeam } from "../support/factories";

type Team = Awaited<ReturnType<typeof createTeam>>;
let T: Team;
let Other: Team;

async function expectAppError(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code);
}

beforeAll(async () => {
  T = await createTeam("CRM Settings Co");
  Other = await createTeam("Other CRM Settings Co");
});
afterAll(async () => {
  await closeDb();
});

describe("custom field settings", () => {
  it("reorders a single entity's fields atomically and validates the id set", async () => {
    const a = await createCustomField(T.ownerCtx, { entityType: "deal", label: "Source", key: "src", fieldType: "text", options: [], required: false });
    const b = await createCustomField(T.ownerCtx, { entityType: "deal", label: "Tier", key: "tier", fieldType: "select", options: ["A", "B"], required: false });
    const c = await createCustomField(T.ownerCtx, { entityType: "deal", label: "Budget", key: "budget", fieldType: "number", options: [], required: false });
    await reorderCustomFields(T.ownerCtx, "deal", [c.id, a.id, b.id]);
    expect((await getCustomFieldDefs(T.ownerCtx, "deal")).map((d) => d.key)).toEqual(["budget", "src", "tier"]);

    // Missing / foreign ids are rejected.
    await expectAppError(reorderCustomFields(T.ownerCtx, "deal", [a.id, b.id]), "VALIDATION");
    const foreign = await createCustomField(Other.ownerCtx, { entityType: "deal", label: "X", key: "x", fieldType: "text", options: [], required: false });
    await expectAppError(reorderCustomFields(T.ownerCtx, "deal", [c.id, a.id, foreign.id]), "VALIDATION");

    // Archived fields drop out of the active order.
    await archiveCustomField(T.ownerCtx, a.id);
    await reorderCustomFields(T.ownerCtx, "deal", [b.id, c.id]);
    expect((await getCustomFieldDefs(T.ownerCtx, "deal")).map((d) => d.key)).toEqual(["tier", "budget"]);
  });

  it("agents cannot reorder fields", async () => {
    await expectAppError(reorderCustomFields(T.agentCtx, "deal", []), "FORBIDDEN");
  });
});

describe("tag settings", () => {
  it("counts usage across entities, renames, recolors and deletes", async () => {
    const tag = await createTag(T.ownerCtx, { name: "VIP", color: "#6366f1" });
    const co = await createCompany(T.ownerCtx, companyInputSchema.parse({ name: "Tagged Ltd" }));
    await T.ownerCtx.run((tx) => replaceEntityTags(tx, T.tenant.id, "company", co.id, [tag.id]));
    expect((await tagUsageCounts(T.ownerCtx)).get(tag.id)).toBe(1);

    await updateTag(T.ownerCtx, tag.id, { name: "VIP+", color: "#ef4444" });
    expect((await listTags(T.ownerCtx)).find((x) => x.id === tag.id)).toMatchObject({ name: "VIP+", color: "#ef4444" });

    await expectAppError(updateTag(T.agentCtx, tag.id, { name: "Nope", color: "#000000" }), "FORBIDDEN");
    await expectAppError(updateTag(Other.ownerCtx, tag.id, { name: "Steal", color: "#000000" }), "NOT_FOUND");

    await deleteTag(T.ownerCtx, tag.id);
    expect((await tagUsageCounts(T.ownerCtx)).get(tag.id)).toBeUndefined();
  });
});

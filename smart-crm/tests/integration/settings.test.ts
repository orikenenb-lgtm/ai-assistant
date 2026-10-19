import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, db, schema } from "@/server/db";
import { storage } from "@/server/storage";
import { getOrgSettings, orgProfileSchema, readTenantSettings, removeLogo, updateBrandColor, updateOrgProfile, uploadLogo } from "@/modules/settings/service";
import { integrationSecret, integrationStatus, registerIntegrationTester, saveIntegrationConnection, testIntegrationConnection } from "@/modules/settings/integrations";
import { exportAuditCsv, listAuditLogs, parseAuditQuery } from "@/modules/audit/service";
import { createTeam } from "../support/factories";

type Team = Awaited<ReturnType<typeof createTeam>>;
let T: Team;

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a2c50000000049454e44ae426082", "hex");

const profile = (over: Record<string, unknown> = {}) =>
  orgProfileSchema.parse({
    name: "Settings Co",
    locale: "he",
    timezone: "Asia/Jerusalem",
    currency: "ILS",
    website: "https://kerem.example",
    phone: "03-5555555",
    email: "office@kerem.example",
    address: "רחוב הרצל 1, תל אביב",
    taxId: "514000000",
    vatRatePercent: "18",
    messagesRetentionDays: "",
    aiLogsRetentionDays: "",
    ...over,
  });

beforeAll(async () => {
  T = await createTeam("Settings Co");
});
afterAll(async () => {
  await closeDb();
});

describe("organization profile", () => {
  it("validates input", () => {
    expect(orgProfileSchema.safeParse({ ...profile(), timezone: "Mars/Olympus", vatRatePercent: 18 }).success).toBe(false);
    expect(orgProfileSchema.safeParse({ ...profile(), website: "javascript:alert(1)", vatRatePercent: 18 }).success).toBe(false);
    expect(orgProfileSchema.safeParse({ ...profile(), messagesRetentionDays: 5, vatRatePercent: 18 }).success).toBe(false);
  });

  it("lets owners/managers update the profile, VAT and retention, and audits the change", async () => {
    await updateOrgProfile(T.managerCtx, profile({ name: "כרם טויס בע״מ", vatRatePercent: "17", messagesRetentionDays: "365" }));
    const { tenant, settings } = await getOrgSettings(T.agentCtx);
    expect(tenant.name).toBe("כרם טויס בע״מ");
    expect(settings).toEqual({ defaultVatRateBp: 1700, retention: { messagesDays: 365, aiLogsDays: null } });
    const [a] = await db().select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "org.updated"));
    expect((a.metadata as { changed: string[] }).changed).toContain("name");
  });

  it("denies agents", async () => {
    await expect(updateOrgProfile(T.agentCtx, profile())).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateBrandColor(T.agentCtx, "#112233")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("defaults VAT to 18% when unset", () => {
    expect(readTenantSettings({}).defaultVatRateBp).toBe(1800);
  });
});

describe("branding", () => {
  it("accepts real images only and replaces the previous logo", async () => {
    await expect(uploadLogo(T.ownerCtx, { name: "logo.png", type: "image/png", bytes: Buffer.from("<svg onload=alert(1)>") })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(uploadLogo(T.ownerCtx, { name: "logo.png", type: "image/png", bytes: Buffer.alloc(600 * 1024, 1) })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    const first = await uploadLogo(T.ownerCtx, { name: "logo.png", type: "image/png", bytes: PNG });
    const second = await uploadLogo(T.ownerCtx, { name: "logo2.png", type: "image/png", bytes: PNG });
    await expect(storage().get(first.key)).rejects.toThrow();
    expect((await storage().get(second.key)).equals(PNG)).toBe(true);
    await updateBrandColor(T.ownerCtx, "#4f46e5");
    await removeLogo(T.ownerCtx);
    const [t] = await db().select().from(schema.tenants).where(eq(schema.tenants.id, T.tenant.id));
    expect(t).toMatchObject({ logoPath: null, brandColor: "#4f46e5" });
    await expect(storage().get(second.key)).rejects.toThrow();
  });
});

describe("integrations", () => {
  it("reports provider states without leaking credentials", async () => {
    const cards = await integrationStatus(T.ownerCtx);
    const byKey = Object.fromEntries(cards.map((c) => [c.key, c]));
    expect(byKey.whatsapp.state).toBe("mock");
    expect(byKey.ai.state).toBe("mock");
    expect(JSON.stringify(cards)).not.toContain(process.env.META_APP_SECRET!);
    await expect(integrationStatus(T.agentCtx)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("stores connection secrets encrypted and runs registered connection tests", async () => {
    registerIntegrationTester("greeninvoice", async ({ secret, config }) => ({ ok: secret === "api-secret-1" && config.env === "sandbox" }));
    await saveIntegrationConnection(T.ownerCtx, "greeninvoice", { config: { env: "sandbox" }, secret: "api-secret-1" });
    const [row] = await db().select().from(schema.secrets).where(eq(schema.secrets.tenantId, T.tenant.id));
    expect(row.ciphertext).not.toContain("api-secret-1");
    expect(await integrationSecret(T.tenant.id, "greeninvoice")).toBe("api-secret-1");
    expect(await testIntegrationConnection(T.ownerCtx, "greeninvoice")).toEqual({ ok: true });
    const cards = await integrationStatus(T.ownerCtx);
    expect(cards.find((c) => c.key === "invoicing")).toMatchObject({ state: "connected", detail: { provider: "greeninvoice" } });
  });
});

describe("audit log viewer", () => {
  it("filters by action prefix and is limited to owners/managers", async () => {
    const all = await listAuditLogs(T.ownerCtx, parseAuditQuery({}));
    expect(all.total).toBeGreaterThan(3);
    const org = await listAuditLogs(T.ownerCtx, parseAuditQuery({ action: "org." }));
    expect(org.rows.every((r) => r.action.startsWith("org."))).toBe(true);
    const bogus = await listAuditLogs(T.ownerCtx, parseAuditQuery({ action: "%' or 1=1 --", page: "abc" }));
    expect(bogus.total).toBe(all.total);
    await expect(listAuditLogs(T.agentCtx, parseAuditQuery({}))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("requires the audit_export plan feature for CSV export", async () => {
    await expect(exportAuditCsv(T.ownerCtx, parseAuditQuery({}))).rejects.toMatchObject({ code: "PLAN_REQUIRED" });
    await db().update(schema.subscriptions).set({ planId: "business" }).where(eq(schema.subscriptions.tenantId, T.tenant.id));
    const csv = await exportAuditCsv(T.ownerCtx, parseAuditQuery({ action: "org." }));
    expect(csv.startsWith("﻿created_at,action")).toBe(true);
    expect(csv).toContain("org.updated");
  });
});

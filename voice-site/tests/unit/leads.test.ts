import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseLead } from "@/lib/lead";
import { configuredDestinations, deliverLead } from "@/lib/leads/deliver";

const validInput = { name: "דנה כהן", phone: "050-123-4567", business: "מרפאה", message: "שלום", callback: "morning" };

function lead() {
  const r = parseLead(validInput);
  if (!r.ok) throw new Error("fixture invalid");
  return r.lead;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseLead", () => {
  it("normalizes a valid lead", () => {
    const r = parseLead(validInput);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.spam).toBe(false);
    expect(r.lead.phone).toBe("+972501234567");
    expect(r.lead.phoneDisplay).toBe("050-123-4567");
    expect(r.lead.callback).toBe("morning");
    expect(r.lead.source).toBe("form");
  });

  it("returns Hebrew field errors", () => {
    const r = parseLead({ name: "x", phone: "123" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.name).toBeTruthy();
    expect(r.errors.phone).toContain("טלפון");
  });

  it("flags the honeypot", () => {
    const r = parseLead({ ...validInput, website: "http://spam.example" });
    expect(r.ok && r.spam).toBe(true);
  });

  it("rejects oversized fields and unknown enum values", () => {
    expect(parseLead({ ...validInput, message: "a".repeat(1001) }).ok).toBe(false);
    expect(parseLead({ ...validInput, callback: "midnight" }).ok).toBe(false);
  });
});

describe("deliverLead", () => {
  it("refuses in production when nothing is configured (no silent loss)", async () => {
    const r = await deliverLead(lead(), { NODE_ENV: "production" });
    expect(r.status).toBe("not_configured");
  });

  it("logs in development when nothing is configured", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const r = await deliverLead(lead(), { NODE_ENV: "development" });
    expect(r.status).toBe("delivered");
    expect(info).toHaveBeenCalled();
  });

  it("detects configured destinations", () => {
    expect(
      configuredDestinations({
        LEAD_WEBHOOK_URL: "https://hooks.example/x",
        RESEND_API_KEY: "re_x",
        LEAD_EMAIL_TO: "a@b.co",
        SMART_CRM_API_URL: "https://crm.example/api/v1",
        SMART_CRM_API_KEY: "sck_x",
      }),
    ).toEqual(["webhook", "email", "smart-crm"]);
    expect(configuredDestinations({ RESEND_API_KEY: "re_x" })).toEqual([]);
  });

  it("signs webhook payloads with HMAC", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
    const r = await deliverLead(lead(), { LEAD_WEBHOOK_URL: "https://hooks.example/x", LEAD_WEBHOOK_SECRET: "s3cret" });
    expect(r.status).toBe("delivered");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://hooks.example/x");
    const headers = init!.headers as Record<string, string>;
    const [, t, v1] = /^t=(\d+),v1=([a-f0-9]+)$/.exec(headers["X-Signature"])!;
    const expected = createHmac("sha256", "s3cret").update(`${t}.${init!.body as string}`).digest("hex");
    expect(v1).toBe(expected);
    expect(JSON.parse(init!.body as string).lead.phone).toBe("+972501234567");
  });

  it("counts a lead as delivered when at least one destination works", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      String(input).includes("resend") ? new Response("down", { status: 500 }) : new Response("ok"),
    );
    const r = await deliverLead(lead(), {
      LEAD_WEBHOOK_URL: "https://hooks.example/x",
      RESEND_API_KEY: "re_x",
      LEAD_EMAIL_TO: "team@example.com",
    });
    expect(r.status).toBe("delivered");
    expect(r.outcomes.find((o) => o.destination === "email")?.ok).toBe(false);
  });

  it("fails when every destination fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network"));
    const r = await deliverLead(lead(), { LEAD_WEBHOOK_URL: "https://hooks.example/x" });
    expect(r.status).toBe("failed");
  });

  it("creates a SMART CRM contact and a call-back task", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ data: { id: "c-1" } }, { status: 201 }))
      .mockResolvedValueOnce(Response.json({ data: { id: "t-1" } }, { status: 201 }));
    const r = await deliverLead(lead(), { SMART_CRM_API_URL: "https://crm.example/api/v1/", SMART_CRM_API_KEY: "sck_abc" });
    expect(r.status).toBe("delivered");
    const [contactUrl, contactInit] = fetchMock.mock.calls[0];
    expect(contactUrl).toBe("https://crm.example/api/v1/contacts");
    expect((contactInit!.headers as Record<string, string>).Authorization).toBe("Bearer sck_abc");
    expect(JSON.parse(contactInit!.body as string)).toEqual({
      firstName: "דנה",
      lastName: "כהן",
      phone: "+972501234567",
      lifecycleStage: "lead",
      source: "website",
    });
    const [taskUrl, taskInit] = fetchMock.mock.calls[1];
    expect(taskUrl).toBe("https://crm.example/api/v1/tasks");
    expect(JSON.parse(taskInit!.body as string)).toMatchObject({ contactId: "c-1", priority: "high" });
  });
});

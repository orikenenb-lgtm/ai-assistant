import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { closeDb, db, schema } from "@/server/db";
import { AppError } from "@/server/errors";
import { decryptSecret } from "@/server/crypto";
import { eventInputSchema } from "@/modules/calendar/schemas";
import { createEvent, deleteEvent, eventRange, listCalendarRange, updateEvent } from "@/modules/calendar/service";
import { calendarSyncEnabled, disconnect, listMyConnections, saveConnection, syncConnection } from "@/modules/calendar/connections";
import { GoogleCalendarProvider, MockCalendarProvider } from "@/modules/calendar/providers";
import { addDays, dateKey, parseLocalInput, startOfDay, startOfWeek, toLocalInput, zonedToUtc } from "@/modules/calendar/tz";
import { taskInputSchema } from "@/modules/tasks/schemas";
import { createTask } from "@/modules/tasks/service";
import { createTeam } from "../support/factories";

const TZ = "Asia/Jerusalem";
type Team = Awaited<ReturnType<typeof createTeam>>;
let T: Team;
let Other: Team;

const ev = (v: Record<string, unknown>) => eventInputSchema.parse(v);

async function expectAppError(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code);
}

beforeAll(async () => {
  T = await createTeam("Calendar Co");
  Other = await createTeam("Other Calendar Co");
});
afterAll(async () => {
  await closeDb();
});

describe("time zone arithmetic (Asia/Jerusalem)", () => {
  it("converts wall-clock times on both sides of the DST changes", () => {
    expect(zonedToUtc(2026, 3, 26, 12, 0, TZ).toISOString()).toBe("2026-03-26T10:00:00.000Z"); // UTC+2
    expect(zonedToUtc(2026, 3, 28, 12, 0, TZ).toISOString()).toBe("2026-03-28T09:00:00.000Z"); // UTC+3
    expect(zonedToUtc(2026, 10, 24, 12, 0, TZ).toISOString()).toBe("2026-10-24T09:00:00.000Z"); // UTC+3
    expect(zonedToUtc(2026, 10, 26, 12, 0, TZ).toISOString()).toBe("2026-10-26T10:00:00.000Z"); // UTC+2
  });

  it("handles the skipped and repeated hours", () => {
    // 02:30 does not exist on 2026-03-27 (clocks jump 02:00 → 03:00).
    expect(toLocalInput(zonedToUtc(2026, 3, 27, 2, 30, TZ), TZ)).toBe("2026-03-27T03:30");
    // 01:30 happens twice on 2026-10-25; the earlier (daylight) instant wins.
    expect(zonedToUtc(2026, 10, 25, 1, 30, TZ).toISOString()).toBe("2026-10-24T22:30:00.000Z");
  });

  it("has 25-hour and 23-hour days and stable day keys", () => {
    const fallBack = startOfDay("2026-10-25", TZ);
    expect(startOfDay("2026-10-26", TZ).getTime() - fallBack.getTime()).toBe(25 * 3_600_000);
    expect(startOfDay("2026-03-28", TZ).getTime() - startOfDay("2026-03-27", TZ).getTime()).toBe(23 * 3_600_000);
    expect(dateKey(new Date("2026-10-24T21:30:00Z"), TZ)).toBe("2026-10-25");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(startOfWeek("2026-10-22")).toBe("2026-10-18"); // Thursday → Sunday
    expect(parseLocalInput("2026-02-30T10:00", TZ)).toBeNull();
  });
});

describe("calendar events", () => {
  it("stores all-day events as whole local days (end exclusive)", () => {
    const r = eventRange({ allDay: true, start: "2026-10-25", end: "2026-10-25" }, TZ);
    expect(r.startsAt.toISOString()).toBe("2026-10-24T21:00:00.000Z");
    expect(r.endsAt.toISOString()).toBe("2026-10-25T22:00:00.000Z");
    expect(() => eventRange({ allDay: false, start: "2026-10-25T10:00", end: "2026-10-25T09:00" }, TZ)).toThrow(AppError);
  });

  it("creates, lists by range (incl. across the DST boundary), updates and deletes", async () => {
    const meeting = await createEvent(T.agentCtx, ev({ title: "פגישה עם ספק", start: "2026-10-25T00:30", end: "2026-10-25T03:00", location: "חיפה" }));
    expect(meeting.ownerId).toBe(T.agent.id);
    // 00:30 local (UTC+3) → 21:30Z the previous UTC day; 03:00 local after fall-back (UTC+2) → 01:00Z.
    expect(meeting.startsAt.toISOString()).toBe("2026-10-24T21:30:00.000Z");
    expect(meeting.endsAt.toISOString()).toBe("2026-10-25T01:00:00.000Z");

    const day = await listCalendarRange(T.agentCtx, startOfDay("2026-10-25", TZ), startOfDay("2026-10-26", TZ));
    expect(day.events.map((e) => e.id)).toContain(meeting.id);
    const previousDay = await listCalendarRange(T.agentCtx, startOfDay("2026-10-24", TZ), startOfDay("2026-10-25", TZ));
    expect(previousDay.events.map((e) => e.id)).not.toContain(meeting.id);

    await updateEvent(T.agentCtx, meeting.id, ev({ title: "פגישה עם ספק (עודכן)", allDay: true, start: "2026-10-26", end: "2026-10-27" }));
    const later = await listCalendarRange(T.agentCtx, startOfDay("2026-10-27", TZ), startOfDay("2026-10-28", TZ));
    expect(later.events.find((e) => e.id === meeting.id)).toMatchObject({ allDay: true, title: "פגישה עם ספק (עודכן)" });

    await deleteEvent(T.agentCtx, meeting.id);
    const gone = await listCalendarRange(T.agentCtx, startOfDay("2026-10-20", TZ), startOfDay("2026-11-01", TZ));
    expect(gone.events.map((e) => e.id)).not.toContain(meeting.id);
  });

  it("includes tasks with due dates in range", async () => {
    const task = await createTask(T.agentCtx, taskInputSchema.parse({ title: "משימה ביומן", dueAt: "2026-11-03T10:00" }));
    const r = await listCalendarRange(T.agentCtx, startOfDay("2026-11-01", TZ), startOfDay("2026-11-08", TZ));
    expect(r.tasks.map((t) => t.id)).toContain(task.id);
  });

  it("only owners/creators or managers may edit; links must belong to the tenant; tenants are isolated", async () => {
    const mine = await createEvent(T.managerCtx, ev({ title: "של המנהל", start: "2026-11-02T09:00", end: "2026-11-02T10:00" }));
    await expectAppError(updateEvent(T.agentCtx, mine.id, ev({ title: "x", start: "2026-11-02T09:00", end: "2026-11-02T10:00" })), "FORBIDDEN");
    await expectAppError(deleteEvent(T.agentCtx, mine.id), "FORBIDDEN");
    await deleteEvent(T.ownerCtx, mine.id);

    const [foreignContact] = await db().insert(schema.contacts).values({ tenantId: Other.tenant.id, firstName: "Foreign" }).returning();
    await expectAppError(createEvent(T.agentCtx, ev({ title: "x", start: "2026-11-02T09:00", end: "2026-11-02T10:00", contactId: foreignContact.id })), "VALIDATION");
    await expectAppError(createEvent(T.agentCtx, ev({ title: "x", start: "2026-11-02T09:00", end: "2026-11-02T10:00", ownerId: T.manager.id })), "FORBIDDEN");

    const foreign = await createEvent(Other.ownerCtx, ev({ title: "Foreign", start: "2026-11-02T09:00", end: "2026-11-02T10:00" }));
    const range = await listCalendarRange(T.ownerCtx, startOfDay("2026-11-01", TZ), startOfDay("2026-11-08", TZ));
    expect(range.events.map((e) => e.id)).not.toContain(foreign.id);
    await expectAppError(deleteEvent(T.ownerCtx, foreign.id), "NOT_FOUND");
  });

  it("rejects ranges over 100 days", async () => {
    await expectAppError(listCalendarRange(T.ownerCtx, startOfDay("2026-01-01", TZ), startOfDay("2026-06-01", TZ)), "VALIDATION");
  });
});

describe("external calendar architecture", () => {
  it("is disabled by default via the calendar.sync flag", async () => {
    expect(await calendarSyncEnabled(T.tenant.id)).toBe(false);
  });

  it("stores tokens encrypted and syncs idempotently from a provider", async () => {
    const provider = new MockCalendarProvider();
    const tokens = await provider.exchangeCode("mock-code");
    const id = await saveConnection(T.agentCtx, "google", tokens);
    const [conn] = await db().select().from(schema.calendarConnections).where(eq(schema.calendarConnections.id, id));
    const [secret] = await db().select().from(schema.secrets).where(eq(schema.secrets.id, conn.secretId!));
    expect(secret.ciphertext).not.toContain("mock-access");
    expect(JSON.parse(decryptSecret(secret.ciphertext, `calendar:${T.tenant.id}:${T.agent.id}:google`)).accessToken).toBe("mock-access");

    const extId = await provider.upsertEvent(tokens, {
      title: "Imported",
      description: null,
      location: null,
      startsAt: new Date("2026-11-05T08:00:00Z"),
      endsAt: new Date("2026-11-05T09:00:00Z"),
      allDay: false,
    });
    const range = { from: new Date("2026-11-01T00:00:00Z"), to: new Date("2026-11-30T00:00:00Z") };
    expect(await syncConnection(id, provider, range)).toBe(1);
    expect(await syncConnection(id, provider, range)).toBe(1);
    const imported = await db().execute<{ n: number }>(
      sql`select count(*)::int as n from public.calendar_events where tenant_id = ${T.tenant.id} and external_id = ${extId}`,
    );
    expect(Number(imported[0].n)).toBe(1);
    await provider.deleteEvent(tokens, extId);
    await syncConnection(id, provider, range);
    const afterDelete = await db().execute<{ n: number }>(
      sql`select count(*)::int as n from public.calendar_events where tenant_id = ${T.tenant.id} and external_id = ${extId}`,
    );
    expect(Number(afterDelete[0].n)).toBe(0);

    expect((await listMyConnections(T.agentCtx)).map((c) => c.id)).toEqual([id]);
    expect(await listMyConnections(T.managerCtx)).toEqual([]);
    await disconnect(T.agentCtx, id);
    expect(await listMyConnections(T.agentCtx)).toEqual([]);
    const [orphan] = await db().select().from(schema.secrets).where(eq(schema.secrets.id, conn.secretId!));
    expect(orphan).toBeUndefined();
  });

  it("builds Google OAuth/API requests without a network (mocked fetch)", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fake = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).includes("oauth2.googleapis.com")) {
        return new Response(JSON.stringify({ access_token: "at", refresh_token: "rt", expires_in: 3600, scope: "s" }), { status: 200 });
      }
      return new Response(JSON.stringify({ items: [{ id: "g1", summary: "Standup", start: { dateTime: "2026-11-05T08:00:00Z" }, end: { dateTime: "2026-11-05T08:15:00Z" } }] }), { status: 200 });
    }) as typeof fetch;
    const g = new GoogleCalendarProvider("client", "secret", fake);
    const auth = new URL(g.authUrl("state123", "https://app.example/cb"));
    expect(auth.searchParams.get("access_type")).toBe("offline");
    expect(auth.searchParams.get("state")).toBe("state123");
    const tokens = await g.exchangeCode("code", "https://app.example/cb");
    expect(tokens).toMatchObject({ accessToken: "at", refreshToken: "rt" });
    const events = await g.listEvents(tokens, { from: new Date("2026-11-01Z"), to: new Date("2026-11-30Z") });
    expect(events).toEqual([expect.objectContaining({ externalId: "g1", title: "Standup", allDay: false })]);
    expect(calls[1].url).toContain("/calendars/primary/events?");
    expect((calls[1].init?.headers as Record<string, string>).Authorization).toBe("Bearer at");
  });
});

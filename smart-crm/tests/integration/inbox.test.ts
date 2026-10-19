import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { closeDb, db, schema } from "@/server/db";
import { AppError } from "@/server/errors";
import { drainJobs } from "@/server/jobs/runner";
import "@/modules/whatsapp/jobs";
import { connectAccount, type AccountView } from "@/modules/whatsapp/accounts";
import { ingestWhatsAppWebhook } from "@/modules/whatsapp/webhook";
import { buildInboundPayload } from "@/modules/whatsapp/simulator";
import { metaSignature } from "@/modules/whatsapp/signature";
import {
  addConversationNote,
  assignConversation,
  conversationFilterSchema,
  getThread,
  inboxCounts,
  listConversations,
  openConversationForContact,
  setConversationStatus,
  setHandoff,
} from "@/modules/inbox/service";
import { serviceWindow } from "@/modules/inbox/window";
import { renderTemplate, templateParts } from "@/modules/inbox/templates";
import { createTeam } from "../support/factories";

type Team = Awaited<ReturnType<typeof createTeam>>;
let T: Team;
let acc: AccountView;
let convId: string;
const from = `+97252${String(Date.now()).slice(-7)}`;

async function expectAppError(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code);
}

beforeAll(async () => {
  T = await createTeam("Inbox Co");
  acc = await connectAccount(T.ownerCtx, {
    provider: "mock",
    displayName: "Inbox",
    phoneNumber: "+972500000010",
    phoneNumberId: `pnI${Date.now().toString(36)}`,
    wabaId: "waba_i",
    sendRatePerMinute: 60,
  });
  const raw = JSON.stringify(buildInboundPayload(acc, { fromPhone: from, name: "יעל", text: "שלום" }));
  await ingestWhatsAppWebhook(raw, metaSignature(raw, process.env.META_APP_SECRET!));
  await drainJobs({ workerId: "t", types: ["whatsapp.process_webhook"] });
  const [c] = await db().select().from(schema.conversations).where(eq(schema.conversations.tenantId, T.tenant.id));
  convId = c.id;
});
afterAll(async () => {
  await closeDb();
});

describe("pure helpers", () => {
  it("computes the 24-hour window", () => {
    const now = Date.now();
    expect(serviceWindow(null)).toEqual({ open: false, closesAt: null });
    expect(serviceWindow(new Date(now - 3600_000), now).open).toBe(true);
    expect(serviceWindow(new Date(now - 25 * 3600_000), now).open).toBe(false);
  });
  it("renders templates with parameters", () => {
    const components = [
      { type: "HEADER", format: "TEXT", text: "הזמנה {{1}}" },
      { type: "BODY", text: "היי {{1}}, ההזמנה {{2}} מוכנה" },
      { type: "FOOTER", text: "תודה" },
    ];
    expect(templateParts(components)).toMatchObject({ headerParams: 1, bodyParams: 2 });
    expect(renderTemplate(components, { header: ["#7"], body: ["דנה", "#7"] })).toBe("הזמנה #7\nהיי דנה, ההזמנה #7 מוכנה\nתודה");
  });
});

describe("inbox service", () => {
  it("lists conversations with filters and marks a thread read", async () => {
    const all = await listConversations(T.agentCtx, conversationFilterSchema.parse({}));
    expect(all.items.map((i) => i.id)).toContain(convId);
    expect(all.items[0]).toMatchObject({ contactName: "יעל", unreadCount: 1, accountName: "Inbox" });
    const unassigned = await listConversations(T.agentCtx, conversationFilterSchema.parse({ assignee: "unassigned" }));
    expect(unassigned.items.map((i) => i.id)).toContain(convId);
    const mine = await listConversations(T.agentCtx, conversationFilterSchema.parse({ assignee: "mine" }));
    expect(mine.items).toEqual([]);
    expect(await inboxCounts(T.agentCtx)).toMatchObject({ unread: 1, unassigned: 1 });

    const thread = await getThread(T.agentCtx, convId, { markRead: true });
    expect(thread.messages.map((m) => m.body)).toEqual(["שלום"]);
    expect(thread.window.open).toBe(true);
    expect(thread.contact).toMatchObject({ name: "יעל", phone: from, consent: "unknown" });
    const [c] = await db().select().from(schema.conversations).where(eq(schema.conversations.id, convId));
    expect(c.unreadCount).toBe(0);
    const [{ n }] = await db().execute<{ n: number }>(
      sql`select count(*)::int as n from public.jobs where type = 'whatsapp.mark_read' and payload->>'conversationId' = ${convId}`,
    );
    expect(n).toBe(1);
  });

  it("agents may only take conversations for themselves; managers assign anyone", async () => {
    await expectAppError(assignConversation(T.agentCtx, convId, T.manager.id), "FORBIDDEN");
    await assignConversation(T.agentCtx, convId, T.agent.id);
    await assignConversation(T.managerCtx, convId, T.manager.id);
    // Agents cannot take over or release a conversation someone else owns.
    await expectAppError(assignConversation(T.agentCtx, convId, T.agent.id), "FORBIDDEN");
    await expectAppError(assignConversation(T.agentCtx, convId, null), "FORBIDDEN");
    await assignConversation(T.managerCtx, convId, T.agent.id);
    const [c] = await db().select().from(schema.conversations).where(eq(schema.conversations.id, convId));
    expect(c.assigneeId).toBe(T.agent.id);
    const audits = await db()
      .select()
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.entityId, convId), eq(schema.auditLogs.action, "conversation.assigned")));
    expect(audits.length).toBeGreaterThanOrEqual(2);
    const assignedNote = await db()
      .select()
      .from(schema.notifications)
      .where(and(eq(schema.notifications.userId, T.agent.id), eq(schema.notifications.type, "conversation_assigned")));
    expect(assignedNote.length).toBeGreaterThan(0);
    await expectAppError(assignConversation(T.managerCtx, convId, (await createTeam("Outsider Co")).owner.id), "VALIDATION");
  });

  it("adds internal notes that never become messages", async () => {
    await addConversationNote(T.agentCtx, convId, "לקוחה חשובה — לטפל עד הצהריים");
    const thread = await getThread(T.agentCtx, convId);
    expect(thread.notes.map((n) => n.body)).toEqual(["לקוחה חשובה — לטפל עד הצהריים"]);
    expect(thread.messages).toHaveLength(1);
  });

  it("changes status and handoff, emitting conversation.closed", async () => {
    await setHandoff(T.agentCtx, convId, "bot");
    await setConversationStatus(T.agentCtx, convId, "closed");
    const [c] = await db().select().from(schema.conversations).where(eq(schema.conversations.id, convId));
    expect(c).toMatchObject({ status: "closed", handoffState: "bot" });
    expect(c.closedAt).not.toBeNull();
    const [{ n }] = await db().execute<{ n: number }>(
      sql`select count(*)::int as n from public.jobs where type = 'events.dispatch' and payload->>'type' = 'conversation.closed' and payload->>'entityId' = ${convId}`,
    );
    expect(n).toBe(1);
  });

  it("opens (or creates) a conversation for a contact deep link", async () => {
    const [contact] = await db()
      .insert(schema.contacts)
      .values({ tenantId: T.tenant.id, firstName: "חדש", phone: "+972541234567" })
      .returning();
    const id1 = await openConversationForContact(T.agentCtx, contact.id);
    const id2 = await openConversationForContact(T.agentCtx, contact.id);
    expect(id1).toBe(id2);
    const [noPhone] = await db().insert(schema.contacts).values({ tenantId: T.tenant.id, firstName: "בלי טלפון" }).returning();
    await expectAppError(openConversationForContact(T.agentCtx, noPhone.id), "PRECONDITION");
    const other = await createTeam("Other Inbox");
    await expectAppError(openConversationForContact(other.ownerCtx, contact.id), "NOT_FOUND");
  });

  it("support (read-only) contexts can read but not change conversations", async () => {
    const ro = { ...T.agentCtx, readOnly: true };
    await expect(getThread(ro, convId)).resolves.toBeDefined();
    await expectAppError(addConversationNote(ro, convId, "x"), "READ_ONLY");
    await expectAppError(setConversationStatus(ro, convId, "open"), "READ_ONLY");
  });
});

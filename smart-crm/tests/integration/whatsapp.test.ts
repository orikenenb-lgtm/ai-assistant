import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { closeDb, db, schema } from "@/server/db";
import { decryptSecret } from "@/server/crypto";
import { AppError } from "@/server/errors";
import { drainJobs } from "@/server/jobs/runner";
import "@/modules/whatsapp/jobs";
import { __setProviderFactoryForTests, connectAccount, syncTemplates, type AccountView } from "@/modules/whatsapp/accounts";
import { metaSignature, verifyMetaSignature } from "@/modules/whatsapp/signature";
import { ingestWhatsAppWebhook, mapInbound } from "@/modules/whatsapp/webhook";
import { buildInboundPayload, buildStatusPayload } from "@/modules/whatsapp/simulator";
import { isOptOut, wantsHuman } from "@/modules/whatsapp/keywords";
import { classifyMetaError, WhatsAppProviderError, type WhatsAppProvider } from "@/modules/whatsapp/provider";
import { MockWhatsAppProvider } from "@/modules/whatsapp/mock-provider";
import { getThread, listConversations, conversationFilterSchema, sendMessage } from "@/modules/inbox/service";
import { GET as webhookGET, POST as webhookPOST } from "@/app/api/webhooks/whatsapp/route";
import { createTeam } from "../support/factories";

type Team = Awaited<ReturnType<typeof createTeam>>;
const SECRET = process.env.META_APP_SECRET!;
const WA_JOBS = ["whatsapp.process_webhook", "whatsapp.send", "whatsapp.download_media", "whatsapp.mark_read"];

let A: Team;
let B: Team;
let accA: AccountView;
let accB: AccountView;
let seq = 0;

const uniquePnid = (p: string) => `${p}${Date.now().toString(36)}${seq++}`;
const phone = () => `+97250${String(1000000 + Math.floor(Math.random() * 8999999)).slice(0, 7)}`;

async function deliver(payload: object) {
  const raw = JSON.stringify(payload);
  const r = await ingestWhatsAppWebhook(raw, metaSignature(raw, SECRET));
  await drainJobs({ workerId: "test", types: WA_JOBS });
  return r;
}

async function inbound(acc: AccountView, from: string, text: string, extra: Partial<Parameters<typeof buildInboundPayload>[1]> = {}) {
  return deliver(buildInboundPayload(acc, { fromPhone: from, name: "דנה לוי", text, ...extra }));
}

async function conversationFor(team: Team, from: string) {
  const [row] = await db()
    .select({ c: schema.conversations })
    .from(schema.conversations)
    .innerJoin(schema.contacts, eq(schema.contacts.id, schema.conversations.contactId))
    .where(and(eq(schema.conversations.tenantId, team.tenant.id), eq(schema.contacts.phone, from)));
  return row?.c;
}

async function expectAppError(p: Promise<unknown>, code: string, message?: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code && (!message || e.message === message));
}

beforeAll(async () => {
  A = await createTeam("WA Tenant A");
  B = await createTeam("WA Tenant B");
  accA = await connectAccount(A.ownerCtx, { provider: "mock", displayName: "Kerem WA", phoneNumber: "+972500000001", phoneNumberId: uniquePnid("pnA"), wabaId: "waba_a", sendRatePerMinute: 60 });
  accB = await connectAccount(B.ownerCtx, { provider: "mock", displayName: "Other WA", phoneNumber: "+972500000002", phoneNumberId: uniquePnid("pnB"), wabaId: "waba_b", sendRatePerMinute: 60 });
  await syncTemplates(A.ownerCtx, accA.id);
});

afterEach(() => __setProviderFactoryForTests(null));
afterAll(async () => {
  await closeDb();
});

describe("pure helpers", () => {
  it("verifies Meta signatures timing-safely", () => {
    const raw = '{"a":1}';
    expect(verifyMetaSignature(raw, metaSignature(raw, SECRET), SECRET)).toBe(true);
    expect(verifyMetaSignature(raw + " ", metaSignature(raw, SECRET), SECRET)).toBe(false);
    expect(verifyMetaSignature(raw, metaSignature(raw, "other"), SECRET)).toBe(false);
    expect(verifyMetaSignature(raw, null, SECRET)).toBe(false);
    expect(verifyMetaSignature(raw, "sha256=zz", SECRET)).toBe(false);
    expect(verifyMetaSignature(raw, metaSignature(raw, SECRET), undefined)).toBe(false);
  });
  it("recognizes opt-out and handoff keywords in Hebrew and English", () => {
    for (const t of ["STOP", " הסר ", "הסרה!", "עצור", "unsubscribe"]) expect(isOptOut(t)).toBe(true);
    for (const t of ["אל תסיר אותי מהרשימה בבקשה", "stop by tomorrow", ""]) expect(isOptOut(t)).toBe(false);
    expect(wantsHuman("אפשר לדבר עם נציג?")).toBe(true);
    expect(wantsHuman("Agent")).toBe(true);
    expect(wantsHuman("שלום")).toBe(false);
  });
  it("classifies Meta errors", () => {
    expect(classifyMetaError(400, "131047")).toBe("permanent");
    expect(classifyMetaError(400, "130429")).toBe("rate_limited");
    expect(classifyMetaError(503, null)).toBe("retryable");
    expect(classifyMetaError(400, "131026")).toBe("permanent");
  });
  it("maps inbound message types", () => {
    expect(mapInbound({ id: "x", from: "1", type: "text", text: { body: "hi" } })).toMatchObject({ type: "text", body: "hi" });
    expect(mapInbound({ id: "x", from: "1", type: "image", image: { id: "m1", mime_type: "image/jpeg", caption: "c" } })).toMatchObject({
      type: "image",
      body: "c",
      media: { mediaId: "m1", mimeType: "image/jpeg" },
    });
    expect(mapInbound({ id: "x", from: "1", type: "order" }).type).toBe("unsupported");
  });
});

describe("webhook endpoint", () => {
  it("answers the GET verification handshake only with the right token", async () => {
    const ok = await webhookGET(new NextRequest(`http://localhost/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${process.env.META_WEBHOOK_VERIFY_TOKEN}&hub.challenge=12345`));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("12345");
    const bad = await webhookGET(new NextRequest("http://localhost/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1"));
    expect(bad.status).toBe(403);
  });

  it("rejects unsigned or badly signed POSTs and accepts signed ones", async () => {
    const raw = JSON.stringify(buildInboundPayload(accA, { fromPhone: phone(), text: "signed?" }));
    const post = (sig?: string) =>
      webhookPOST(new NextRequest("http://localhost/api/webhooks/whatsapp", { method: "POST", body: raw, headers: sig ? { "x-hub-signature-256": sig } : {} }));
    expect((await post()).status).toBe(401);
    expect((await post(metaSignature(raw, "wrong-secret"))).status).toBe(401);
    expect((await post(metaSignature(raw, SECRET))).status).toBe(200);
  });

  it("deduplicates redelivered events and messages", async () => {
    const from = phone();
    const payload = buildInboundPayload(accA, { fromPhone: from, text: "שלום", waMessageId: `wamid.DUP.${Date.now()}` });
    const first = await deliver(payload);
    const second = await deliver(payload);
    expect(first.eventId).toBeDefined();
    expect(second.duplicate).toBe(true);
    // Same message id in a different envelope (Meta retry with new batch) → still one message.
    await deliver({ ...payload, entry: [...payload.entry!, { id: "noop", changes: [] }] });
    const conv = await conversationFor(A, from);
    const msgs = await db().select().from(schema.messages).where(eq(schema.messages.conversationId, conv!.id));
    expect(msgs).toHaveLength(1);
  });
});

describe("inbound processing", () => {
  it("creates contact, conversation and message, updates summary and timeline", async () => {
    const from = phone();
    await inbound(accA, from, "היי, יש לכם קטלוג?");
    const [contact] = await db().select().from(schema.contacts).where(and(eq(schema.contacts.tenantId, A.tenant.id), eq(schema.contacts.phone, from)));
    expect(contact).toMatchObject({ firstName: "דנה", lastName: "לוי", source: "whatsapp" });
    const conv = await conversationFor(A, from);
    expect(conv).toMatchObject({ status: "open", unreadCount: 1, lastMessagePreview: "היי, יש לכם קטלוג?" });
    expect(conv!.lastInboundAt).not.toBeNull();
    const activities = await db().select().from(schema.activities).where(eq(schema.activities.contactId, contact.id));
    expect(activities.map((a) => a.type).sort()).toEqual(["contact_created", "whatsapp_in"]);
    const [{ n }] = await db().execute<{ n: number }>(
      sql`select count(*)::int as n from public.jobs where type = 'events.dispatch' and payload->>'type' = 'message.received' and payload->>'tenantId' = ${A.tenant.id}`,
    );
    expect(n).toBeGreaterThan(0);
    // Managers are notified about a brand-new unassigned conversation.
    const notes = await db().select().from(schema.notifications).where(and(eq(schema.notifications.tenantId, A.tenant.id), eq(schema.notifications.type, "message_received")));
    expect(notes.length).toBeGreaterThan(0);

    // Second message: same conversation, unread grows; closed conversations reopen.
    await db().update(schema.conversations).set({ status: "closed" }).where(eq(schema.conversations.id, conv!.id));
    await inbound(accA, from, "?");
    const again = await conversationFor(A, from);
    expect(again).toMatchObject({ id: conv!.id, status: "open", unreadCount: 2 });
  });

  it("routes by phone_number_id: tenants never see each other's messages", async () => {
    const from = phone();
    await inbound(accB, from, "for tenant B only");
    expect(await conversationFor(A, from)).toBeUndefined();
    expect(await conversationFor(B, from)).toBeDefined();
    const list = await listConversations(A.ownerCtx, conversationFilterSchema.parse({ q: from.slice(-7) }));
    expect(list.items).toEqual([]);
    const bConv = await conversationFor(B, from);
    await expectAppError(getThread(A.ownerCtx, bConv!.id), "NOT_FOUND");
  });

  it("ignores events for unknown phone numbers", async () => {
    const r = await deliver(buildInboundPayload({ phoneNumberId: "unknown_pnid", phoneNumber: "+972500000009", wabaId: "x" }, { fromPhone: phone(), text: "?" }));
    const [ev] = await db().select().from(schema.webhookEvents).where(eq(schema.webhookEvents.id, r.eventId!));
    expect(ev.status).toBe("ignored");
  });

  it("downloads inbound media into private storage", async () => {
    const from = phone();
    await inbound(accA, from, "תמונה", { kind: "image" });
    const conv = await conversationFor(A, from);
    const [msg] = await db().select().from(schema.messages).where(eq(schema.messages.conversationId, conv!.id));
    expect(msg.type).toBe("image");
    expect((msg.media as { storageKey?: string }).storageKey).toMatch(new RegExp(`^${A.tenant.id}/whatsapp/`));
  });

  it("opt-out keyword records consent and blocks every outbound message", async () => {
    const from = phone();
    await inbound(accA, from, "הסר");
    const conv = await conversationFor(A, from);
    const [contact] = await db().select().from(schema.contacts).where(eq(schema.contacts.id, conv!.contactId));
    expect(contact.whatsappConsent).toBe("opted_out");
    const [consent] = await db().select().from(schema.contactConsents).where(eq(schema.contactConsents.contactId, contact.id));
    expect(consent).toMatchObject({ status: "opted_out", source: "inbound_keyword" });
    await expectAppError(sendMessage(A.agentCtx, conv!.id, { kind: "text", text: "רק עוד הודעה" }), "PRECONDITION", "inbox.optedOut");
  });

  it("handoff keyword flags the conversation for a human", async () => {
    const from = phone();
    await inbound(accA, from, "אני רוצה לדבר עם נציג");
    expect(await conversationFor(A, from)).toMatchObject({ needsAttention: true, handoffState: "human" });
  });
});

describe("outbound messages", () => {
  async function freshConversation() {
    const from = phone();
    await inbound(accA, from, "שלום");
    return (await conversationFor(A, from))!;
  }

  it("sends a reply, records usage, and only moves statuses forward", async () => {
    const conv = await freshConversation();
    const { id } = await sendMessage(A.agentCtx, conv.id, { kind: "text", text: "שלום! איך אפשר לעזור?" });
    await drainJobs({ workerId: "test", types: WA_JOBS });
    let [m] = await db().select().from(schema.messages).where(eq(schema.messages.id, id));
    expect(m).toMatchObject({ status: "sent", senderType: "user", senderUserId: A.agent.id });
    expect(m.waMessageId).toMatch(/^wamid\.MOCK\./);
    const usage = await db().select().from(schema.usageEvents).where(eq(schema.usageEvents.refId, id));
    expect(usage).toHaveLength(1);

    const [contact] = await db().select().from(schema.contacts).where(eq(schema.contacts.id, conv.contactId));
    await deliver(buildStatusPayload(accA, { waMessageId: m.waMessageId!, recipientPhone: contact.phone!, status: "read" }));
    await deliver(buildStatusPayload(accA, { waMessageId: m.waMessageId!, recipientPhone: contact.phone!, status: "delivered" }));
    await deliver(buildStatusPayload(accA, { waMessageId: m.waMessageId!, recipientPhone: contact.phone!, status: "failed" }));
    [m] = await db().select().from(schema.messages).where(eq(schema.messages.id, id));
    expect(m.status).toBe("read");
    expect(m.deliveredAt).not.toBeNull();
    expect(m.readAt).not.toBeNull();
  });

  it("is idempotent per client key", async () => {
    const conv = await freshConversation();
    const a = await sendMessage(A.agentCtx, conv.id, { kind: "text", text: "once" }, { clientKey: `ck-${conv.id}` });
    const b = await sendMessage(A.agentCtx, conv.id, { kind: "text", text: "once" }, { clientKey: `ck-${conv.id}` });
    expect(b).toEqual({ id: a.id, duplicate: true });
  });

  it("enforces the 24-hour window and template rules", async () => {
    const conv = await freshConversation();
    await db().update(schema.conversations).set({ lastInboundAt: new Date(Date.now() - 25 * 3600_000) }).where(eq(schema.conversations.id, conv.id));
    await expectAppError(sendMessage(A.agentCtx, conv.id, { kind: "text", text: "late" }), "PRECONDITION", "inbox.windowClosed");

    const templates = await db().select().from(schema.messageTemplates).where(eq(schema.messageTemplates.whatsappAccountId, accA.id));
    const welcome = templates.find((t) => t.name === "welcome_message")!;
    const pending = templates.find((t) => t.name === "seasonal_promo")!;
    await expectAppError(sendMessage(A.agentCtx, conv.id, { kind: "template", templateId: pending.id, headerParams: [], bodyParams: ["20%"] }), "PRECONDITION", "inbox.templateNotApproved");
    await expectAppError(sendMessage(A.agentCtx, conv.id, { kind: "template", templateId: welcome.id, headerParams: [], bodyParams: [] }), "VALIDATION", "inbox.templateParams");
    const { id } = await sendMessage(A.agentCtx, conv.id, { kind: "template", templateId: welcome.id, headerParams: [], bodyParams: ["דנה"] });
    await drainJobs({ workerId: "test", types: WA_JOBS });
    const [m] = await db().select().from(schema.messages).where(eq(schema.messages.id, id));
    expect(m).toMatchObject({ type: "template", status: "sent", body: "שלום דנה, תודה שפנית אלינו! איך נוכל לעזור?" });

    // Marketing templates need explicit opt-in.
    await db().update(schema.messageTemplates).set({ status: "APPROVED" }).where(eq(schema.messageTemplates.id, pending.id));
    await expectAppError(sendMessage(A.agentCtx, conv.id, { kind: "template", templateId: pending.id, headerParams: [], bodyParams: ["20%"] }), "PRECONDITION", "inbox.marketingNeedsOptIn");
  });

  it("applies the monthly WhatsApp quota", async () => {
    const team = await createTeam("Quota Co");
    const acc = await connectAccount(team.ownerCtx, { provider: "mock", displayName: "Q", phoneNumber: "+972500000003", phoneNumberId: uniquePnid("pnQ"), wabaId: "waba_t", sendRatePerMinute: 60 });
    await db().insert(schema.tenantPlanOverrides).values({ tenantId: team.tenant.id, limits: { whatsapp_messages_monthly: 1 } });
    const from = phone();
    await inbound(acc, from, "hi");
    const conv = (await conversationFor(team, from))!;
    await sendMessage(team.ownerCtx, conv.id, { kind: "text", text: "1" });
    await drainJobs({ workerId: "test", types: WA_JOBS });
    await expectAppError(sendMessage(team.ownerCtx, conv.id, { kind: "text", text: "2" }), "QUOTA_EXCEEDED");
  });

  it("throttles per account in the worker without failing messages", async () => {
    const team = await createTeam("Rate Co");
    const acc = await connectAccount(team.ownerCtx, { provider: "mock", displayName: "R", phoneNumber: "+972500000004", phoneNumberId: uniquePnid("pnR"), wabaId: "waba_t", sendRatePerMinute: 1 });
    const from = phone();
    await inbound(acc, from, "hi");
    const conv = (await conversationFor(team, from))!;
    const a = await sendMessage(team.ownerCtx, conv.id, { kind: "text", text: "1" });
    const b = await sendMessage(team.ownerCtx, conv.id, { kind: "text", text: "2" });
    await drainJobs({ workerId: "test", types: WA_JOBS });
    const rows = await db().select().from(schema.messages).where(eq(schema.messages.conversationId, conv.id));
    expect(rows.find((r) => r.id === a.id)!.status).toBe("sent");
    expect(rows.find((r) => r.id === b.id)!.status).toBe("queued");
    const [job] = await db().select().from(schema.jobs).where(eq(schema.jobs.idempotencyKey, `wa-send:${b.id}`));
    expect(job.status).toBe("queued");
    expect(job.attempts).toBe(0);
    expect(job.runAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("maps provider failures: permanent → failed + dead letter, transient → retry", async () => {
    const conv = await freshConversation();
    const failing = (kind: "permanent" | "retryable", code: string): WhatsAppProvider =>
      Object.assign(new MockWhatsAppProvider(), {
        sendText: async () => {
          throw new WhatsAppProviderError(`simulated ${code}`, kind, code, 400);
        },
      });

    __setProviderFactoryForTests(() => failing("permanent", "131047"));
    const p = await sendMessage(A.agentCtx, conv.id, { kind: "text", text: "permanent" });
    await drainJobs({ workerId: "test", types: WA_JOBS });
    const [pm] = await db().select().from(schema.messages).where(eq(schema.messages.id, p.id));
    expect(pm).toMatchObject({ status: "failed", errorCode: "131047" });
    const [pj] = await db().select().from(schema.jobs).where(eq(schema.jobs.idempotencyKey, `wa-send:${p.id}`));
    expect(pj.status).toBe("dead");

    __setProviderFactoryForTests(() => failing("retryable", "131000"));
    const r = await sendMessage(A.agentCtx, conv.id, { kind: "text", text: "transient" });
    await drainJobs({ workerId: "test", types: WA_JOBS });
    const [rm] = await db().select().from(schema.messages).where(eq(schema.messages.id, r.id));
    expect(rm.status).toBe("queued");
    const [rj] = await db().select().from(schema.jobs).where(eq(schema.jobs.idempotencyKey, `wa-send:${r.id}`));
    expect(rj).toMatchObject({ status: "queued", attempts: 1 });

    // Recovery: provider healthy again and the retry comes due.
    __setProviderFactoryForTests(null);
    await db().update(schema.jobs).set({ runAt: new Date() }).where(eq(schema.jobs.id, rj.id));
    await drainJobs({ workerId: "test", types: WA_JOBS });
    const [rm2] = await db().select().from(schema.messages).where(eq(schema.messages.id, r.id));
    expect(rm2.status).toBe("sent");
  });
});

describe("accounts and permissions", () => {
  it("encrypts access tokens at rest and never exposes them", async () => {
    const token = "EAAGtesttokenvalue1234567890";
    const acc = await connectAccount(A.ownerCtx, { provider: "meta", displayName: "Meta", phoneNumber: "+972500000005", phoneNumberId: uniquePnid("pnM"), wabaId: "waba_m", accessToken: token, sendRatePerMinute: 60 });
    expect(acc.hasToken).toBe(true);
    expect(JSON.stringify(acc)).not.toContain(token);
    const [row] = await db().select().from(schema.whatsappAccounts).where(eq(schema.whatsappAccounts.id, acc.id));
    const [secret] = await db().select().from(schema.secrets).where(eq(schema.secrets.id, row.accessTokenSecretId!));
    expect(secret.ciphertext).not.toContain(token);
    expect(decryptSecret(secret.ciphertext, `whatsapp_account:${acc.id}`)).toBe(token);
    expect(() => decryptSecret(secret.ciphertext, "whatsapp_account:other")).toThrow();
  });

  it("only owners/managers connect accounts; duplicates are rejected", async () => {
    await expectAppError(
      connectAccount(A.agentCtx, { provider: "mock", displayName: "x", phoneNumber: "+972500000006", phoneNumberId: uniquePnid("pnX"), wabaId: "waba_t", sendRatePerMinute: 60 }),
      "FORBIDDEN",
    );
    await expectAppError(
      connectAccount(A.ownerCtx, { provider: "mock", displayName: "dup", phoneNumber: "+972500000001", phoneNumberId: accB.phoneNumberId, wabaId: "waba_t", sendRatePerMinute: 60 }),
      "CONFLICT",
    );
  });
});

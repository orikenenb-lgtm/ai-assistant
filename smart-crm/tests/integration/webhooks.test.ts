import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import https from "node:https";
import type http from "node:http";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { and, eq, sql } from "drizzle-orm";
import { closeDb, db, schema } from "@/server/db";
import { AppError } from "@/server/errors";
import { emitEvent } from "@/server/events";
import { drainJobs } from "@/server/jobs/runner";
import "@/modules/webhooks/jobs";
import { AUTO_DISABLE_AFTER } from "@/modules/webhooks/jobs";
import { createWebhook, deleteWebhook, listDeliveries, redeliver, rotateWebhookSecret, setWebhookActive } from "@/modules/webhooks/service";
import { allowLoopbackWebhooksForTests } from "@/modules/webhooks/ssrf";
import { verifyWebhookSignature } from "@/modules/webhooks/sign";
import { createTeam } from "../support/factories";

type Received = { headers: http.IncomingHttpHeaders; body: string };
let server: https.Server;
let url: string;
let received: Received[] = [];
let respondWith = 200;

type Team = Awaited<ReturnType<typeof createTeam>>;
let T: Team;
const TYPES = ["events.dispatch", "webhooks.deliver"];

async function emit(type: "contact.created" | "deal.won", entityId = T.tenant.id) {
  await T.systemCtx.run((tx) => emitEvent(tx, T.systemCtx, { type, entityType: type === "deal.won" ? "deal" : "contact", entityId, data: { source: "test" } }));
}

async function drain() {
  return drainJobs({ workerId: "webhook-test", types: TYPES, deadlineMs: 15_000 });
}

async function makeJobsDue() {
  await db().execute(sql`update public.jobs set run_at = now() where status = 'queued' and type = 'webhooks.deliver'`);
}

beforeAll(async () => {
  // Throwaway self-signed certificate: webhook URLs must be https (DB constraint).
  const dir = mkdtempSync(path.join(tmpdir(), "crm-wh-"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(dir, "key.pem"), "-out", path.join(dir, "cert.pem"), "-days", "1", "-subj", "/CN=127.0.0.1"], { stdio: "ignore" });
  server = https.createServer({ key: readFileSync(path.join(dir, "key.pem")), cert: readFileSync(path.join(dir, "cert.pem")) }, (reqIn, res) => {
    let body = "";
    reqIn.on("data", (c) => (body += c));
    reqIn.on("end", () => {
      received.push({ headers: reqIn.headers, body });
      res.writeHead(respondWith, { "content-type": "text/plain" });
      res.end(respondWith < 300 ? "ok" : "nope");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = `https://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
  T = await createTeam("Webhooks Co");
});

afterEach(() => {
  received = [];
  respondWith = 200;
  allowLoopbackWebhooksForTests(false);
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  await closeDb();
});

describe("webhook management", () => {
  it("validates URLs, permissions and stores the secret encrypted", async () => {
    await expect(createWebhook(T.ownerCtx, { url: "http://example.com/x", description: null, events: ["contact.created"] })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(createWebhook(T.ownerCtx, { url: "https://10.0.0.1/x", description: null, events: ["contact.created"] })).rejects.toBeInstanceOf(AppError);
    await expect(createWebhook(T.agentCtx, { url: "https://hooks.example.com/x", description: null, events: ["contact.created"] })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const { webhook, secret } = await createWebhook(T.managerCtx, { url: "https://hooks.example.com/x", description: "zap", events: ["contact.created"] });
    expect(secret).toMatch(/^whsec_/);
    const [row] = await db().select().from(schema.outboundWebhooks).where(eq(schema.outboundWebhooks.id, webhook.id));
    const [stored] = await db().select().from(schema.secrets).where(eq(schema.secrets.id, row.secretId!));
    expect(stored.ciphertext).not.toContain(secret);
    await deleteWebhook(T.managerCtx, webhook.id);
    expect(await db().select().from(schema.secrets).where(eq(schema.secrets.id, row.secretId!))).toEqual([]);
  });
});

describe("webhook delivery", () => {
  it("delivers signed payloads only for subscribed events", async () => {
    allowLoopbackWebhooksForTests(true);
    const { webhook, secret } = await createWebhook(T.ownerCtx, { url, description: null, events: ["deal.won"] });
    await emit("contact.created");
    await emit("deal.won");
    await drain();
    expect(received).toHaveLength(1);
    const hit = received[0];
    expect(hit.headers["x-smartcrm-event"]).toBe("deal.won");
    expect(verifyWebhookSignature(secret, hit.body, hit.headers["x-smartcrm-signature"] as string)).toBe(true);
    const payload = JSON.parse(hit.body);
    expect(payload).toMatchObject({ type: "deal.won", data: { entityType: "deal", source: "test" } });
    expect(payload).not.toHaveProperty("tenantId");
    const deliveries = await listDeliveries(T.ownerCtx, webhook.id);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({ status: "succeeded", responseStatus: 200, attempts: 1 });
    await deleteWebhook(T.ownerCtx, webhook.id);
  });

  it("retries failures with backoff, then dead-letters", async () => {
    allowLoopbackWebhooksForTests(true);
    respondWith = 500;
    const { webhook } = await createWebhook(T.ownerCtx, { url, description: null, events: ["contact.created"] });
    await emit("contact.created");
    await drain();
    let [d] = await listDeliveries(T.ownerCtx, webhook.id);
    expect(d).toMatchObject({ status: "failed", responseStatus: 500, attempts: 1 });
    for (let i = 0; i < 6; i++) {
      await makeJobsDue();
      await drain();
    }
    [d] = await listDeliveries(T.ownerCtx, webhook.id);
    expect(d.status).toBe("dead");
    expect(d.attempts).toBe(6);
    const [job] = await db().execute<{ status: string }>(sql`select status from public.jobs where payload->>'deliveryId' = ${d.id} order by id desc limit 1`);
    expect(job.status).toBe("dead");

    // Redelivery after the endpoint is fixed.
    respondWith = 200;
    await redeliver(T.ownerCtx, d.id);
    await drain();
    [d] = await listDeliveries(T.ownerCtx, webhook.id);
    expect(d.status).toBe("succeeded");
    await deleteWebhook(T.ownerCtx, webhook.id);
  });

  it("auto-disables a webhook after consecutive failures and notifies owners", async () => {
    allowLoopbackWebhooksForTests(true);
    respondWith = 503;
    const { webhook } = await createWebhook(T.ownerCtx, { url, description: null, events: ["contact.created"] });
    await db().update(schema.outboundWebhooks).set({ consecutiveFailures: AUTO_DISABLE_AFTER - 1 }).where(eq(schema.outboundWebhooks.id, webhook.id));
    await emit("contact.created");
    await drain();
    const [w] = await db().select().from(schema.outboundWebhooks).where(eq(schema.outboundWebhooks.id, webhook.id));
    expect(w).toMatchObject({ active: false, disabledReason: "too_many_failures" });
    const notes = await db()
      .select()
      .from(schema.notifications)
      .where(and(eq(schema.notifications.tenantId, T.tenant.id), eq(schema.notifications.type, "webhook_disabled")));
    expect(notes.map((n) => n.userId).sort()).toEqual([T.owner.id, T.manager.id].sort());

    // Disabled webhooks receive nothing; re-enabling resets the failure counter.
    received = [];
    await emit("contact.created");
    await drain();
    expect(received).toEqual([]);
    await setWebhookActive(T.ownerCtx, webhook.id, true);
    const [again] = await db().select().from(schema.outboundWebhooks).where(eq(schema.outboundWebhooks.id, webhook.id));
    expect(again).toMatchObject({ active: true, consecutiveFailures: 0 });
    await deleteWebhook(T.ownerCtx, webhook.id);
  });

  it("blocks private destinations at delivery time even if they were stored earlier", async () => {
    allowLoopbackWebhooksForTests(true);
    const { webhook } = await createWebhook(T.ownerCtx, { url, description: null, events: ["contact.created"] });
    allowLoopbackWebhooksForTests(false);
    await emit("contact.created");
    await drain();
    expect(received).toEqual([]);
    const [d] = await listDeliveries(T.ownerCtx, webhook.id);
    expect(d.status).toBe("dead");
    expect(d.lastError).toMatch(/blocked/);
    await deleteWebhook(T.ownerCtx, webhook.id);
  });

  it("rotates the signing secret", async () => {
    allowLoopbackWebhooksForTests(true);
    const { webhook, secret: oldSecret } = await createWebhook(T.ownerCtx, { url, description: null, events: ["contact.created"] });
    const { secret: newSecret } = await rotateWebhookSecret(T.ownerCtx, webhook.id);
    expect(newSecret).not.toBe(oldSecret);
    await emit("contact.created");
    await drain();
    const hit = received[0];
    expect(verifyWebhookSignature(newSecret, hit.body, hit.headers["x-smartcrm-signature"] as string)).toBe(true);
    expect(verifyWebhookSignature(oldSecret, hit.body, hit.headers["x-smartcrm-signature"] as string)).toBe(false);
    await deleteWebhook(T.ownerCtx, webhook.id);
  });

  it("never delivers one tenant's events to another tenant's webhook", async () => {
    allowLoopbackWebhooksForTests(true);
    const Other = await createTeam("Other hooks");
    const { webhook } = await createWebhook(Other.ownerCtx, { url, description: null, events: ["contact.created"] });
    await emit("contact.created");
    await drain();
    expect(received).toEqual([]);
    await deleteWebhook(Other.ownerCtx, webhook.id);
  });
});

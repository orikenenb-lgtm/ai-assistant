import http from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";
import { and, eq, sql } from "drizzle-orm";
import { db, schema, withSystemTx } from "@/server/db";
import { enqueueJob } from "@/server/jobs/queue";
import { PermanentJobError, registerJobHandler, type Job } from "@/server/jobs/runner";
import { subscribeToEvents, type DomainEvent } from "@/server/events";
import { logger } from "@/server/logger";
import { loopbackAllowed, resolvePublicTarget, validateWebhookUrl } from "./ssrf";
import { isTenantLive } from "@/server/rbac/membership";
import { SIGNATURE_HEADER, signWebhookPayload } from "./sign";
import { webhookSigningSecret } from "./service";

export const AUTO_DISABLE_AFTER = 20;
const TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 2048;
const MAX_ATTEMPTS = 6;

/** Public payload shape (documented in docs/API.md). */
export function eventPayload(event: DomainEvent) {
  return {
    id: event.id,
    type: event.type,
    occurredAt: event.occurredAt,
    data: { entityType: event.entityType, entityId: event.entityId, ...event.data },
  };
}

/** Event subscriber: one delivery per (webhook, event) for every subscribed active webhook. */
export async function fanOutEvent(event: DomainEvent) {
  const hooks = await db()
    .select({ id: schema.outboundWebhooks.id })
    .from(schema.outboundWebhooks)
    .where(
      and(
        eq(schema.outboundWebhooks.tenantId, event.tenantId),
        eq(schema.outboundWebhooks.active, true),
        sql`${event.type} = any(${schema.outboundWebhooks.events})`,
      ),
    );
  if (!hooks.length || !(await isTenantLive(event.tenantId))) return;
  await withSystemTx(async (tx) => {
    for (const h of hooks) {
      const [d] = await tx
        .insert(schema.outboundWebhookDeliveries)
        .values({
          tenantId: event.tenantId,
          webhookId: h.id,
          eventType: event.type,
          eventId: event.id,
          payload: eventPayload(event) as unknown as Record<string, unknown>,
        })
        .onConflictDoNothing({ target: [schema.outboundWebhookDeliveries.webhookId, schema.outboundWebhookDeliveries.eventId] })
        .returning({ id: schema.outboundWebhookDeliveries.id });
      if (!d) continue;
      await enqueueJob(tx, {
        tenantId: event.tenantId,
        type: "webhooks.deliver",
        payload: { deliveryId: d.id },
        idempotencyKey: `whd:${d.id}`,
        maxAttempts: MAX_ATTEMPTS,
      });
    }
  });
}

type PostResult = { status: number; body: string };

/** POSTs with the destination IP pinned to the address that passed the SSRF check. */
export async function postPinned(target: URL, body: string, headers: Record<string, string>): Promise<PostResult> {
  const pinned = await resolvePublicTarget(target.hostname);
  const lookupPinned: LookupFunction = (_host, options, cb) => {
    if ((options as { all?: boolean }).all) {
      (cb as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [{ address: pinned.address, family: pinned.family }]);
    } else {
      cb(null, pinned.address, pinned.family);
    }
  };
  // The test hook (APP_ENV=test only) may target a loopback server with a self-signed certificate.
  const testLoopback = loopbackAllowed() && (pinned.address === "127.0.0.1" || pinned.address === "::1");
  const transport = target.protocol === "http:" && testLoopback ? http : https;
  return new Promise<PostResult>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      fn();
    };
    const req = transport.request(
      target,
      {
        method: "POST",
        lookup: lookupPinned,
        headers: { ...headers, "Content-Length": Buffer.byteLength(body).toString() },
        timeout: TIMEOUT_MS,
        ...(testLoopback ? { rejectUnauthorized: false } : {}),
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size <= MAX_RESPONSE_BYTES) chunks.push(c);
          // We only keep an excerpt: stop reading huge or endless responses.
          else finish(() => {
            req.destroy();
            resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8").slice(0, 1000) });
          });
        });
        res.on("end", () => finish(() => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8").slice(0, 1000) })));
        res.on("error", (e) => finish(() => reject(e)));
      },
    );
    // Overall deadline: the socket timeout alone does not stop a slow-drip server.
    const deadline = setTimeout(() => finish(() => {
      req.destroy();
      reject(new Error(`timeout after ${TIMEOUT_MS / 1000}s`));
    }), TIMEOUT_MS);
    req.on("timeout", () => req.destroy(new Error(`timeout after ${TIMEOUT_MS / 1000}s`)));
    req.on("error", (e) => finish(() => reject(e)));
    req.end(body);
  });
}

async function recordFailure(
  delivery: typeof schema.outboundWebhookDeliveries.$inferSelect,
  hook: typeof schema.outboundWebhooks.$inferSelect,
  message: string,
  final: boolean,
  responseStatus: number | null,
  responseExcerpt: string | null,
) {
  await withSystemTx(async (tx) => {
    await tx
      .update(schema.outboundWebhookDeliveries)
      .set({ status: final ? "dead" : "failed", attempts: delivery.attempts + 1, lastError: message.slice(0, 500), responseStatus, responseExcerpt })
      .where(eq(schema.outboundWebhookDeliveries.id, delivery.id));
    const [updated] = await tx
      .update(schema.outboundWebhooks)
      .set({ consecutiveFailures: sql`${schema.outboundWebhooks.consecutiveFailures} + 1` })
      .where(eq(schema.outboundWebhooks.id, hook.id))
      .returning();
    if (updated && updated.active && updated.consecutiveFailures >= AUTO_DISABLE_AFTER) {
      await tx
        .update(schema.outboundWebhooks)
        .set({ active: false, disabledReason: "too_many_failures" })
        .where(eq(schema.outboundWebhooks.id, hook.id));
      await tx.insert(schema.auditLogs).values({
        tenantId: hook.tenantId,
        actorType: "system",
        action: "webhook.auto_disabled",
        entityType: "webhook",
        entityId: hook.id,
        metadata: { consecutiveFailures: updated.consecutiveFailures, url: hook.url },
      });
      // Tell every active owner/manager (in their language).
      await tx.execute(sql`
        insert into public.notifications (tenant_id, user_id, type, title, body, link)
        select m.tenant_id, m.user_id, 'webhook_disabled',
               case when p.locale = 'en' then 'A webhook was disabled' else 'Webhook הושבת' end,
               case when p.locale = 'en' then ${`${hook.url} failed ${AUTO_DISABLE_AFTER} times in a row.`}
                    else ${`${hook.url} נכשל ${AUTO_DISABLE_AFTER} פעמים ברצף.`} end,
               '/settings/webhooks'
        from public.memberships m join public.profiles p on p.id = m.user_id
        where m.tenant_id = ${hook.tenantId} and m.status = 'active' and m.role in ('owner', 'manager')`);
    }
  });
}

export async function deliverWebhook(job: Job) {
  const deliveryId = String(job.payload.deliveryId ?? "");
  const [delivery] = await db().select().from(schema.outboundWebhookDeliveries).where(eq(schema.outboundWebhookDeliveries.id, deliveryId));
  if (!delivery || (job.tenantId && delivery.tenantId !== job.tenantId)) throw new PermanentJobError("delivery not found");
  if (delivery.status === "succeeded") return;
  const [hook] = await db().select().from(schema.outboundWebhooks).where(eq(schema.outboundWebhooks.id, delivery.webhookId));
  if (!hook || !hook.active) {
    await db()
      .update(schema.outboundWebhookDeliveries)
      .set({ status: "dead", lastError: "webhook disabled or deleted" })
      .where(eq(schema.outboundWebhookDeliveries.id, delivery.id));
    return;
  }
  const final = job.attempts >= job.maxAttempts;
  const check = validateWebhookUrl(hook.url);
  if (!check.ok) {
    await recordFailure(delivery, hook, `blocked: ${check.reason}`, true, null, null);
    throw new PermanentJobError(`blocked destination: ${check.reason}`);
  }
  const secret = await webhookSigningSecret(hook.tenantId, hook.secretId);
  if (!secret) {
    await recordFailure(delivery, hook, "missing signing secret", true, null, null);
    throw new PermanentJobError("missing signing secret");
  }
  const body = JSON.stringify(delivery.payload);
  const headers = {
    "Content-Type": "application/json",
    "User-Agent": "SmartCRM-Webhooks/1.0",
    [SIGNATURE_HEADER]: signWebhookPayload(secret, body),
    "X-SmartCRM-Event": delivery.eventType,
    "X-SmartCRM-Event-Id": delivery.eventId,
    "X-SmartCRM-Delivery": delivery.id,
  };

  let result: PostResult;
  try {
    result = await postPinned(check.url, body, headers);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (/blocked destination/.test(message)) {
      await recordFailure(delivery, hook, message, true, null, null);
      throw new PermanentJobError(message);
    }
    await recordFailure(delivery, hook, message, final, null, null);
    throw new Error(`webhook delivery failed: ${message}`);
  }

  if (result.status >= 200 && result.status < 300) {
    await withSystemTx(async (tx) => {
      await tx
        .update(schema.outboundWebhookDeliveries)
        .set({ status: "succeeded", attempts: delivery.attempts + 1, responseStatus: result.status, responseExcerpt: result.body.slice(0, 500), lastError: null, deliveredAt: new Date() })
        .where(eq(schema.outboundWebhookDeliveries.id, delivery.id));
      await tx.update(schema.outboundWebhooks).set({ consecutiveFailures: 0 }).where(eq(schema.outboundWebhooks.id, hook.id));
    });
    return;
  }
  // 3xx is a failure too: redirects are never followed.
  await recordFailure(delivery, hook, `HTTP ${result.status}`, final, result.status, result.body.slice(0, 500));
  logger().warn({ deliveryId: delivery.id, status: result.status }, "webhook endpoint returned non-2xx");
  throw new Error(`webhook endpoint returned HTTP ${result.status}`);
}

registerJobHandler("webhooks.deliver", deliverWebhook);
subscribeToEvents({ name: "outbound-webhooks", handle: fanOutEvent });

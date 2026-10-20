import { randomUUID } from "node:crypto";
import type { Executor } from "./db";
import type { ServiceCtx } from "./context";
import { enqueueJob } from "./jobs/queue";
import { registerJobHandler, PermanentJobError, type Job } from "./jobs/runner";
import { logger, errorFields } from "./logger";

import { DOMAIN_EVENTS, type DomainEventType } from "@/lib/domain-events";
export { DOMAIN_EVENTS, type DomainEventType };

export type DomainEvent = {
  id: string;
  tenantId: string;
  type: DomainEventType;
  entityType: "contact" | "company" | "lead" | "deal" | "conversation" | "message" | "task" | "quote";
  entityId: string;
  data: Record<string, unknown>;
  actor: { type: ServiceCtx["actorType"]; userId: string | null };
  /** How many automation hops produced this event (loop prevention). */
  depth: number;
  occurredAt: string;
};

/** Maximum automation chain depth; deeper events are dropped. */
export const MAX_EVENT_DEPTH = 5;

/**
 * Publishes a domain event in the caller's transaction. Subscribers
 * (automation triggers, outbound webhooks) run asynchronously in the worker.
 */
export async function emitEvent(
  tx: Executor,
  ctx: ServiceCtx,
  event: { type: DomainEventType; entityType: DomainEvent["entityType"]; entityId: string; data?: Record<string, unknown> },
) {
  const depth = ctx.eventDepth ?? 0;
  if (depth > MAX_EVENT_DEPTH) {
    logger().warn({ tenantId: ctx.tenantId, type: event.type, depth }, "event dropped: automation depth limit reached");
    return;
  }
  const payload: DomainEvent = {
    id: randomUUID(),
    tenantId: ctx.tenantId,
    type: event.type,
    entityType: event.entityType,
    entityId: event.entityId,
    data: event.data ?? {},
    actor: { type: ctx.actorType, userId: ctx.userId },
    depth,
    occurredAt: new Date().toISOString(),
  };
  await enqueueJob(tx, {
    tenantId: ctx.tenantId,
    type: "events.dispatch",
    payload: payload as unknown as Record<string, unknown>,
    idempotencyKey: `evt:${payload.id}`,
    priority: 5,
  });
}

export type EventSubscriber = { name: string; handle: (event: DomainEvent) => Promise<void> };
const subscribers: EventSubscriber[] = [];

export function subscribeToEvents(sub: EventSubscriber) {
  if (!subscribers.some((s) => s.name === sub.name)) subscribers.push(sub);
}

/** Fans an event out to every subscriber; a failing subscriber fails the job (retried). */
async function dispatch(job: Job) {
  const event = job.payload as unknown as DomainEvent;
  if (!event?.type || !event.tenantId || !job.tenantId || event.tenantId !== job.tenantId) throw new PermanentJobError("malformed event payload");
  const errors: string[] = [];
  for (const sub of subscribers) {
    try {
      await sub.handle(event);
    } catch (e) {
      logger().error({ subscriber: sub.name, eventType: event.type, ...errorFields(e) }, "event subscriber failed");
      errors.push(`${sub.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (errors.length) throw new Error(errors.join("; "));
}

registerJobHandler("events.dispatch", dispatch);

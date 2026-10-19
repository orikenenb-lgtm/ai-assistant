import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/server/db";

/**
 * Data an automation run can see. Entities are reloaded at every step so a
 * condition after a delay evaluates current state, not the state at trigger time.
 */
export type RunContext = {
  contact: { id: string; firstName: string; lastName: string; email: string | null; phone: string | null; lifecycleStage: string; source: string | null; whatsappConsent: string; ownerId: string | null; tags: string[] } | null;
  deal: { id: string; title: string; valueCents: number; status: string; stageId: string; pipelineId: string; ownerId: string | null; contactId: string | null } | null;
  lead: { id: string; status: string; source: string; score: number | null; aiClassification: string | null; ownerId: string | null; contactId: string | null } | null;
  conversationId: string | null;
  message: { id: string; body: string | null; type: string } | null;
  /** Flat object used by rules and {{interpolation}}. */
  data: Record<string, unknown>;
};

export type RunSeed = { entityType: string | null; entityId: string | null; event?: Record<string, unknown> | null; payload?: unknown };

async function loadContact(tenantId: string, id: string) {
  const [c] = await db()
    .select()
    .from(schema.contacts)
    .where(and(eq(schema.contacts.id, id), eq(schema.contacts.tenantId, tenantId), isNull(schema.contacts.deletedAt)));
  if (!c) return null;
  const tags = (await db().select({ tagId: schema.contactTags.tagId }).from(schema.contactTags).where(eq(schema.contactTags.contactId, id))).map((t) => t.tagId);
  return {
    id: c.id,
    firstName: c.firstName,
    lastName: c.lastName,
    email: c.email,
    phone: c.phone,
    lifecycleStage: c.lifecycleStage,
    source: c.source,
    whatsappConsent: c.whatsappConsent,
    ownerId: c.ownerId,
    tags,
  };
}

export async function buildRunContext(tenantId: string, seed: RunSeed): Promise<RunContext> {
  const ctx: RunContext = { contact: null, deal: null, lead: null, conversationId: null, message: null, data: {} };
  const id = seed.entityId;
  if (id) {
    if (seed.entityType === "contact") ctx.contact = await loadContact(tenantId, id);
    if (seed.entityType === "deal") {
      const [d] = await db()
        .select()
        .from(schema.deals)
        .where(and(eq(schema.deals.id, id), eq(schema.deals.tenantId, tenantId), isNull(schema.deals.deletedAt)));
      if (d) {
        ctx.deal = { id: d.id, title: d.title, valueCents: d.valueCents, status: d.status, stageId: d.stageId, pipelineId: d.pipelineId, ownerId: d.ownerId, contactId: d.contactId };
        if (d.contactId) ctx.contact = await loadContact(tenantId, d.contactId);
      }
    }
    if (seed.entityType === "lead") {
      const [l] = await db()
        .select()
        .from(schema.leads)
        .where(and(eq(schema.leads.id, id), eq(schema.leads.tenantId, tenantId), isNull(schema.leads.deletedAt)));
      if (l) {
        ctx.lead = { id: l.id, status: l.status, source: l.source, score: l.score, aiClassification: l.aiClassification, ownerId: l.ownerId, contactId: l.contactId };
        if (l.contactId) ctx.contact = await loadContact(tenantId, l.contactId);
      }
    }
    if (seed.entityType === "conversation" || seed.entityType === "message") {
      const convId = seed.entityType === "conversation" ? id : ((seed.event?.data as Record<string, unknown> | undefined)?.conversationId as string | undefined) ?? null;
      if (seed.entityType === "message") {
        const [m] = await db().select().from(schema.messages).where(and(eq(schema.messages.id, id), eq(schema.messages.tenantId, tenantId)));
        if (m) {
          ctx.message = { id: m.id, body: m.body, type: m.type };
          ctx.conversationId = m.conversationId;
        }
      } else {
        ctx.conversationId = convId;
      }
      if (ctx.conversationId) {
        const [conv] = await db()
          .select({ contactId: schema.conversations.contactId })
          .from(schema.conversations)
          .where(and(eq(schema.conversations.id, ctx.conversationId), eq(schema.conversations.tenantId, tenantId)));
        if (conv) ctx.contact = await loadContact(tenantId, conv.contactId);
      }
    }
    if (seed.entityType === "task" || seed.entityType === "quote") {
      const contactId = (seed.event?.data as Record<string, unknown> | undefined)?.contactId;
      if (typeof contactId === "string") ctx.contact = await loadContact(tenantId, contactId);
    }
  }
  ctx.data = {
    contact: ctx.contact ?? undefined,
    deal: ctx.deal ?? undefined,
    lead: ctx.lead ?? undefined,
    message: ctx.message ?? undefined,
    event: seed.event ?? undefined,
    payload: seed.payload ?? undefined,
  };
  return ctx;
}

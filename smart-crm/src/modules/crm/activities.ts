import { and, desc, eq, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { schema, type Tx } from "@/server/db";
import { assertCan, assertCanWrite, type ServiceCtx } from "@/server/context";
import { audit } from "@/server/audit";
import { AppError } from "@/server/errors";

export type EntityRef = { contactId?: string | null; companyId?: string | null; dealId?: string | null; leadId?: string | null };
export type EntityKind = "contact" | "company" | "deal" | "lead";

export const ACTIVITY_TYPES = [
  "note",
  "call",
  "meeting",
  "email",
  "whatsapp_in",
  "whatsapp_out",
  "task_created",
  "task_completed",
  "deal_created",
  "deal_stage_changed",
  "deal_won",
  "deal_lost",
  "lead_created",
  "lead_converted",
  "contact_created",
  "company_created",
  "file_uploaded",
  "quote_created",
  "quote_sent",
  "quote_status",
  "automation",
  "ai",
  "consent_changed",
  "merged",
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

const actorTypeOf = (ctx: ServiceCtx) =>
  ({ user: "user", admin: "user", ai: "ai", automation: "automation", api_key: "api_key", system: "system", webhook: "system" })[ctx.actorType] as
    | "user"
    | "ai"
    | "automation"
    | "api_key"
    | "system";

/** Appends a timeline entry and bumps last_activity_at on the referenced records. */
export async function recordActivity(
  tx: Tx,
  ctx: ServiceCtx,
  input: EntityRef & {
    type: ActivityType;
    subject?: string | null;
    body?: string | null;
    occurredAt?: Date;
    durationMinutes?: number | null;
    outcome?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  const occurredAt = input.occurredAt ?? new Date();
  await tx.insert(schema.activities).values({
    tenantId: ctx.tenantId,
    type: input.type,
    subject: input.subject?.slice(0, 300) ?? null,
    body: input.body?.slice(0, 10000) ?? null,
    contactId: input.contactId ?? null,
    companyId: input.companyId ?? null,
    dealId: input.dealId ?? null,
    leadId: input.leadId ?? null,
    actorId: ctx.userId,
    actorType: actorTypeOf(ctx),
    occurredAt,
    durationMinutes: input.durationMinutes ?? null,
    outcome: input.outcome ?? null,
    metadata: input.metadata ?? {},
  });
  if (input.contactId) {
    await tx
      .update(schema.contacts)
      .set({ lastActivityAt: occurredAt })
      .where(and(eq(schema.contacts.id, input.contactId), eq(schema.contacts.tenantId, ctx.tenantId)));
  }
  if (input.companyId) {
    await tx
      .update(schema.companies)
      .set({ lastActivityAt: occurredAt })
      .where(and(eq(schema.companies.id, input.companyId), eq(schema.companies.tenantId, ctx.tenantId)));
  }
}

export type TimelineItem = {
  id: string;
  type: ActivityType;
  subject: string | null;
  body: string | null;
  occurredAt: Date;
  actorName: string | null;
  actorType: string;
  durationMinutes: number | null;
  outcome: string | null;
  metadata: Record<string, unknown>;
};

function entityFilter(kind: EntityKind, id: string) {
  return {
    contact: eq(schema.activities.contactId, id),
    company: eq(schema.activities.companyId, id),
    deal: eq(schema.activities.dealId, id),
    lead: eq(schema.activities.leadId, id),
  }[kind];
}

/** Keyset-paginated timeline (newest first). */
export async function listTimeline(ctx: ServiceCtx, kind: EntityKind, id: string, opts: { before?: Date; limit?: number } = {}) {
  assertCan(ctx, `${kind === "company" ? "companies" : `${kind}s`}.view` as "contacts.view");
  const limit = Math.min(opts.limit ?? 30, 100);
  return ctx.run(async (tx) => {
    const rows = await tx
      .select({ a: schema.activities, actorName: schema.profiles.fullName })
      .from(schema.activities)
      .leftJoin(schema.profiles, eq(schema.profiles.id, schema.activities.actorId))
      .where(
        and(
          eq(schema.activities.tenantId, ctx.tenantId),
          entityFilter(kind, id),
          opts.before ? lt(schema.activities.occurredAt, opts.before) : undefined,
        ),
      )
      .orderBy(desc(schema.activities.occurredAt))
      .limit(limit + 1);
    const items: TimelineItem[] = rows.slice(0, limit).map((r) => ({
      id: r.a.id,
      type: r.a.type as ActivityType,
      subject: r.a.subject,
      body: r.a.body,
      occurredAt: r.a.occurredAt,
      actorName: r.actorName,
      actorType: r.a.actorType,
      durationMinutes: r.a.durationMinutes,
      outcome: r.a.outcome,
      metadata: r.a.metadata,
    }));
    return { items, hasMore: rows.length > limit };
  });
}

export const logActivitySchema = z.object({
  type: z.enum(["call", "meeting", "email"]),
  subject: z.string().trim().min(1).max(300),
  body: z.string().trim().max(5000).optional().nullable(),
  occurredAt: z.coerce.date().optional(),
  durationMinutes: z.coerce.number().int().min(0).max(1440).optional().nullable(),
  outcome: z.string().trim().max(100).optional().nullable(),
});

/** Manually logged sales activity (call / meeting / email) on a record. */
export async function logActivity(ctx: ServiceCtx, kind: EntityKind, entityId: string, input: z.infer<typeof logActivitySchema>) {
  const perm = { contact: "contacts.update", company: "companies.update", deal: "deals.update", lead: "leads.update" }[kind] as "contacts.update";
  assertCanWrite(ctx, perm);
  await ctx.run(async (tx) => {
    await assertEntityExists(tx, ctx.tenantId, kind, entityId);
    await recordActivity(tx, ctx, { ...refFor(kind, entityId), ...input });
  });
}

export function refFor(kind: EntityKind, id: string): EntityRef {
  return { [`${kind}Id`]: id } as EntityRef;
}

export async function assertEntityExists(tx: Tx, tenantId: string, kind: EntityKind, id: string) {
  const table = { contact: schema.contacts, company: schema.companies, deal: schema.deals, lead: schema.leads }[kind];
  const [row] = await tx
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.id, id), eq(table.tenantId, tenantId), sql`${table.deletedAt} is null`))
    .limit(1);
  if (!row) throw new AppError("NOT_FOUND", "errors.notFound");
}

/* ------------------------------------------------------------------ Notes */

export const noteInputSchema = z.object({ body: z.string().trim().min(1).max(10000) });

export type NoteView = { id: string; body: string; pinned: boolean; authorId: string | null; authorName: string | null; createdAt: Date; updatedAt: Date };

export async function listNotes(ctx: ServiceCtx, kind: EntityKind, entityId: string): Promise<NoteView[]> {
  const col = { contact: schema.notes.contactId, company: schema.notes.companyId, deal: schema.notes.dealId, lead: schema.notes.leadId }[kind];
  return ctx.run(async (tx) => {
    const rows = await tx
      .select({ n: schema.notes, authorName: schema.profiles.fullName })
      .from(schema.notes)
      .leftJoin(schema.profiles, eq(schema.profiles.id, schema.notes.authorId))
      .where(and(eq(schema.notes.tenantId, ctx.tenantId), eq(col, entityId)))
      .orderBy(desc(schema.notes.pinned), desc(schema.notes.createdAt));
    return rows.map((r) => ({
      id: r.n.id,
      body: r.n.body,
      pinned: r.n.pinned,
      authorId: r.n.authorId,
      authorName: r.authorName,
      createdAt: r.n.createdAt,
      updatedAt: r.n.updatedAt,
    }));
  });
}

export async function addNote(ctx: ServiceCtx, kind: EntityKind, entityId: string, body: string) {
  const perm = { contact: "contacts.update", company: "companies.update", deal: "deals.update", lead: "leads.update" }[kind] as "contacts.update";
  assertCanWrite(ctx, perm);
  return ctx.run(async (tx) => {
    await assertEntityExists(tx, ctx.tenantId, kind, entityId);
    const [note] = await tx
      .insert(schema.notes)
      .values({ tenantId: ctx.tenantId, body, authorId: ctx.userId, ...refFor(kind, entityId) })
      .returning();
    await recordActivity(tx, ctx, { ...refFor(kind, entityId), type: "note", body: body.slice(0, 500), metadata: { noteId: note.id } });
    return note;
  });
}

/** Authors edit their own notes; owners/managers may edit any. */
async function loadEditableNote(tx: Tx, ctx: ServiceCtx, noteId: string) {
  const [note] = await tx.select().from(schema.notes).where(and(eq(schema.notes.id, noteId), eq(schema.notes.tenantId, ctx.tenantId)));
  if (!note) throw new AppError("NOT_FOUND", "errors.notFound");
  const isManager = ctx.role === "owner" || ctx.role === "manager" || ctx.actorType === "system";
  if (note.authorId !== ctx.userId && !isManager) throw new AppError("FORBIDDEN", "errors.forbidden");
  return note;
}

export async function updateNote(ctx: ServiceCtx, noteId: string, input: { body?: string; pinned?: boolean }) {
  if (ctx.readOnly) throw new AppError("READ_ONLY", "errors.readOnly");
  await ctx.run(async (tx) => {
    await loadEditableNote(tx, ctx, noteId);
    await tx.update(schema.notes).set(input).where(eq(schema.notes.id, noteId));
  });
}

export async function deleteNote(ctx: ServiceCtx, noteId: string) {
  if (ctx.readOnly) throw new AppError("READ_ONLY", "errors.readOnly");
  await ctx.run(async (tx) => {
    const note = await loadEditableNote(tx, ctx, noteId);
    await tx.delete(schema.notes).where(eq(schema.notes.id, noteId));
    await audit(tx, ctx, { action: "note.deleted", entityType: "note", entityId: noteId, metadata: { contactId: note.contactId, dealId: note.dealId } });
  });
}

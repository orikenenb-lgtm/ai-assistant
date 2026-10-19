import { and, desc, eq, isNotNull, lte, sql } from "drizzle-orm";
import { db, schema, withSystemTx, type Tx } from "@/server/db";
import { assertCan, assertCanWrite, type ServiceCtx } from "@/server/context";
import { audit } from "@/server/audit";
import { AppError } from "@/server/errors";
import { enqueueJob } from "@/server/jobs/queue";
import { storage } from "@/server/storage";
import { logger } from "@/server/logger";
import { contactDisplayName, loadContact } from "@/modules/crm/contacts/service";

export const TENANT_PURGE_GRACE_DAYS = 30;

export type DataRequestView = {
  id: string;
  type: "export" | "delete";
  subjectType: "contact" | "tenant";
  subjectId: string | null;
  status: string;
  createdAt: Date;
  completedAt: Date | null;
  error: string | null;
  downloadable: boolean;
  requestedByName: string | null;
};

export async function listDataRequests(ctx: ServiceCtx, limit = 50): Promise<DataRequestView[]> {
  assertCan(ctx, "privacy.manage");
  return ctx.run(async (tx) => {
    const rows = await tx
      .select({ r: schema.dataRequests, by: schema.profiles.fullName })
      .from(schema.dataRequests)
      .leftJoin(schema.profiles, eq(schema.profiles.id, schema.dataRequests.requestedBy))
      .where(eq(schema.dataRequests.tenantId, ctx.tenantId))
      .orderBy(desc(schema.dataRequests.createdAt))
      .limit(limit);
    return rows.map(({ r, by }) => ({
      id: r.id,
      type: r.type as "export" | "delete",
      subjectType: r.subjectType as "contact" | "tenant",
      subjectId: r.subjectId,
      status: r.status,
      createdAt: r.createdAt,
      completedAt: r.completedAt,
      error: r.error,
      downloadable: r.type === "export" && r.status === "completed" && Boolean(r.fileStorageKey),
      requestedByName: by,
    }));
  });
}

async function createExportRequest(ctx: ServiceCtx, subjectType: "contact" | "tenant", subjectId: string | null) {
  return ctx.run(async (tx) => {
    const [req] = await tx
      .insert(schema.dataRequests)
      .values({ tenantId: ctx.tenantId, type: "export", subjectType, subjectId, requestedBy: ctx.userId })
      .returning();
    await enqueueJob(tx, { tenantId: ctx.tenantId, type: "privacy.export", payload: { requestId: req.id }, idempotencyKey: `privacy-export:${req.id}` });
    await audit(tx, ctx, { action: `privacy.${subjectType}_export_requested`, entityType: subjectType, entityId: subjectId ?? ctx.tenantId, metadata: { requestId: req.id } });
    return req;
  });
}

export async function requestContactExport(ctx: ServiceCtx, contactId: string) {
  assertCanWrite(ctx, "privacy.manage");
  await ctx.run((tx) => loadContact(tx, ctx.tenantId, contactId));
  return createExportRequest(ctx, "contact", contactId);
}

export async function requestTenantExport(ctx: ServiceCtx) {
  assertCanWrite(ctx, "privacy.manage");
  return createExportRequest(ctx, "tenant", null);
}

/** Signed download link (2 minutes) for a completed export. */
export async function exportDownloadUrl(ctx: ServiceCtx, requestId: string): Promise<{ url: string; fileName: string }> {
  assertCan(ctx, "privacy.manage");
  const [req] = await ctx.run((tx) =>
    tx
      .select()
      .from(schema.dataRequests)
      .where(and(eq(schema.dataRequests.id, requestId), eq(schema.dataRequests.tenantId, ctx.tenantId))),
  );
  if (!req || req.type !== "export" || req.status !== "completed" || !req.fileStorageKey) throw new AppError("NOT_FOUND", "errors.notFound");
  const fileName = `${req.subjectType}-export-${req.createdAt.toISOString().slice(0, 10)}.json`;
  await ctx.run((tx) => audit(tx, ctx, { action: "privacy.export_downloaded", entityType: "data_request", entityId: requestId }));
  return { url: await storage().signedUrl(req.fileStorageKey, 120, fileName), fileName };
}

/* --------------------------------------------------------- export jobs */

async function rows(tx: Tx, query: ReturnType<typeof sql>) {
  return tx.execute<Record<string, unknown>>(query);
}

export async function buildContactExport(tx: Tx, tenantId: string, contactId: string) {
  const one = async (q: ReturnType<typeof sql>) => (await rows(tx, q))[0] ?? null;
  const contact = await one(sql`select * from public.contacts where tenant_id = ${tenantId} and id = ${contactId}`);
  if (!contact) throw new Error("contact not found");
  return {
    exportedAt: new Date().toISOString(),
    subject: "contact",
    contact,
    company: contact.company_id ? await one(sql`select * from public.companies where id = ${contact.company_id as string} and tenant_id = ${tenantId}`) : null,
    tags: await rows(tx, sql`select t.name from public.contact_tags ct join public.tags t on t.id = ct.tag_id where ct.contact_id = ${contactId}`),
    notes: await rows(tx, sql`select id, body, created_at from public.notes where tenant_id = ${tenantId} and contact_id = ${contactId}`),
    activities: await rows(tx, sql`select id, type, subject, body, occurred_at from public.activities where tenant_id = ${tenantId} and contact_id = ${contactId}`),
    deals: await rows(tx, sql`select id, title, value_cents, currency, status, created_at from public.deals where tenant_id = ${tenantId} and contact_id = ${contactId}`),
    tasks: await rows(tx, sql`select id, title, status, due_at, created_at from public.tasks where tenant_id = ${tenantId} and contact_id = ${contactId}`),
    consents: await rows(tx, sql`select status, source, evidence, created_at from public.contact_consents where tenant_id = ${tenantId} and contact_id = ${contactId}`),
    attachments: await rows(tx, sql`select id, file_name, mime_type, size_bytes, created_at from public.attachments where tenant_id = ${tenantId} and contact_id = ${contactId}`),
    messages: await rows(
      tx,
      sql`select m.id, m.direction, m.type, m.body, m.status, m.created_at
          from public.messages m join public.conversations c on c.id = m.conversation_id
          where c.tenant_id = ${tenantId} and c.contact_id = ${contactId} order by m.created_at`,
    ),
  };
}

/** Tables included in a full tenant export (secrets and auth data are never exported). */
const TENANT_EXPORT_TABLES = [
  "tenants",
  "memberships",
  "companies",
  "contacts",
  "custom_field_definitions",
  "tags",
  "contact_tags",
  "company_tags",
  "pipelines",
  "pipeline_stages",
  "lost_reasons",
  "leads",
  "deals",
  "deal_tags",
  "lead_tags",
  "notes",
  "attachments",
  "activities",
  "tasks",
  "calendar_events",
  "conversations",
  "messages",
  "conversation_notes",
  "message_templates",
  "contact_consents",
  "quotes",
  "quote_items",
  "document_templates",
  "automation_workflows",
  "segments",
] as const;

export async function buildTenantExport(tx: Tx, tenantId: string) {
  const data: Record<string, unknown[]> = {};
  for (const table of TENANT_EXPORT_TABLES) {
    const column = table === "tenants" ? sql`id` : sql`tenant_id`;
    data[table] = await rows(tx, sql`select * from ${sql.identifier(table)} where ${column} = ${tenantId}`);
  }
  return { exportedAt: new Date().toISOString(), subject: "tenant", tables: data };
}

export async function processExportRequest(requestId: string, jobTenantId: string | null = null) {
  const [req] = await db().select().from(schema.dataRequests).where(eq(schema.dataRequests.id, requestId));
  if (!req || req.status === "completed" || (jobTenantId && req.tenantId !== jobTenantId)) return;
  await db().update(schema.dataRequests).set({ status: "processing" }).where(eq(schema.dataRequests.id, req.id));
  try {
    const bundle: unknown = await withSystemTx((tx): Promise<unknown> =>
      req.subjectType === "contact" ? buildContactExport(tx, req.tenantId, req.subjectId!) : buildTenantExport(tx, req.tenantId),
    );
    const key = `${req.tenantId}/exports/${req.id}.json`;
    await storage().put(key, Buffer.from(JSON.stringify(bundle, null, 2)), "application/json");
    await db()
      .update(schema.dataRequests)
      .set({ status: "completed", fileStorageKey: key, completedAt: new Date(), error: null })
      .where(eq(schema.dataRequests.id, req.id));
  } catch (e) {
    await db()
      .update(schema.dataRequests)
      .set({ status: "failed", error: (e instanceof Error ? e.message : String(e)).slice(0, 500) })
      .where(eq(schema.dataRequests.id, req.id));
    throw e;
  }
}

/* ------------------------------------------------------------- erasure */

/**
 * Permanently erases a contact: the row and everything that cascades from it
 * (notes, activities, tasks, conversations, messages, consents, attachments,
 * leads about the same person), stored files, and PII in audit metadata.
 * `confirmation` must equal the contact's display name.
 */
export async function eraseContact(ctx: ServiceCtx, contactId: string, confirmation: string) {
  assertCanWrite(ctx, "privacy.manage");
  const contact = await ctx.run((tx) => loadContact(tx, ctx.tenantId, contactId)).catch(async (e) => {
    // Soft-deleted contacts can still be erased.
    const [row] = await db()
      .select()
      .from(schema.contacts)
      .where(and(eq(schema.contacts.id, contactId), eq(schema.contacts.tenantId, ctx.tenantId)));
    if (!row) throw e;
    return row;
  });
  if (confirmation.trim() !== contactDisplayName(contact)) {
    throw new AppError("VALIDATION", "privacy.confirmMismatch", { confirmation: ["privacy.confirmMismatch"] });
  }
  const t = ctx.tenantId;
  const objectKeys = await withSystemTx(async (tx) => {
    const attachmentKeys = (
      await tx.select({ key: schema.attachments.storageKey }).from(schema.attachments).where(and(eq(schema.attachments.tenantId, t), eq(schema.attachments.contactId, contactId)))
    ).map((r) => r.key);
    const mediaKeys = (
      await tx.execute<{ key: string | null }>(sql`
        select m.media->>'storageKey' as key from public.messages m
        join public.conversations c on c.id = m.conversation_id
        where c.tenant_id = ${t} and c.contact_id = ${contactId} and m.media ? 'storageKey'`)
    )
      .map((r) => r.key)
      .filter((k): k is string => Boolean(k));
    await tx.execute(sql`delete from public.leads where tenant_id = ${t} and contact_id = ${contactId}`);
    await tx.delete(schema.contacts).where(and(eq(schema.contacts.id, contactId), eq(schema.contacts.tenantId, t)));
    // Audit rows stay (accountability) but lose personal data.
    await tx.execute(sql`
      update public.audit_logs set metadata = jsonb_build_object('redacted', true)
      where tenant_id = ${t} and entity_type = 'contact' and entity_id = ${contactId}`);
    await tx.insert(schema.dataRequests).values({
      tenantId: t,
      type: "delete",
      subjectType: "contact",
      subjectId: contactId,
      status: "completed",
      requestedBy: ctx.userId,
      completedAt: new Date(),
    });
    await tx.insert(schema.auditLogs).values({
      tenantId: t,
      actorUserId: ctx.userId,
      actorType: "user",
      action: "privacy.contact_erased",
      entityType: "contact",
      entityId: contactId,
      metadata: { files: attachmentKeys.length + mediaKeys.length },
    });
    return [...attachmentKeys, ...mediaKeys].filter((k) => !k.startsWith("deleted/"));
  });
  for (const key of objectKeys) await storage().delete(key).catch((e) => logger().warn({ key, err: String(e) }, "erase: object delete failed"));
  return { filesDeleted: objectKeys.length };
}

/* ------------------------------------------------------- tenant deletion */

export async function requestTenantDeletion(ctx: ServiceCtx, confirmName: string) {
  assertCanWrite(ctx, "privacy.manage");
  const [tenant] = await db().select().from(schema.tenants).where(eq(schema.tenants.id, ctx.tenantId));
  if (!tenant || tenant.deletedAt) throw new AppError("NOT_FOUND", "errors.notFound");
  if (confirmName.trim() !== tenant.name) {
    throw new AppError("VALIDATION", "privacy.confirmMismatch", { confirmName: ["privacy.confirmMismatch"] });
  }
  const purgeAfter = new Date(Date.now() + TENANT_PURGE_GRACE_DAYS * 86400_000);
  await withSystemTx(async (tx) => {
    await tx.update(schema.tenants).set({ deletedAt: new Date(), purgeAfter }).where(eq(schema.tenants.id, ctx.tenantId));
    await tx.insert(schema.dataRequests).values({
      tenantId: ctx.tenantId,
      type: "delete",
      subjectType: "tenant",
      subjectId: ctx.tenantId,
      status: "pending",
      requestedBy: ctx.userId,
      scheduledFor: purgeAfter,
    });
    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      actorType: "user",
      action: "privacy.tenant_deletion_requested",
      entityType: "tenant",
      entityId: ctx.tenantId,
      metadata: { purgeAfter: purgeAfter.toISOString() },
    });
    await tx.execute(sql`
      insert into public.notifications (tenant_id, user_id, type, title, body)
      select m.tenant_id, m.user_id, 'tenant_deletion',
             case when p.locale = 'en' then ${`Organization "${tenant.name}" scheduled for deletion`} else ${`הארגון "${tenant.name}" תוזמן למחיקה`} end,
             case when p.locale = 'en' then ${`All data will be permanently deleted on ${purgeAfter.toISOString().slice(0, 10)}. Contact support to cancel.`}
                  else ${`כל הנתונים יימחקו לצמיתות ב-${purgeAfter.toISOString().slice(0, 10)}. לביטול פנו לתמיכה.`} end
      from public.memberships m join public.profiles p on p.id = m.user_id
      where m.tenant_id = ${ctx.tenantId} and m.role = 'owner' and m.status = 'active'`);
  });
  return { purgeAfter };
}

/** Platform-admin: cancels a pending tenant deletion during the grace period. */
export async function restoreTenant(tenantId: string, adminUserId: string) {
  await withSystemTx(async (tx) => {
    const [t] = await tx
      .update(schema.tenants)
      .set({ deletedAt: null, purgeAfter: null })
      .where(and(eq(schema.tenants.id, tenantId), isNotNull(schema.tenants.deletedAt)))
      .returning();
    if (!t) throw new AppError("NOT_FOUND", "errors.notFound");
    await tx
      .update(schema.dataRequests)
      .set({ status: "canceled" })
      .where(and(eq(schema.dataRequests.tenantId, tenantId), eq(schema.dataRequests.subjectType, "tenant"), eq(schema.dataRequests.type, "delete"), eq(schema.dataRequests.status, "pending")));
    await tx.insert(schema.auditLogs).values({ tenantId, actorUserId: adminUserId, actorType: "admin", action: "privacy.tenant_restored", entityType: "tenant", entityId: tenantId });
  });
}

/** Hard-deletes tenants whose grace period has ended, including stored objects. */
export async function purgeDeletedTenants(now = new Date()): Promise<number> {
  const due = await db()
    .select({ id: schema.tenants.id, name: schema.tenants.name })
    .from(schema.tenants)
    .where(and(isNotNull(schema.tenants.deletedAt), lte(schema.tenants.purgeAfter, now)));
  for (const t of due) {
    const keys = await withSystemTx(async (tx) => {
      const found = await tx.execute<{ key: string | null }>(sql`
        select storage_key as key from public.attachments where tenant_id = ${t.id}
        union all select logo_path from public.tenants where id = ${t.id}
        union all select file_storage_key from public.data_requests where tenant_id = ${t.id}
        union all select pdf_storage_key from public.quotes where tenant_id = ${t.id}
        union all select m.media->>'storageKey' from public.messages m where m.tenant_id = ${t.id}`);
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, t.id));
      await tx.insert(schema.auditLogs).values({
        tenantId: null,
        actorType: "system",
        action: "privacy.tenant_purged",
        entityType: "tenant",
        entityId: t.id,
        metadata: { objects: found.length },
      });
      return found.map((r) => r.key).filter((k): k is string => Boolean(k) && !k!.startsWith("deleted/"));
    });
    for (const key of keys) await storage().delete(key).catch(() => undefined);
    logger().info({ tenantId: t.id, objects: keys.length }, "tenant purged");
  }
  return due.length;
}

/** Applies each tenant's retention settings (messages / AI logs older than N days). */
export async function applyRetention(): Promise<{ messages: number; aiLogs: number }> {
  const messages = await db().execute<{ key: string | null }>(sql`
    delete from public.messages m using public.tenants t
    where m.tenant_id = t.id
      and (t.settings #>> '{retention,messagesDays}') ~ '^[0-9]+$'
      and m.created_at < now() - make_interval(days => (t.settings #>> '{retention,messagesDays}')::int)
    returning m.media->>'storageKey' as key`);
  for (const { key } of messages) if (key) await storage().delete(key).catch(() => undefined);
  const aiLogs = await db().execute(sql`
    delete from public.ai_interactions a using public.tenants t
    where a.tenant_id = t.id
      and (t.settings #>> '{retention,aiLogsDays}') ~ '^[0-9]+$'
      and a.created_at < now() - make_interval(days => (t.settings #>> '{retention,aiLogsDays}')::int)
    returning a.id`);
  return { messages: messages.length, aiLogs: aiLogs.length };
}


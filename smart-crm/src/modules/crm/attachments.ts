import { and, desc, eq, isNull } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db, schema } from "@/server/db";
import { assertCan, assertCanWrite, type ServiceCtx } from "@/server/context";
import { audit } from "@/server/audit";
import { AppError } from "@/server/errors";
import { sanitizeFileName, storage, storageKey, validateUpload } from "@/server/storage";
import { assertEntityExists, recordActivity, refFor, type EntityKind } from "./activities";

export type AttachmentView = { id: string; fileName: string; mimeType: string; sizeBytes: number; createdAt: Date; uploadedByName: string | null };

const PERM: Record<EntityKind, { view: "contacts.view"; update: "contacts.update" }> = {
  contact: { view: "contacts.view", update: "contacts.update" },
  company: { view: "companies.view" as "contacts.view", update: "companies.update" as "contacts.update" },
  deal: { view: "deals.view" as "contacts.view", update: "deals.update" as "contacts.update" },
  lead: { view: "leads.view" as "contacts.view", update: "leads.update" as "contacts.update" },
};

const colFor = (kind: EntityKind) =>
  ({ contact: schema.attachments.contactId, company: schema.attachments.companyId, deal: schema.attachments.dealId, lead: schema.attachments.leadId })[kind];

export async function listAttachments(ctx: ServiceCtx, kind: EntityKind, entityId: string): Promise<AttachmentView[]> {
  assertCan(ctx, PERM[kind].view);
  return ctx.run(async (tx) => {
    const rows = await tx
      .select({ a: schema.attachments, by: schema.profiles.fullName })
      .from(schema.attachments)
      .leftJoin(schema.profiles, eq(schema.profiles.id, schema.attachments.uploadedBy))
      .where(and(eq(schema.attachments.tenantId, ctx.tenantId), eq(colFor(kind), entityId), isNull(schema.attachments.deletedAt)))
      .orderBy(desc(schema.attachments.createdAt));
    return rows.map((r) => ({
      id: r.a.id,
      fileName: r.a.fileName,
      mimeType: r.a.mimeType,
      sizeBytes: r.a.sizeBytes,
      createdAt: r.a.createdAt,
      uploadedByName: r.by,
    }));
  });
}

/**
 * Stores the file first, then records it. If the DB write fails the orphaned
 * object is removed, so storage never holds unreferenced customer files.
 */
export async function uploadAttachment(ctx: ServiceCtx, kind: EntityKind, entityId: string, file: { name: string; type: string; bytes: Buffer }) {
  assertCanWrite(ctx, PERM[kind].update);
  validateUpload({ name: file.name, type: file.type, size: file.bytes.length });
  await ctx.run((tx) => assertEntityExists(tx, ctx.tenantId, kind, entityId));
  const key = storageKey(ctx.tenantId, `attachments/${kind}`, file.name);
  await storage().put(key, file.bytes, file.type);
  try {
    return await ctx.run(async (tx) => {
      const [row] = await tx
        .insert(schema.attachments)
        .values({
          tenantId: ctx.tenantId,
          ...refFor(kind, entityId),
          storageKey: key,
          fileName: sanitizeFileName(file.name),
          mimeType: file.type,
          sizeBytes: file.bytes.length,
          sha256: createHash("sha256").update(file.bytes).digest("hex"),
          uploadedBy: ctx.userId,
        })
        .returning();
      await recordActivity(tx, ctx, { ...refFor(kind, entityId), type: "file_uploaded", subject: row.fileName, metadata: { attachmentId: row.id } });
      await audit(tx, ctx, { action: "attachment.uploaded", entityType: "attachment", entityId: row.id, metadata: { kind, entityId, size: row.sizeBytes } });
      return row;
    });
  } catch (e) {
    await storage().delete(key).catch(() => undefined);
    throw e;
  }
}

/** Authorizes through RLS, then returns a short-lived download URL. */
export async function attachmentDownloadUrl(ctx: ServiceCtx, attachmentId: string): Promise<string> {
  const row = await ctx.run(async (tx) => {
    const [a] = await tx
      .select()
      .from(schema.attachments)
      .where(and(eq(schema.attachments.id, attachmentId), eq(schema.attachments.tenantId, ctx.tenantId), isNull(schema.attachments.deletedAt)));
    return a;
  });
  if (!row) throw new AppError("NOT_FOUND", "errors.notFound");
  const kind: EntityKind = row.contactId ? "contact" : row.companyId ? "company" : row.dealId ? "deal" : "lead";
  assertCan(ctx, PERM[kind].view);
  return storage().signedUrl(row.storageKey, 120, row.fileName);
}

export async function deleteAttachment(ctx: ServiceCtx, attachmentId: string) {
  const row = await ctx.run(async (tx) => {
    const [a] = await tx
      .select()
      .from(schema.attachments)
      .where(and(eq(schema.attachments.id, attachmentId), eq(schema.attachments.tenantId, ctx.tenantId), isNull(schema.attachments.deletedAt)));
    if (!a) throw new AppError("NOT_FOUND", "errors.notFound");
    const kind: EntityKind = a.contactId ? "contact" : a.companyId ? "company" : a.dealId ? "deal" : "lead";
    assertCanWrite(ctx, PERM[kind].update);
    await tx.update(schema.attachments).set({ deletedAt: new Date() }).where(eq(schema.attachments.id, attachmentId));
    await audit(tx, ctx, { action: "attachment.deleted", entityType: "attachment", entityId: attachmentId });
    return a;
  });
  // Object removal happens after the row is soft-deleted; failures are retried by retention purge.
  await storage().delete(row.storageKey).catch(() => undefined);
  await db().update(schema.attachments).set({ storageKey: `deleted/${row.id}` }).where(eq(schema.attachments.id, row.id)).catch(() => undefined);
}

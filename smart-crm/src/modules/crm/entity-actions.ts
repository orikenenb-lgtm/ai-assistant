"use server";

import { z } from "zod";
import { tenantAction, type ActionResult } from "@/server/action";
import { addNote, deleteNote, listNotes, listTimeline, logActivity, logActivitySchema, noteInputSchema, updateNote, type NoteView, type TimelineItem } from "./activities";
import { createTag, tagInputSchema, type TagView } from "./tags";
import { deleteAttachment, listAttachments, type AttachmentView } from "./attachments";

/** Actions shared by contacts, companies, deals and leads (notes, timeline, files, tags). */
const id = z.object({ id: z.uuid() });
const entity = z.object({ kind: z.enum(["contact", "company", "deal", "lead"]), entityId: z.uuid() });

export async function listNotesAction(input: unknown): Promise<ActionResult<NoteView[]>> {
  return tenantAction(input, { schema: entity, write: false }, ({ kind, entityId }, { ctx }) => listNotes(ctx, kind, entityId));
}

export async function listTimelineAction(input: unknown): Promise<ActionResult<{ items: TimelineItem[]; hasMore: boolean }>> {
  return tenantAction(input, { schema: entity.extend({ before: z.coerce.date().optional() }), write: false }, ({ kind, entityId, before }, { ctx }) =>
    listTimeline(ctx, kind, entityId, { before }),
  );
}

export async function listAttachmentsAction(input: unknown): Promise<ActionResult<AttachmentView[]>> {
  return tenantAction(input, { schema: entity, write: false }, ({ kind, entityId }, { ctx }) => listAttachments(ctx, kind, entityId));
}

export async function addNoteAction(input: unknown): Promise<ActionResult> {
  return tenantAction(input, { schema: entity.extend(noteInputSchema.shape) }, async ({ kind, entityId, body }, { ctx }) => {
    await addNote(ctx, kind, entityId, body);
    return null;
  });
}

export async function updateNoteAction(input: unknown): Promise<ActionResult> {
  return tenantAction(
    input,
    { schema: z.object({ id: z.uuid(), body: z.string().trim().min(1).max(10000).optional(), pinned: z.boolean().optional() }) },
    async ({ id, ...rest }, { ctx }) => {
      await updateNote(ctx, id, rest);
      return null;
    },
  );
}

export async function deleteNoteAction(input: unknown): Promise<ActionResult> {
  return tenantAction(input, { schema: id }, async ({ id }, { ctx }) => {
    await deleteNote(ctx, id);
    return null;
  });
}

export async function logActivityAction(input: unknown): Promise<ActionResult> {
  return tenantAction(input, { schema: entity.extend(logActivitySchema.shape) }, async ({ kind, entityId, ...data }, { ctx }) => {
    await logActivity(ctx, kind, entityId, data);
    return null;
  });
}

export async function createTagAction(input: unknown): Promise<ActionResult<TagView>> {
  return tenantAction(input, { schema: tagInputSchema, permission: "contacts.update" }, (data, { ctx }) => createTag(ctx, data));
}

export async function deleteAttachmentAction(input: unknown): Promise<ActionResult> {
  return tenantAction(input, { schema: id }, async ({ id }, { ctx }) => {
    await deleteAttachment(ctx, id);
    return null;
  });
}

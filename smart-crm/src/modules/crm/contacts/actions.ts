"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { tenantAction, type ActionResult } from "@/server/action";
import { contactInputSchema, optionalEmail, optionalPhone } from "../schemas";
import {
  createContact,
  deleteContact,
  findDuplicateCandidates,
  mergeContacts,
  setContactTags,
  setWhatsappConsent,
  updateContact,
  type DuplicateCandidate,
} from "./service";
import { importContacts, importOptionsSchema, type ImportReport } from "./import-export";

const id = z.object({ id: z.uuid() });

export async function createContactAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return tenantAction(input, { schema: contactInputSchema, permission: "contacts.create" }, async (data, { ctx }) => {
    const c = await createContact(ctx, data);
    revalidatePath("/contacts");
    return { id: c.id };
  });
}

export async function updateContactAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return tenantAction(
    input,
    { schema: z.object({ id: z.uuid(), data: contactInputSchema }), permission: "contacts.update" },
    async ({ id, data }, { ctx }) => {
      await updateContact(ctx, id, data);
      revalidatePath(`/contacts/${id}`);
      return { id };
    },
  );
}

export async function deleteContactAction(input: unknown): Promise<ActionResult> {
  return tenantAction(input, { schema: id, permission: "contacts.delete" }, async ({ id }, { ctx }) => {
    await deleteContact(ctx, id);
    revalidatePath("/contacts");
    return null;
  });
}

export async function checkDuplicatesAction(input: unknown): Promise<ActionResult<DuplicateCandidate[]>> {
  return tenantAction(
    input,
    { schema: z.object({ email: optionalEmail.catch(null), phone: optionalPhone.catch(null), excludeId: z.uuid().optional() }), write: false },
    (data, { ctx }) => findDuplicateCandidates(ctx, data),
  );
}

export async function mergeContactsAction(input: unknown): Promise<ActionResult<{ primaryId: string }>> {
  return tenantAction(
    input,
    { schema: z.object({ primaryId: z.uuid(), duplicateId: z.uuid() }), permission: "contacts.merge" },
    async (data, { ctx }) => {
      const r = await mergeContacts(ctx, data.primaryId, data.duplicateId);
      revalidatePath("/contacts");
      return r;
    },
  );
}

export async function setConsentAction(input: unknown): Promise<ActionResult> {
  return tenantAction(
    input,
    {
      schema: z.object({ contactId: z.uuid(), status: z.enum(["opted_in", "opted_out"]), evidence: z.string().trim().max(1000).optional() }),
      permission: "inbox.consent",
    },
    async ({ contactId, status, evidence }, { ctx }) => {
      await setWhatsappConsent(ctx, contactId, { status, source: "manual", evidence });
      revalidatePath(`/contacts/${contactId}`);
      return null;
    },
  );
}

export async function importContactsAction(input: unknown): Promise<ActionResult<ImportReport>> {
  return tenantAction(input, { schema: importOptionsSchema, permission: "contacts.import" }, async (data, { ctx }) => {
    const report = await importContacts(ctx, data);
    revalidatePath("/contacts");
    return report;
  });
}

export async function setContactTagsAction(input: unknown): Promise<ActionResult> {
  return tenantAction(
    input,
    { schema: z.object({ contactId: z.uuid(), tagIds: z.array(z.uuid()).max(50) }), permission: "contacts.update" },
    async ({ contactId, tagIds }, { ctx }) => {
      await setContactTags(ctx, contactId, tagIds);
      return null;
    },
  );
}

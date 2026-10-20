"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq, ilike, isNull } from "drizzle-orm";
import { z } from "zod";
import { publicAction, tenantAction, type ActionResult } from "@/server/action";
import { requestInfo } from "@/server/auth";
import { schema } from "@/server/db";
import { likePattern } from "@/modules/search/service";
import { optionalEmail } from "@/modules/crm/schemas";
import { decisionSchema, quoteInputSchema, templateInputSchema } from "./schemas";
import {
  createInvoiceForQuote,
  createQuote,
  deleteQuote,
  duplicateQuote,
  recordPublicView,
  regenerateQuoteLink,
  respondToQuote,
  sendQuote,
  setMockAccountingConnection,
  setQuoteStatus,
  updateQuote,
} from "./service";
import { createTemplate, deleteTemplate, updateDocumentSettings, updateTemplate } from "./templates";
import { parsePercent } from "./totals";

const id = z.object({ id: z.uuid() });

export async function createQuoteAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return tenantAction(input, { schema: quoteInputSchema, permission: "documents.create" }, async (data, { ctx }) => {
    const q = await createQuote(ctx, data);
    revalidatePath("/quotes");
    return { id: q.id };
  });
}

export async function updateQuoteAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return tenantAction(input, { schema: z.object({ id: z.uuid(), data: quoteInputSchema }), permission: "documents.update" }, async ({ id, data }, { ctx }) => {
    await updateQuote(ctx, id, data);
    revalidatePath(`/quotes/${id}`);
    return { id };
  });
}

export async function deleteQuoteAction(input: unknown): Promise<ActionResult> {
  return tenantAction(input, { schema: id, permission: "documents.delete" }, async ({ id }, { ctx }) => {
    await deleteQuote(ctx, id);
    revalidatePath("/quotes");
    return null;
  });
}

export async function duplicateQuoteAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return tenantAction(input, { schema: id, permission: "documents.create" }, async ({ id }, { ctx }) => {
    const q = await duplicateQuote(ctx, id);
    revalidatePath("/quotes");
    return { id: q.id };
  });
}

export async function sendQuoteAction(input: unknown): Promise<ActionResult<{ publicUrl: string; emailed: boolean }>> {
  return tenantAction(
    input,
    { schema: z.object({ id: z.uuid(), emailTo: optionalEmail }), permission: "documents.update" },
    async ({ id, emailTo }, { ctx }) => {
      const r = await sendQuote(ctx, id, { emailTo });
      revalidatePath(`/quotes/${id}`);
      return r;
    },
  );
}

export async function regenerateQuoteLinkAction(input: unknown): Promise<ActionResult<{ publicUrl: string }>> {
  return tenantAction(input, { schema: id, permission: "documents.update" }, ({ id }, { ctx }) => regenerateQuoteLink(ctx, id));
}

export async function setQuoteStatusAction(input: unknown): Promise<ActionResult> {
  return tenantAction(
    input,
    {
      schema: z.object({ id: z.uuid(), status: z.enum(["canceled", "accepted", "rejected"]), note: z.string().trim().max(1000).optional().nullable() }),
      permission: "documents.update",
    },
    async ({ id, status, note }, { ctx }) => {
      await setQuoteStatus(ctx, id, status, note);
      revalidatePath(`/quotes/${id}`);
      return null;
    },
  );
}

export async function createInvoiceAction(input: unknown): Promise<ActionResult<{ externalId: string }>> {
  return tenantAction(input, { schema: id, permission: "documents.update" }, async ({ id }, { ctx }) => {
    const r = await createInvoiceForQuote(ctx, id);
    revalidatePath(`/quotes/${id}`);
    return r;
  });
}

export async function searchDealsForQuoteAction(input: unknown): Promise<ActionResult<{ id: string; name: string }[]>> {
  return tenantAction(input, { schema: z.object({ q: z.string().max(100).default("") }), permission: "deals.view", write: false }, ({ q }, { ctx }) =>
    ctx.run(async (tx) => {
      const rows = await tx
        .select({ id: schema.deals.id, name: schema.deals.title })
        .from(schema.deals)
        .where(
          and(
            eq(schema.deals.tenantId, ctx.tenantId),
            isNull(schema.deals.deletedAt),
            q.trim() ? ilike(schema.deals.title, likePattern(q.trim())) : undefined,
          ),
        )
        .orderBy(asc(schema.deals.title))
        .limit(10);
      return rows;
    }),
  );
}

/* --------------------------------------------------------- templates/settings */

export async function saveTemplateAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return tenantAction(
    input,
    { schema: z.object({ id: z.uuid().optional(), data: templateInputSchema }), permission: "documents.templates" },
    async ({ id, data }, { ctx }) => {
      const row = id ? await updateTemplate(ctx, id, data) : await createTemplate(ctx, data);
      revalidatePath("/settings/documents");
      return { id: row.id };
    },
  );
}

export async function deleteTemplateAction(input: unknown): Promise<ActionResult> {
  return tenantAction(input, { schema: id, permission: "documents.templates" }, async ({ id }, { ctx }) => {
    await deleteTemplate(ctx, id);
    revalidatePath("/settings/documents");
    return null;
  });
}

export async function saveDocumentSettingsAction(input: unknown): Promise<ActionResult> {
  return tenantAction(
    input,
    {
      schema: z.object({
        defaultTaxRatePercent: z
          .union([z.string(), z.number()])
          .transform((v, c) => {
            const bp = parsePercent(String(v).trim());
            if (bp === null) {
              c.addIssue({ code: "custom", message: "quotes.invalidPercent" });
              return z.NEVER;
            }
            return bp;
          }),
      }),
      permission: "documents.templates",
    },
    async ({ defaultTaxRatePercent }, { ctx }) => {
      await updateDocumentSettings(ctx, { defaultTaxRateBp: defaultTaxRatePercent });
      revalidatePath("/settings/documents");
      return null;
    },
  );
}

export async function setMockAccountingAction(input: unknown): Promise<ActionResult> {
  return tenantAction(input, { schema: z.object({ connected: z.boolean() }), permission: "integrations.manage" }, async ({ connected }, { ctx }) => {
    await setMockAccountingConnection(ctx, connected);
    revalidatePath("/settings/documents");
    return null;
  });
}

/* ------------------------------------------------------------ public link */

const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{20,100}$/);

export async function recordQuoteViewAction(input: unknown): Promise<ActionResult> {
  return publicAction(input, z.object({ token: tokenSchema }), async ({ token }) => {
    await recordPublicView(token, await requestInfo());
    return null;
  });
}

export async function respondToQuoteAction(input: unknown): Promise<ActionResult<{ status: string }>> {
  return publicAction(input, decisionSchema.extend({ token: tokenSchema }), async ({ token, ...decision }) => {
    const r = await respondToQuote(token, decision, await requestInfo());
    revalidatePath(`/q/${token}`);
    return r;
  });
}

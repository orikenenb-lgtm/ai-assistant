import { and, asc, count, desc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import { schema, withSystemTx, type Executor, type Tx } from "@/server/db";
import { assertCan, assertCanWrite, systemCtx, type RequestMeta, type ServiceCtx } from "@/server/context";
import { audit } from "@/server/audit";
import { emitEvent } from "@/server/events";
import { AppError } from "@/server/errors";
import { env } from "@/server/env";
import { randomToken, sha256Hex } from "@/server/crypto";
import { sendEmail } from "@/server/email";
import { hitRateLimit } from "@/server/rate-limit";
import { storage, storageKey } from "@/server/storage";
import { recordActivity, type EntityRef } from "@/modules/crm/activities";
import { contactDisplayName } from "@/modules/crm/contacts/service";
import { likePattern } from "@/modules/search/service";
import { assertFeature, getEntitlements } from "@/modules/billing/entitlements";
import { notify, type NotificationType } from "@/modules/notifications/service";
import { renderQuotePdf, formatPdfMoney, type QuotePdfData } from "./pdf";
import { canTransition, isAwaitingDecision, isEditable, type QuoteStatus } from "./status";
import { computeQuoteTotals, decimalStringToMilli, milliToDecimalString, type QuoteTotals } from "./totals";
import { defaultTemplate, taxRateFromSettings } from "./templates";
import { resolveInvoicingProvider } from "./invoicing";
import type { QuoteInput, QuoteListQuery } from "./schemas";

export type QuoteRow = typeof schema.quotes.$inferSelect;
export type QuoteItemRow = typeof schema.quoteItems.$inferSelect;

/* ---------------------------------------------------------------- helpers */

/** YYYY-MM-DD in the given IANA time zone. */
export function todayIn(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

export function publicQuoteUrl(token: string) {
  return `${env().APP_URL}/q/${token}`;
}

async function loadQuote(tx: Tx, tenantId: string, id: string, opts: { forUpdate?: boolean } = {}): Promise<QuoteRow> {
  const q = tx.select().from(schema.quotes).where(and(eq(schema.quotes.id, id), eq(schema.quotes.tenantId, tenantId)));
  const [row] = opts.forUpdate ? await q.for("update") : await q;
  if (!row) throw new AppError("NOT_FOUND", "errors.notFound");
  return row;
}

async function loadItems(tx: Executor, quoteId: string): Promise<QuoteItemRow[]> {
  return tx.select().from(schema.quoteItems).where(eq(schema.quoteItems.quoteId, quoteId)).orderBy(asc(schema.quoteItems.position));
}

/** Linked records must exist in the same tenant (the DB enforces it too). */
async function assertLinks(tx: Tx, tenantId: string, input: Pick<QuoteInput, "contactId" | "companyId" | "dealId" | "templateId">) {
  const checks: [string | null, () => Promise<unknown[]>, string][] = [
    [
      input.contactId,
      () =>
        tx
          .select({ id: schema.contacts.id })
          .from(schema.contacts)
          .where(and(eq(schema.contacts.id, input.contactId!), eq(schema.contacts.tenantId, tenantId), isNull(schema.contacts.deletedAt))),
      "contactId",
    ],
    [
      input.companyId,
      () =>
        tx
          .select({ id: schema.companies.id })
          .from(schema.companies)
          .where(and(eq(schema.companies.id, input.companyId!), eq(schema.companies.tenantId, tenantId), isNull(schema.companies.deletedAt))),
      "companyId",
    ],
    [
      input.dealId,
      () =>
        tx
          .select({ id: schema.deals.id })
          .from(schema.deals)
          .where(and(eq(schema.deals.id, input.dealId!), eq(schema.deals.tenantId, tenantId), isNull(schema.deals.deletedAt))),
      "dealId",
    ],
    [
      input.templateId,
      () =>
        tx
          .select({ id: schema.documentTemplates.id })
          .from(schema.documentTemplates)
          .where(and(eq(schema.documentTemplates.id, input.templateId!), eq(schema.documentTemplates.tenantId, tenantId))),
      "templateId",
    ],
  ];
  for (const [id, query, field] of checks) {
    if (id && (await query()).length === 0) throw new AppError("VALIDATION", "errors.relatedMissing", { [field]: ["errors.relatedMissing"] });
  }
}

function totalsFor(input: Pick<QuoteInput, "items" | "discountPercent" | "taxRatePercent">): QuoteTotals {
  return computeQuoteTotals({
    lines: input.items.map((i) => ({ quantityMilli: i.quantity, unitPriceCents: i.unitPrice, discountBp: i.discountPercent })),
    discountBp: input.discountPercent,
    taxRateBp: input.taxRatePercent,
  });
}

async function writeItems(tx: Tx, tenantId: string, quoteId: string, input: QuoteInput, totals: QuoteTotals) {
  await tx.delete(schema.quoteItems).where(eq(schema.quoteItems.quoteId, quoteId));
  await tx.insert(schema.quoteItems).values(
    input.items.map((item, i) => ({
      tenantId,
      quoteId,
      position: i,
      description: item.description,
      quantity: milliToDecimalString(item.quantity),
      unitPriceCents: item.unitPrice,
      discountBp: item.discountPercent,
      lineTotalCents: totals.lines[i].totalCents,
    })),
  );
}

function entityRefs(q: Pick<QuoteRow, "contactId" | "companyId" | "dealId">): EntityRef | null {
  if (!q.contactId && !q.companyId && !q.dealId) return null;
  return { contactId: q.contactId, companyId: q.companyId, dealId: q.dealId };
}

async function activity(tx: Tx, ctx: ServiceCtx, q: QuoteRow, type: "quote_created" | "quote_sent" | "quote_status", metadata: Record<string, unknown>) {
  const refs = entityRefs(q);
  if (!refs) return; // timeline entries need a CRM record to hang on
  await recordActivity(tx, ctx, { ...refs, type, subject: `#${q.number} · ${q.title}`, metadata: { quoteId: q.id, ...metadata } });
}

/* ------------------------------------------------------------------ reads */

export type QuoteListItem = {
  id: string;
  number: number;
  title: string;
  status: QuoteStatus;
  totalCents: number;
  currency: string;
  issueDate: string;
  validUntil: string | null;
  contactName: string | null;
  companyName: string | null;
  createdAt: Date;
};

export async function listQuotes(ctx: ServiceCtx, q: QuoteListQuery): Promise<{ rows: QuoteListItem[]; total: number; openTotalCents: number; currency: string }> {
  assertCan(ctx, "documents.view");
  return ctx.run(async (tx) => {
    const conds: (SQL | undefined)[] = [eq(schema.quotes.tenantId, ctx.tenantId)];
    if (q.status) conds.push(eq(schema.quotes.status, q.status));
    if (q.q) {
      const pattern = likePattern(q.q);
      const digits = q.q.replace(/^#/, "");
      conds.push(
        or(
          /^\d{1,12}$/.test(digits) ? eq(schema.quotes.number, Number(digits)) : undefined,
          ilike(schema.quotes.title, pattern),
          sql`${schema.contacts.searchText} like ${pattern}`,
          ilike(schema.companies.name, pattern),
        ),
      );
    }
    const where = and(...conds);
    const base = tx
      .select({ n: count() })
      .from(schema.quotes)
      .leftJoin(schema.contacts, eq(schema.contacts.id, schema.quotes.contactId))
      .leftJoin(schema.companies, eq(schema.companies.id, schema.quotes.companyId))
      .where(where);
    const [{ n: total }] = await base;
    const rows = await tx
      .select({ q: schema.quotes, contact: schema.contacts, companyName: schema.companies.name })
      .from(schema.quotes)
      .leftJoin(schema.contacts, eq(schema.contacts.id, schema.quotes.contactId))
      .leftJoin(schema.companies, eq(schema.companies.id, schema.quotes.companyId))
      .where(where)
      .orderBy(desc(schema.quotes.number))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    // Open pipeline in the tenant's currency only (amounts in other currencies aren't summable).
    const [open] = await tx.execute<{ s: string | null; currency: string }>(sql`
      select coalesce(sum(q.total_cents), 0)::text as s, t.currency
      from public.tenants t
      left join public.quotes q on q.tenant_id = t.id and q.status in ('sent', 'viewed') and q.currency = t.currency
      where t.id = ${ctx.tenantId}
      group by t.currency`);
    return {
      total,
      openTotalCents: Number(open?.s ?? 0),
      currency: open?.currency ?? "ILS",
      rows: rows.map((r) => ({
        id: r.q.id,
        number: r.q.number,
        title: r.q.title,
        status: r.q.status as QuoteStatus,
        totalCents: r.q.totalCents,
        currency: r.q.currency,
        issueDate: r.q.issueDate,
        validUntil: r.q.validUntil,
        contactName: r.contact ? contactDisplayName(r.contact) : null,
        companyName: r.companyName,
        createdAt: r.q.createdAt,
      })),
    };
  });
}

export type QuoteDetail = {
  quote: QuoteRow;
  items: (QuoteItemRow & { quantityMilli: number })[];
  contact: { id: string; name: string; email: string | null; phone: string | null } | null;
  company: { id: string; name: string } | null;
  deal: { id: string; title: string } | null;
  createdByName: string | null;
  canInvoice: boolean;
  invoicingLabel: string | null;
};

export async function getQuote(ctx: ServiceCtx, id: string): Promise<QuoteDetail> {
  assertCan(ctx, "documents.view");
  return ctx.run(async (tx) => {
    const quote = await loadQuote(tx, ctx.tenantId, id);
    const items = (await loadItems(tx, id)).map((i) => ({ ...i, quantityMilli: decimalStringToMilli(i.quantity) }));
    const [contact] = quote.contactId ? await tx.select().from(schema.contacts).where(eq(schema.contacts.id, quote.contactId)) : [];
    const [company] = quote.companyId ? await tx.select({ id: schema.companies.id, name: schema.companies.name }).from(schema.companies).where(eq(schema.companies.id, quote.companyId)) : [];
    const [deal] = quote.dealId ? await tx.select({ id: schema.deals.id, title: schema.deals.title }).from(schema.deals).where(eq(schema.deals.id, quote.dealId)) : [];
    const [creator] = quote.createdBy ? await tx.select({ fullName: schema.profiles.fullName }).from(schema.profiles).where(eq(schema.profiles.id, quote.createdBy)) : [];
    const provider = quote.status === "accepted" && !quote.externalInvoiceId ? await resolveInvoicingProvider(tx, ctx.tenantId) : null;
    return {
      quote,
      items,
      contact: contact ? { id: contact.id, name: contactDisplayName(contact), email: contact.email, phone: contact.phone } : null,
      company: company ?? null,
      deal: deal ?? null,
      createdByName: creator?.fullName ?? null,
      canInvoice: Boolean(provider),
      invoicingLabel: provider?.label ?? null,
    };
  });
}

export type QuoteDefaults = {
  language: "he" | "en";
  currency: string;
  taxRateBp: number;
  issueDate: string;
  validUntil: string;
  terms: string | null;
  templateId: string | null;
  title: string;
  contact: { id: string; name: string } | null;
  company: { id: string; name: string } | null;
  deal: { id: string; title: string } | null;
  items: { description: string; quantity: string; unitPrice: string; discountPercent: string }[];
};

/** Initial values for a new quote, optionally pre-filled from a deal. */
export async function quoteDefaults(ctx: ServiceCtx, opts: { dealId?: string | null; contactId?: string | null } = {}): Promise<QuoteDefaults> {
  assertCan(ctx, "documents.create");
  return ctx.run(async (tx) => {
    const [tenant] = await tx.select().from(schema.tenants).where(eq(schema.tenants.id, ctx.tenantId));
    const template = await defaultTemplate(tx, ctx.tenantId);
    const today = todayIn(tenant.timezone);
    const out: QuoteDefaults = {
      language: tenant.locale === "en" ? "en" : "he",
      currency: tenant.currency,
      taxRateBp: taxRateFromSettings(tenant.settings),
      issueDate: today,
      validUntil: addDays(today, 30),
      terms: template?.terms ?? null,
      templateId: template?.id ?? null,
      title: "",
      contact: null,
      company: null,
      deal: null,
      items: [{ description: "", quantity: "1", unitPrice: "", discountPercent: "0" }],
    };
    const contactId = opts.contactId ?? null;
    if (opts.dealId) {
      const [d] = await tx
        .select()
        .from(schema.deals)
        .where(and(eq(schema.deals.id, opts.dealId), eq(schema.deals.tenantId, ctx.tenantId), isNull(schema.deals.deletedAt)));
      if (d) {
        out.deal = { id: d.id, title: d.title };
        out.title = d.title;
        out.currency = d.currency;
        if (d.valueCents > 0) out.items = [{ description: d.title, quantity: "1", unitPrice: (d.valueCents / 100).toFixed(2), discountPercent: "0" }];
        if (d.companyId) {
          const [co] = await tx.select({ id: schema.companies.id, name: schema.companies.name }).from(schema.companies).where(eq(schema.companies.id, d.companyId));
          out.company = co ?? null;
        }
        if (d.contactId) {
          const [c] = await tx.select().from(schema.contacts).where(eq(schema.contacts.id, d.contactId));
          if (c) out.contact = { id: c.id, name: contactDisplayName(c) };
        }
      }
    }
    if (!out.contact && contactId) {
      const [c] = await tx
        .select()
        .from(schema.contacts)
        .where(and(eq(schema.contacts.id, contactId), eq(schema.contacts.tenantId, ctx.tenantId), isNull(schema.contacts.deletedAt)));
      if (c) out.contact = { id: c.id, name: contactDisplayName(c) };
    }
    return out;
  });
}

/* ----------------------------------------------------------------- writes */

export async function createQuote(ctx: ServiceCtx, input: QuoteInput): Promise<QuoteRow> {
  assertCanWrite(ctx, "documents.create");
  const totals = totalsFor(input);
  return ctx.run(async (tx) => {
    assertFeature(await getEntitlements(tx, ctx.tenantId), "documents");
    await assertLinks(tx, ctx.tenantId, input);
    // Gapless per-tenant numbering inside this transaction (see migration 20261020000400).
    const [{ n }] = await tx.execute<{ n: string }>(sql`select app.next_tenant_counter(${ctx.tenantId}, 'quote')::text as n`);
    const [quote] = await tx
      .insert(schema.quotes)
      .values({
        tenantId: ctx.tenantId,
        number: Number(n),
        title: input.title,
        language: input.language,
        contactId: input.contactId,
        companyId: input.companyId,
        dealId: input.dealId,
        templateId: input.templateId,
        issueDate: input.issueDate,
        validUntil: input.validUntil,
        currency: input.currency,
        discountBp: input.discountPercent,
        taxRateBp: input.taxRatePercent,
        subtotalCents: totals.subtotalCents,
        discountCents: totals.discountCents,
        taxCents: totals.taxCents,
        totalCents: totals.totalCents,
        notes: input.notes,
        terms: input.terms,
        createdBy: ctx.userId,
      })
      .returning();
    await writeItems(tx, ctx.tenantId, quote.id, input, totals);
    await activity(tx, ctx, quote, "quote_created", { totalCents: quote.totalCents });
    await audit(tx, ctx, { action: "quote.created", entityType: "quote", entityId: quote.id, metadata: { number: quote.number, totalCents: quote.totalCents } });
    return quote;
  });
}

export async function updateQuote(ctx: ServiceCtx, id: string, input: QuoteInput): Promise<QuoteRow> {
  assertCanWrite(ctx, "documents.update");
  const totals = totalsFor(input);
  return ctx.run(async (tx) => {
    const current = await loadQuote(tx, ctx.tenantId, id, { forUpdate: true });
    if (!isEditable(current.status as QuoteStatus)) throw new AppError("CONFLICT", "quotes.notEditable");
    await assertLinks(tx, ctx.tenantId, input);
    const [quote] = await tx
      .update(schema.quotes)
      .set({
        title: input.title,
        language: input.language,
        contactId: input.contactId,
        companyId: input.companyId,
        dealId: input.dealId,
        templateId: input.templateId,
        issueDate: input.issueDate,
        validUntil: input.validUntil,
        currency: input.currency,
        discountBp: input.discountPercent,
        taxRateBp: input.taxRatePercent,
        subtotalCents: totals.subtotalCents,
        discountCents: totals.discountCents,
        taxCents: totals.taxCents,
        totalCents: totals.totalCents,
        notes: input.notes,
        terms: input.terms,
      })
      .where(eq(schema.quotes.id, id))
      .returning();
    await writeItems(tx, ctx.tenantId, id, input, totals);
    await audit(tx, ctx, { action: "quote.updated", entityType: "quote", entityId: id, metadata: { totalCents: quote.totalCents } });
    return quote;
  });
}

export async function deleteQuote(ctx: ServiceCtx, id: string) {
  assertCanWrite(ctx, "documents.delete");
  await ctx.run(async (tx) => {
    const q = await loadQuote(tx, ctx.tenantId, id, { forUpdate: true });
    if (q.status !== "draft") throw new AppError("CONFLICT", "quotes.onlyDraftsDeletable");
    await tx.delete(schema.quotes).where(eq(schema.quotes.id, id));
    await audit(tx, ctx, { action: "quote.deleted", entityType: "quote", entityId: id, metadata: { number: q.number } });
  });
}

export async function duplicateQuote(ctx: ServiceCtx, id: string): Promise<QuoteRow> {
  assertCanWrite(ctx, "documents.create");
  const source = await getQuote(ctx, id);
  const tenantTz = await ctx.run(async (tx) => (await tx.select({ tz: schema.tenants.timezone }).from(schema.tenants).where(eq(schema.tenants.id, ctx.tenantId)))[0]?.tz ?? "Asia/Jerusalem");
  const today = todayIn(tenantTz);
  const q = source.quote;
  return createQuote(ctx, {
    title: q.title,
    language: q.language as "he" | "en",
    contactId: q.contactId,
    companyId: q.companyId,
    dealId: q.dealId,
    templateId: q.templateId,
    issueDate: today,
    validUntil: q.validUntil ? addDays(today, Math.max(0, daysBetween(q.issueDate, q.validUntil))) : null,
    currency: q.currency as QuoteInput["currency"],
    taxRatePercent: q.taxRateBp,
    discountPercent: q.discountBp,
    notes: q.notes,
    terms: q.terms,
    items: source.items.map((i) => ({ description: i.description, quantity: i.quantityMilli, unitPrice: i.unitPriceCents, discountPercent: i.discountBp })),
  });
}

/** Staff-side transitions (cancel, or record a decision the customer gave offline). */
export async function setQuoteStatus(ctx: ServiceCtx, id: string, to: "canceled" | "accepted" | "rejected", note?: string | null) {
  assertCanWrite(ctx, "documents.update");
  return ctx.run(async (tx) => {
    const q = await loadQuote(tx, ctx.tenantId, id, { forUpdate: true });
    if (!canTransition(q.status as QuoteStatus, to)) throw new AppError("CONFLICT", "quotes.invalidTransition");
    const now = new Date();
    const [updated] = await tx
      .update(schema.quotes)
      .set({
        status: to,
        ...(to === "accepted" ? { acceptedAt: now } : {}),
        ...(to === "rejected" ? { rejectedAt: now } : {}),
        ...(note ? { decisionNote: note } : {}),
      })
      .where(eq(schema.quotes.id, id))
      .returning();
    await activity(tx, ctx, updated, "quote_status", { from: q.status, to });
    await audit(tx, ctx, { action: `quote.${to}`, entityType: "quote", entityId: id, metadata: { from: q.status, via: "staff" } });
    if (to === "accepted" || to === "rejected") {
      await emitEvent(tx, ctx, { type: to === "accepted" ? "quote.accepted" : "quote.rejected", entityType: "quote", entityId: id, data: eventData(updated) });
    }
    return updated;
  });
}

function eventData(q: QuoteRow) {
  return { number: q.number, status: q.status, totalCents: q.totalCents, currency: q.currency, contactId: q.contactId, companyId: q.companyId, dealId: q.dealId };
}

/* -------------------------------------------------------------------- PDF */

type PdfPrep = { data: Omit<QuotePdfData, "logo">; logoPath: string | null };

async function buildPdfInput(tx: Executor, tenantId: string, quote: QuoteRow): Promise<PdfPrep> {
  const [tenant] = await tx.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId));
  const template = quote.templateId
    ? ((await tx.select().from(schema.documentTemplates).where(and(eq(schema.documentTemplates.id, quote.templateId), eq(schema.documentTemplates.tenantId, tenantId))))[0] ??
      (await defaultTemplate(tx, tenantId)))
    : await defaultTemplate(tx, tenantId);
  const [contact] = quote.contactId ? await tx.select().from(schema.contacts).where(eq(schema.contacts.id, quote.contactId)) : [];
  const [company] = quote.companyId ? await tx.select().from(schema.companies).where(eq(schema.companies.id, quote.companyId)) : [];
  const items = await loadItems(tx, quote.id);
  return {
    logoPath: template?.showLogo !== false ? tenant.logoPath : null,
    data: {
      language: quote.language === "en" ? "en" : "he",
      number: quote.number,
      title: quote.title,
      issueDate: quote.issueDate,
      validUntil: quote.validUntil,
      currency: quote.currency,
      org: { name: tenant.name, email: tenant.email, phone: tenant.phone, address: tenant.address, website: tenant.website, taxId: tenant.taxId },
      accentColor: template?.accentColor ?? tenant.brandColor ?? "#4f46e5",
      headerText: template?.headerText ?? null,
      footerText: template?.footerText ?? null,
      customer: {
        name: contact ? contactDisplayName(contact) : null,
        company: company?.name ?? null,
        email: contact?.email ?? company?.email ?? null,
        phone: contact?.phone ?? company?.phone ?? null,
      },
      items: items.map((i) => ({
        description: i.description,
        quantityMilli: decimalStringToMilli(i.quantity),
        unitPriceCents: i.unitPriceCents,
        discountBp: i.discountBp,
        totalCents: i.lineTotalCents,
      })),
      totals: {
        subtotalCents: quote.subtotalCents,
        discountCents: quote.discountCents,
        discountBp: quote.discountBp,
        taxableCents: quote.subtotalCents - quote.discountCents,
        taxRateBp: quote.taxRateBp,
        taxCents: quote.taxCents,
        totalCents: quote.totalCents,
      },
      notes: quote.notes,
      terms: quote.terms,
    },
  };
}

async function loadLogo(path: string | null): Promise<QuotePdfData["logo"]> {
  if (!path) return null;
  const lower = path.toLowerCase();
  const type = lower.endsWith(".png") ? "png" : lower.endsWith(".jpg") || lower.endsWith(".jpeg") ? "jpg" : null;
  if (!type) return null;
  try {
    return { bytes: new Uint8Array(await storage().get(path)), type };
  } catch {
    return null;
  }
}

async function render(prep: PdfPrep): Promise<Uint8Array> {
  return renderQuotePdf({ ...prep.data, logo: await loadLogo(prep.logoPath) });
}

export function pdfFileName(q: Pick<QuoteRow, "number" | "language">) {
  return q.language === "en" ? `quote-${q.number}.pdf` : `הצעת-מחיר-${q.number}.pdf`;
}

/** Drafts render live; sent quotes return the stored snapshot the customer received. */
export async function quotePdf(ctx: ServiceCtx, id: string): Promise<{ bytes: Uint8Array; fileName: string }> {
  assertCan(ctx, "documents.view");
  const { quote, prep } = await ctx.run(async (tx) => {
    const quote = await loadQuote(tx, ctx.tenantId, id);
    return { quote, prep: quote.pdfStorageKey && quote.status !== "draft" ? null : await buildPdfInput(tx, ctx.tenantId, quote) };
  });
  if (!prep && quote.pdfStorageKey) {
    try {
      return { bytes: new Uint8Array(await storage().get(quote.pdfStorageKey)), fileName: pdfFileName(quote) };
    } catch {
      // snapshot missing (e.g. storage reset) — fall back to a fresh render
    }
  }
  const fresh = prep ?? (await ctx.run((tx) => buildPdfInput(tx, ctx.tenantId, quote)));
  return { bytes: await render(fresh), fileName: pdfFileName(quote) };
}

/* ------------------------------------------------------------------- send */

export async function sendQuote(ctx: ServiceCtx, id: string, opts: { emailTo?: string | null } = {}): Promise<{ publicUrl: string; emailed: boolean }> {
  assertCanWrite(ctx, "documents.update");
  const prepared = await ctx.run(async (tx) => {
    const q = await loadQuote(tx, ctx.tenantId, id);
    if (!canTransition(q.status as QuoteStatus, "sent")) throw new AppError("CONFLICT", "quotes.invalidTransition");
    const items = await loadItems(tx, id);
    if (!items.length) throw new AppError("VALIDATION", "quotes.noItems");
    return { quote: q, prep: await buildPdfInput(tx, ctx.tenantId, q) };
  });
  const pdf = await render(prepared.prep);
  const key = storageKey(ctx.tenantId, "quotes", pdfFileName(prepared.quote).replace(/[^\w.-]+/g, "_"));
  await storage().put(key, Buffer.from(pdf), "application/pdf");
  const token = randomToken(32);
  let sent: QuoteRow;
  try {
    sent = await ctx.run(async (tx) => {
      const q = await loadQuote(tx, ctx.tenantId, id, { forUpdate: true });
      if (q.status !== "draft" || q.updatedAt.getTime() !== prepared.quote.updatedAt.getTime()) throw new AppError("CONFLICT", "errors.conflict");
      const [row] = await tx
        .update(schema.quotes)
        .set({ status: "sent", sentAt: new Date(), publicTokenHash: sha256Hex(token), pdfStorageKey: key })
        .where(eq(schema.quotes.id, id))
        .returning();
      await activity(tx, ctx, row, "quote_sent", { emailed: Boolean(opts.emailTo) });
      await audit(tx, ctx, { action: "quote.sent", entityType: "quote", entityId: id, metadata: { number: row.number, emailed: Boolean(opts.emailTo) } });
      await emitEvent(tx, ctx, { type: "quote.sent", entityType: "quote", entityId: id, data: eventData(row) });
      return row;
    });
  } catch (e) {
    await storage().delete(key).catch(() => undefined);
    throw e;
  }
  const publicUrl = publicQuoteUrl(token);
  if (opts.emailTo) {
    await sendEmail({
      to: opts.emailTo,
      template: "quote_sent",
      locale: sent.language === "en" ? "en" : "he",
      tenantId: ctx.tenantId,
      data: {
        orgName: prepared.prep.data.org.name,
        contactName: prepared.prep.data.customer.name ?? "",
        quoteNumber: sent.number,
        title: sent.title,
        total: formatPdfMoney(sent.totalCents, sent.currency, sent.language === "en" ? "en" : "he"),
        validUntil: sent.validUntil,
        url: publicUrl,
      },
    });
  }
  return { publicUrl, emailed: Boolean(opts.emailTo) };
}

/** Issues a fresh customer link (the old one stops working). */
export async function regenerateQuoteLink(ctx: ServiceCtx, id: string): Promise<{ publicUrl: string }> {
  assertCanWrite(ctx, "documents.update");
  const token = randomToken(32);
  await ctx.run(async (tx) => {
    const q = await loadQuote(tx, ctx.tenantId, id, { forUpdate: true });
    if (!isAwaitingDecision(q.status as QuoteStatus)) throw new AppError("CONFLICT", "quotes.invalidTransition");
    await tx.update(schema.quotes).set({ publicTokenHash: sha256Hex(token) }).where(eq(schema.quotes.id, id));
    await audit(tx, ctx, { action: "quote.link_regenerated", entityType: "quote", entityId: id });
  });
  return { publicUrl: publicQuoteUrl(token) };
}

/* ---------------------------------------------------------- public access */

export type PublicQuote = {
  quote: QuoteRow;
  items: (QuoteItemRow & { quantityMilli: number })[];
  org: { name: string; brandColor: string | null; email: string | null; phone: string | null; website: string | null };
  accentColor: string;
  headerText: string | null;
  footerText: string | null;
  customerName: string | null;
  companyName: string | null;
  expired: boolean;
};

async function findByToken(tx: Tx, token: string, opts: { forUpdate?: boolean } = {}): Promise<QuoteRow | null> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const q = tx.select().from(schema.quotes).where(eq(schema.quotes.publicTokenHash, sha256Hex(token)));
  const [row] = opts.forUpdate ? await q.for("update") : await q;
  return row ?? null;
}

async function isPastValidity(tx: Tx, q: QuoteRow): Promise<boolean> {
  if (!q.validUntil) return false;
  const [t] = await tx.select({ tz: schema.tenants.timezone }).from(schema.tenants).where(eq(schema.tenants.id, q.tenantId));
  return q.validUntil < todayIn(t?.tz ?? "Asia/Jerusalem");
}

/** Customer-facing read. The unguessable token is the credential (system context). */
export async function getPublicQuote(token: string): Promise<PublicQuote | null> {
  return withSystemTx(async (tx) => {
    const quote = await findByToken(tx, token);
    if (!quote) return null;
    const [tenant] = await tx.select().from(schema.tenants).where(and(eq(schema.tenants.id, quote.tenantId), isNull(schema.tenants.deletedAt)));
    if (!tenant) return null;
    const template = quote.templateId
      ? (await tx.select().from(schema.documentTemplates).where(eq(schema.documentTemplates.id, quote.templateId)))[0]
      : await defaultTemplate(tx, quote.tenantId);
    const items = (await loadItems(tx, quote.id)).map((i) => ({ ...i, quantityMilli: decimalStringToMilli(i.quantity) }));
    const [contact] = quote.contactId ? await tx.select().from(schema.contacts).where(eq(schema.contacts.id, quote.contactId)) : [];
    const [company] = quote.companyId ? await tx.select({ name: schema.companies.name }).from(schema.companies).where(eq(schema.companies.id, quote.companyId)) : [];
    return {
      quote,
      items,
      org: { name: tenant.name, brandColor: tenant.brandColor, email: tenant.email, phone: tenant.phone, website: tenant.website },
      accentColor: template?.accentColor ?? tenant.brandColor ?? "#4f46e5",
      headerText: template?.headerText ?? null,
      footerText: template?.footerText ?? null,
      customerName: contact ? contactDisplayName(contact) : null,
      companyName: company?.name ?? null,
      expired: isAwaitingDecision(quote.status as QuoteStatus) && (await isPastValidity(tx, quote)),
    };
  });
}

export async function publicQuotePdf(token: string): Promise<{ bytes: Uint8Array; fileName: string } | null> {
  const found = await withSystemTx(async (tx) => {
    const quote = await findByToken(tx, token);
    if (!quote || quote.status === "draft") return null;
    return { quote, prep: quote.pdfStorageKey ? null : await buildPdfInput(tx, quote.tenantId, quote) };
  });
  if (!found) return null;
  if (found.quote.pdfStorageKey) {
    try {
      return { bytes: new Uint8Array(await storage().get(found.quote.pdfStorageKey)), fileName: pdfFileName(found.quote) };
    } catch {
      // fall through to re-render
    }
  }
  const prep = found.prep ?? (await withSystemTx((tx) => buildPdfInput(tx, found.quote.tenantId, found.quote)));
  return { bytes: await render(prep), fileName: pdfFileName(found.quote) };
}

const QUOTE_NOTIFICATION: NotificationType = "quote_decision";

/** Records a customer view (first view moves sent → viewed and notifies the owner). */
export async function recordPublicView(token: string, meta: RequestMeta = {}): Promise<void> {
  const limit = await hitRateLimit(`quote-view:${sha256Hex(token).slice(0, 32)}`, 60, 3600);
  if (!limit.allowed) return;
  await withSystemTx(async (tx) => {
    const q = await findByToken(tx, token, { forUpdate: true });
    if (!q) return;
    const firstView = q.status === "sent";
    const [row] = await tx
      .update(schema.quotes)
      .set({
        viewCount: q.viewCount + 1,
        lastViewedAt: new Date(),
        ...(firstView ? { status: "viewed", viewedAt: new Date() } : {}),
      })
      .where(eq(schema.quotes.id, q.id))
      .returning();
    if (!firstView) return;
    const ctx = systemCtx(q.tenantId, { meta });
    await activity(tx, ctx, row, "quote_status", { from: "sent", to: "viewed", via: "public_link" });
    await audit(tx, ctx, { action: "quote.viewed", entityType: "quote", entityId: q.id, metadata: { via: "public_link" } });
    if (q.createdBy) {
      await notify(tx, {
        tenantId: q.tenantId,
        userId: q.createdBy,
        type: QUOTE_NOTIFICATION,
        title: { he: `הלקוח צפה בהצעת מחיר #${q.number}`, en: `Customer viewed quote #${q.number}` },
        link: `/quotes/${q.id}`,
      });
    }
  });
}

/** Customer accepts or rejects through the public link. */
export async function respondToQuote(
  token: string,
  input: { decision: "accepted" | "rejected"; name: string; note: string | null },
  meta: RequestMeta = {},
): Promise<{ status: QuoteStatus }> {
  const byToken = await hitRateLimit(`quote-decide:${sha256Hex(token).slice(0, 32)}`, 10, 3600);
  const byIp = await hitRateLimit(`quote-decide-ip:${meta.ip ?? "unknown"}`, 30, 3600);
  if (!byToken.allowed || !byIp.allowed) throw new AppError("RATE_LIMITED", "errors.rateLimited");
  return withSystemTx(async (tx) => {
    const q = await findByToken(tx, token, { forUpdate: true });
    if (!q) throw new AppError("NOT_FOUND", "errors.notFound");
    if (!isAwaitingDecision(q.status as QuoteStatus)) throw new AppError("CONFLICT", "quotes.alreadyDecided");
    const ctx = systemCtx(q.tenantId, { meta });
    if (await isPastValidity(tx, q)) {
      const [expired] = await tx.update(schema.quotes).set({ status: "expired" }).where(eq(schema.quotes.id, q.id)).returning();
      await activity(tx, ctx, expired, "quote_status", { from: q.status, to: "expired" });
      await audit(tx, ctx, { action: "quote.expired", entityType: "quote", entityId: q.id });
      throw new AppError("CONFLICT", "quotes.expired");
    }
    const now = new Date();
    const [row] = await tx
      .update(schema.quotes)
      .set({
        status: input.decision,
        decidedByName: input.name,
        decisionNote: input.note,
        ...(q.viewedAt ? {} : { viewedAt: now }),
        ...(input.decision === "accepted" ? { acceptedAt: now } : { rejectedAt: now }),
      })
      .where(eq(schema.quotes.id, q.id))
      .returning();
    await activity(tx, ctx, row, "quote_status", { from: q.status, to: input.decision, signer: input.name, via: "public_link" });
    await audit(tx, ctx, {
      action: `quote.${input.decision}`,
      entityType: "quote",
      entityId: q.id,
      metadata: { via: "public_link", signer: input.name },
    });
    await emitEvent(tx, ctx, { type: input.decision === "accepted" ? "quote.accepted" : "quote.rejected", entityType: "quote", entityId: q.id, data: eventData(row) });
    if (q.createdBy) {
      const accepted = input.decision === "accepted";
      await notify(tx, {
        tenantId: q.tenantId,
        userId: q.createdBy,
        type: QUOTE_NOTIFICATION,
        title: accepted
          ? { he: `הצעת מחיר #${q.number} אושרה על ידי ${input.name}`, en: `Quote #${q.number} accepted by ${input.name}` }
          : { he: `הצעת מחיר #${q.number} נדחתה על ידי ${input.name}`, en: `Quote #${q.number} rejected by ${input.name}` },
        body: input.note ?? undefined,
        link: `/quotes/${q.id}`,
      });
    }
    return { status: row.status as QuoteStatus };
  });
}

/* ------------------------------------------------------------------ jobs */

/** Moves sent/viewed quotes past their validity date (tenant-local) to expired. */
export async function expireDueQuotes(): Promise<number> {
  return withSystemTx(async (tx) => {
    const rows = await tx.execute<{ id: string }>(sql`
      update public.quotes q set status = 'expired'
      from public.tenants t
      join pg_timezone_names z on z.name = t.timezone -- an invalid zone must not break the job for everyone
      where t.id = q.tenant_id and q.status in ('sent', 'viewed') and q.valid_until is not null
        and q.valid_until < (now() at time zone t.timezone)::date
      returning q.id`);
    for (const { id } of rows) {
      const [q] = await tx.select().from(schema.quotes).where(eq(schema.quotes.id, id));
      const ctx = systemCtx(q.tenantId);
      await activity(tx, ctx, q, "quote_status", { to: "expired" });
      await audit(tx, ctx, { action: "quote.expired", entityType: "quote", entityId: id });
    }
    return rows.length;
  });
}

/* -------------------------------------------------------------- invoicing */

export async function createInvoiceForQuote(ctx: ServiceCtx, id: string): Promise<{ externalId: string }> {
  assertCanWrite(ctx, "documents.update");
  const prepared = await ctx.run(async (tx) => {
    const q = await loadQuote(tx, ctx.tenantId, id);
    if (q.status !== "accepted") throw new AppError("CONFLICT", "quotes.invoiceNeedsAccepted");
    if (q.externalInvoiceId) throw new AppError("CONFLICT", "quotes.alreadyInvoiced");
    const provider = await resolveInvoicingProvider(tx, ctx.tenantId);
    if (!provider) throw new AppError("PRECONDITION", "documents.noAccountingIntegration");
    const prep = await buildPdfInput(tx, ctx.tenantId, q);
    return { q, provider, prep };
  });
  const { q, provider, prep } = prepared;
  const result = await provider.createInvoiceFromQuote({
    quoteId: q.id,
    quoteNumber: q.number,
    language: prep.data.language,
    currency: q.currency,
    customer: { name: prep.data.customer.company ?? prep.data.customer.name ?? "—", email: prep.data.customer.email, phone: prep.data.customer.phone, taxId: null },
    items: prep.data.items.map((i) => ({ description: i.description, quantity: i.quantityMilli / 1000, unitPrice: i.unitPriceCents / 100 })),
    discountPercent: q.discountBp / 100,
    vatPercent: q.taxRateBp / 100,
    totalCents: q.totalCents,
  });
  await ctx.run(async (tx) => {
    const current = await loadQuote(tx, ctx.tenantId, id, { forUpdate: true });
    if (current.externalInvoiceId) throw new AppError("CONFLICT", "quotes.alreadyInvoiced");
    const [row] = await tx
      .update(schema.quotes)
      .set({ externalInvoiceProvider: provider.id, externalInvoiceId: result.externalId })
      .where(eq(schema.quotes.id, id))
      .returning();
    await activity(tx, ctx, row, "quote_status", { invoice: result.externalId, provider: provider.id });
    await audit(tx, ctx, { action: "quote.invoiced", entityType: "quote", entityId: id, metadata: { provider: provider.id, externalId: result.externalId, live: provider.live } });
  });
  return { externalId: result.externalId };
}

/** Development only: connects the mock accounting provider so the flow can be exercised. */
export async function setMockAccountingConnection(ctx: ServiceCtx, connected: boolean) {
  assertCanWrite(ctx, "integrations.manage");
  if (env().APP_ENV === "production") throw new AppError("FORBIDDEN", "documents.mockNotInProduction");
  await ctx.run(async (tx) => {
    if (connected) {
      await tx
        .insert(schema.integrationConnections)
        .values({ tenantId: ctx.tenantId, provider: "greeninvoice", status: "connected", config: { mock: true }, connectedBy: ctx.userId })
        .onConflictDoUpdate({
          target: [schema.integrationConnections.tenantId, schema.integrationConnections.provider],
          set: { status: "connected", config: { mock: true }, connectedBy: ctx.userId },
        });
    } else {
      await tx
        .delete(schema.integrationConnections)
        .where(and(eq(schema.integrationConnections.tenantId, ctx.tenantId), eq(schema.integrationConnections.provider, "greeninvoice")));
    }
    await audit(tx, ctx, { action: connected ? "integration.mock_accounting_connected" : "integration.mock_accounting_disconnected", entityType: "integration" });
  });
}

export async function accountingStatus(ctx: ServiceCtx): Promise<{ connected: boolean; mock: boolean; label: string | null }> {
  return ctx.run(async (tx) => {
    const p = await resolveInvoicingProvider(tx, ctx.tenantId);
    return { connected: Boolean(p), mock: p?.id === "mock", label: p?.label ?? null };
  });
}

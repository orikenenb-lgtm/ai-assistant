/**
 * Accounting / tax-invoice integration ARCHITECTURE.
 *
 * SMART CRM AI never issues tax invoices itself. Once a quote is accepted, a
 * connected accounting system (Morning/Green Invoice, iCount, …) can be asked to
 * create the legally compliant invoice. Only the mock provider is active:
 * the real adapters below map our data to each vendor's API but REQUIRE
 * CREDENTIALS AND EXPLICIT APPROVAL before any live call is enabled.
 */
import { and, eq, inArray } from "drizzle-orm";
import { schema, type Executor } from "@/server/db";
import { env } from "@/server/env";
import { AppError } from "@/server/errors";

export type InvoiceDraft = {
  quoteId: string;
  quoteNumber: number;
  language: "he" | "en";
  currency: string;
  customer: { name: string; email: string | null; phone: string | null; taxId: string | null };
  items: { description: string; quantity: number; unitPrice: number }[];
  discountPercent: number;
  vatPercent: number;
  totalCents: number;
};

export type InvoiceResult = { externalId: string; url: string | null };

export interface InvoicingProvider {
  readonly id: "mock" | "greeninvoice" | "icount";
  /** Human label shown in the UI. */
  readonly label: string;
  readonly live: boolean;
  createInvoiceFromQuote(draft: InvoiceDraft): Promise<InvoiceResult>;
}

/** Development/demo provider: returns a fake reference, contacts nobody. */
export class MockInvoicingProvider implements InvoicingProvider {
  readonly id = "mock" as const;
  readonly live = false;
  constructor(readonly label = "Mock accounting (demo)") {}
  async createInvoiceFromQuote(draft: InvoiceDraft): Promise<InvoiceResult> {
    return { externalId: `MOCK-INV-${draft.quoteNumber}-${Date.now().toString(36).toUpperCase()}`, url: null };
  }
}

/**
 * Morning (Green Invoice) adapter — maps to POST /api/v1/documents (type 305
 * = tax invoice). Not activated: requires API key/secret and approval.
 */
export class GreenInvoiceProvider implements InvoicingProvider {
  readonly id = "greeninvoice" as const;
  readonly label = "Morning (Green Invoice)";
  readonly live = false;
  static buildDocument(d: InvoiceDraft) {
    return {
      type: 305,
      lang: d.language,
      currency: d.currency,
      vatType: 0,
      remarks: `Quote #${d.quoteNumber}`,
      client: { name: d.customer.name, emails: d.customer.email ? [d.customer.email] : [], phone: d.customer.phone ?? undefined, taxId: d.customer.taxId ?? undefined },
      income: d.items.map((i) => ({ description: i.description, quantity: i.quantity, price: i.unitPrice, currency: d.currency, vatType: 0 })),
      discount: d.discountPercent ? { amount: d.discountPercent, type: "percentage" } : undefined,
    };
  }
  async createInvoiceFromQuote(): Promise<InvoiceResult> {
    throw new AppError("PROVIDER_ERROR", "documents.invoicingNotActivated");
  }
}

/** iCount adapter — maps to POST /api/v3.php/doc/create (doctype "invrec"). Not activated. */
export class ICountProvider implements InvoicingProvider {
  readonly id = "icount" as const;
  readonly label = "iCount";
  readonly live = false;
  static buildDocument(d: InvoiceDraft) {
    return {
      doctype: "invoice",
      client_name: d.customer.name,
      email: d.customer.email ?? undefined,
      currency_code: d.currency,
      lang: d.language,
      items: d.items.map((i) => ({ description: i.description, quantity: i.quantity, unitprice: i.unitPrice })),
      discount_percent: d.discountPercent || undefined,
      vat_percent: d.vatPercent,
    };
  }
  async createInvoiceFromQuote(): Promise<InvoiceResult> {
    throw new AppError("PROVIDER_ERROR", "documents.invoicingNotActivated");
  }
}

export const ACCOUNTING_PROVIDERS = ["greeninvoice", "icount"] as const;

/**
 * The tenant's connected accounting integration, or null. A connection marked
 * `config.mock = true` (only creatable outside production) uses the mock.
 */
export async function resolveInvoicingProvider(tx: Executor, tenantId: string): Promise<InvoicingProvider | null> {
  const [conn] = await tx
    .select()
    .from(schema.integrationConnections)
    .where(
      and(
        eq(schema.integrationConnections.tenantId, tenantId),
        inArray(schema.integrationConnections.provider, [...ACCOUNTING_PROVIDERS]),
        eq(schema.integrationConnections.status, "connected"),
      ),
    )
    .limit(1);
  if (!conn) return null;
  const config = (conn.config ?? {}) as { mock?: boolean };
  if (config.mock) {
    if (env().APP_ENV === "production") return null;
    return new MockInvoicingProvider();
  }
  return conn.provider === "icount" ? new ICountProvider() : new GreenInvoiceProvider();
}

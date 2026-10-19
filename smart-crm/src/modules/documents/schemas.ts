import { z } from "zod";
import { optionalUuid } from "@/modules/crm/schemas";
import { QUOTE_STATUSES } from "./status";
import { MAX_LINES, parseMoney, parsePercent, parseQuantity } from "./totals";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

const numeric = z.union([z.string(), z.number()]).transform((v) => String(v).trim());

const quantity = numeric.transform((v, ctx) => {
  const milli = parseQuantity(v);
  if (milli === null) {
    ctx.addIssue({ code: "custom", message: "quotes.invalidQuantity" });
    return z.NEVER;
  }
  return milli;
});

const money = numeric.transform((v, ctx) => {
  const cents = parseMoney(v);
  if (cents === null) {
    ctx.addIssue({ code: "custom", message: "quotes.invalidPrice" });
    return z.NEVER;
  }
  return cents;
});

const percent = numeric.transform((v, ctx) => {
  if (v === "") return 0;
  const bp = parsePercent(v);
  if (bp === null) {
    ctx.addIssue({ code: "custom", message: "quotes.invalidPercent" });
    return z.NEVER;
  }
  return bp;
});

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), { message: "validation.invalid" });

export const quoteItemInputSchema = z.object({
  description: z.string().trim().min(1).max(500),
  quantity,
  unitPrice: money,
  discountPercent: percent.default(0),
});

export const CURRENCIES = ["ILS", "USD", "EUR", "GBP"] as const;

export const quoteInputSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    language: z.enum(["he", "en"]).default("he"),
    contactId: optionalUuid,
    companyId: optionalUuid,
    dealId: optionalUuid,
    templateId: optionalUuid,
    issueDate: isoDate,
    validUntil: z
      .union([isoDate, z.literal(""), z.null()])
      .optional()
      .transform((v) => (v ? v : null)),
    currency: z.enum(CURRENCIES).default("ILS"),
    taxRatePercent: percent,
    discountPercent: percent.default(0),
    notes: optionalText(5000),
    terms: optionalText(5000),
    items: z.array(quoteItemInputSchema).min(1).max(MAX_LINES),
  })
  .refine((v) => !v.validUntil || v.validUntil >= v.issueDate, { path: ["validUntil"], message: "quotes.validUntilBeforeIssue" });

export type QuoteInput = z.infer<typeof quoteInputSchema>;

export const quoteListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(QUOTE_STATUSES).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(25),
});
export type QuoteListQuery = z.infer<typeof quoteListQuerySchema>;

export function parseQuoteListQuery(params: Record<string, string | string[] | undefined>): QuoteListQuery {
  const flat = Object.fromEntries(
    Object.entries(params)
      .map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])
      .filter(([, v]) => v !== "" && v !== undefined),
  );
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(flat)) {
    const field = quoteListQuerySchema.shape[k as keyof typeof quoteListQuerySchema.shape];
    if (field && field.safeParse(v).success) cleaned[k] = v;
  }
  return quoteListQuerySchema.parse(cleaned);
}

export const templateInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  headerText: optionalText(1000),
  footerText: optionalText(1000),
  terms: optionalText(5000),
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, { message: "validation.color" })
    .default("#4f46e5"),
  showLogo: z.boolean().default(true),
  isDefault: z.boolean().default(false),
});
export type TemplateInput = z.infer<typeof templateInputSchema>;

export const decisionSchema = z.object({
  decision: z.enum(["accepted", "rejected"]),
  name: z.string().trim().min(2).max(120),
  note: optionalText(1000),
});

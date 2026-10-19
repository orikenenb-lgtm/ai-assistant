import { z } from "zod";
import { optionalEmail, optionalPhone, optionalUuid } from "@/modules/crm/schemas";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

/** Accepts "1,234.50" / 1234.5 (major units) and returns integer cents. */
export const moneyToCents = z
  .union([z.number(), z.string()])
  .optional()
  .nullable()
  .transform((v, ctx) => {
    if (v === undefined || v === null || v === "") return null;
    const n = typeof v === "number" ? v : Number(String(v).replace(/[,\s₪$€£]/g, ""));
    if (!Number.isFinite(n) || n < 0 || n >= 1e12) {
      ctx.addIssue({ code: "custom", message: "validation.invalid" });
      return z.NEVER;
    }
    return Math.round(n * 100);
  });

const optionalDate = z
  .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal(""), z.null()])
  .optional()
  .transform((v) => (v ? v : null));

const optionalPercent = z
  .union([z.coerce.number().int().min(0).max(100), z.literal(""), z.null()])
  .optional()
  .transform((v) => (v === "" || v === undefined ? null : v));

/* ------------------------------------------------------------------ Leads */

export const LEAD_STATUSES = ["new", "contacted", "qualified", "unqualified", "converted"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export const LEAD_SOURCES = ["manual", "website", "whatsapp", "referral", "import", "api", "campaign", "event", "other"] as const;
export const AI_CLASSIFICATIONS = ["hot", "warm", "cold", "spam"] as const;

export const leadInputSchema = z
  .object({
    fullName: z.string().trim().max(200).default(""),
    email: optionalEmail,
    phone: optionalPhone,
    companyName: optionalText(200),
    source: z.enum(LEAD_SOURCES).default("manual"),
    score: optionalPercent,
    estimatedValue: moneyToCents,
    message: optionalText(5000),
    ownerId: optionalUuid,
    customFields: z.record(z.string(), z.unknown()).default({}),
    tagIds: z.array(z.uuid()).max(50).optional(),
  })
  .refine((v) => v.fullName || v.email || v.phone, { path: ["fullName"], message: "leads.nameOrContactRequired" });
export type LeadInput = z.infer<typeof leadInputSchema>;

/** Manual status transitions (conversion has its own flow). */
export const LEAD_TRANSITIONS: Record<LeadStatus, LeadStatus[]> = {
  new: ["contacted", "qualified", "unqualified"],
  contacted: ["new", "qualified", "unqualified"],
  qualified: ["contacted", "unqualified"],
  unqualified: ["new", "contacted"],
  converted: [],
};

export const leadStatusSchema = z
  .object({
    id: z.uuid(),
    status: z.enum(["new", "contacted", "qualified", "unqualified"]),
    reason: optionalText(500),
  })
  .refine((v) => v.status !== "unqualified" || Boolean(v.reason), { path: ["reason"], message: "leads.reasonRequired" });

export const convertLeadSchema = z
  .object({
    leadId: z.uuid(),
    createCompany: z.boolean().default(true),
    createDeal: z.boolean().default(true),
    dealTitle: optionalText(200),
    dealValue: moneyToCents,
    pipelineId: optionalUuid,
    stageId: optionalUuid,
  })
  .refine((v) => !v.createDeal || (v.pipelineId && v.stageId), { path: ["stageId"], message: "validation.required" });
export type ConvertLeadInput = z.infer<typeof convertLeadSchema>;

export const leadListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(LEAD_STATUSES).optional(),
  owner: z.string().max(40).optional(),
  source: z.enum(LEAD_SOURCES).optional(),
  ai: z.enum(AI_CLASSIFICATIONS).optional(),
  sort: z.enum(["created_desc", "created_asc", "score_desc", "name_asc"]).default("created_desc"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(25),
});
export type LeadListQuery = z.infer<typeof leadListQuerySchema>;

/* ------------------------------------------------------------------ Deals */

export const DEAL_STATUSES = ["open", "won", "lost"] as const;
export type DealStatus = (typeof DEAL_STATUSES)[number];
export const CURRENCIES = ["ILS", "USD", "EUR", "GBP"] as const;

export const dealInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  value: moneyToCents,
  currency: z.enum(CURRENCIES).default("ILS"),
  pipelineId: z.uuid(),
  stageId: z.uuid(),
  probability: optionalPercent,
  expectedCloseDate: optionalDate,
  contactId: optionalUuid,
  companyId: optionalUuid,
  ownerId: optionalUuid,
  customFields: z.record(z.string(), z.unknown()).default({}),
  tagIds: z.array(z.uuid()).max(50).optional(),
});
export type DealInput = z.infer<typeof dealInputSchema>;

export const moveDealSchema = z.object({
  id: z.uuid(),
  stageId: z.uuid(),
  /** Neighbours in the target column after the drop (null at the edges). */
  beforeId: z.uuid().nullable().optional(),
  afterId: z.uuid().nullable().optional(),
});

export const loseDealSchema = z.object({
  id: z.uuid(),
  lostReasonId: optionalUuid,
  lostNote: optionalText(1000),
});

export const dealListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(DEAL_STATUSES).optional(),
  owner: z.string().max(40).optional(),
  pipeline: z.uuid().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  view: z.enum(["board", "list"]).default("board"),
  sort: z.enum(["created_desc", "value_desc", "close_asc", "title_asc"]).default("created_desc"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(25),
});
export type DealListQuery = z.infer<typeof dealListQuerySchema>;

/* -------------------------------------------------------------- Pipelines */

export const STAGE_KINDS = ["open", "won", "lost"] as const;
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "validation.color");

export const pipelineInputSchema = z.object({ name: z.string().trim().min(1).max(80) });

export const stageInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  probability: z.coerce.number().int().min(0).max(100),
  kind: z.enum(STAGE_KINDS).default("open"),
  color: hexColor.default("#64748b"),
});
export type StageInput = z.infer<typeof stageInputSchema>;

export const lostReasonInputSchema = z.object({ label: z.string().trim().min(1).max(80), active: z.boolean().default(true) });

/** Lenient parsing of searchParams (invalid values fall back to defaults). */
export function parseQuery<S extends z.ZodObject>(schema: S, params: Record<string, string | string[] | undefined>): z.infer<S> {
  const flat = Object.fromEntries(
    Object.entries(params)
      .map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])
      .filter(([, v]) => v !== "" && v !== undefined),
  );
  const parsed = schema.safeParse(flat);
  if (parsed.success) return parsed.data;
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(flat)) {
    const field = schema.shape[k] as z.ZodType | undefined;
    if (field && field.safeParse(v).success) cleaned[k] = v;
  }
  return schema.parse(cleaned);
}

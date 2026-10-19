import { z } from "zod";
import { normalizePhone } from "@/lib/phone";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

/** Website: "example.co.il" becomes https://example.co.il; only http(s) URLs are accepted (no javascript:). */
const optionalWebsite = optionalText(300).transform((v, ctx) => {
  if (!v) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol === "http:" || url.protocol === "https:") return url.toString();
  } catch {
    // fall through
  }
  ctx.addIssue({ code: "custom", message: "validation.url" });
  return z.NEVER;
});

export const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .optional()
  .nullable()
  .transform((v) => (v ? v : null))
  .pipe(z.email().nullable());

export const optionalPhone = z
  .string()
  .trim()
  .max(40)
  .optional()
  .nullable()
  .transform((v, ctx) => {
    if (!v) return null;
    const n = normalizePhone(v);
    if (!n) {
      ctx.addIssue({ code: "custom", message: "validation.phone" });
      return z.NEVER;
    }
    return n;
  });

export const optionalUuid = z
  .union([z.uuid(), z.literal(""), z.null()])
  .optional()
  .transform((v) => (v ? v : null));

export const LIFECYCLE_STAGES = ["subscriber", "lead", "opportunity", "customer", "churned", "other"] as const;

export const contactInputSchema = z
  .object({
    firstName: z.string().trim().max(100).default(""),
    lastName: z.string().trim().max(100).default(""),
    email: optionalEmail,
    phone: optionalPhone,
    title: optionalText(120),
    source: optionalText(60),
    lifecycleStage: z.enum(LIFECYCLE_STAGES).default("lead"),
    companyId: optionalUuid,
    ownerId: optionalUuid,
    customFields: z.record(z.string(), z.unknown()).default({}),
    tagIds: z.array(z.uuid()).max(50).optional(),
  })
  .refine((v) => v.firstName || v.lastName || v.email || v.phone, { path: ["firstName"], message: "contacts.nameOrContactRequired" });
export type ContactInput = z.infer<typeof contactInputSchema>;

export const companyInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  domain: optionalText(253),
  industry: optionalText(100),
  sizeRange: z
    .enum(["1-10", "11-50", "51-200", "201-1000", "1000+"])
    .optional()
    .nullable()
    .or(z.literal("").transform(() => null)),
  phone: optionalPhone,
  email: optionalEmail,
  website: optionalWebsite,
  address: optionalText(300),
  city: optionalText(100),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/)
    .optional()
    .nullable()
    .or(z.literal("").transform(() => null)),
  ownerId: optionalUuid,
  customFields: z.record(z.string(), z.unknown()).default({}),
  tagIds: z.array(z.uuid()).max(50).optional(),
});
export type CompanyInput = z.infer<typeof companyInputSchema>;

export const listQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  owner: z.string().max(40).optional(),
  stage: z.enum(LIFECYCLE_STAGES).optional(),
  tag: z.uuid().optional(),
  company: z.uuid().optional(),
  consent: z.enum(["unknown", "opted_in", "opted_out"]).optional(),
  sort: z.enum(["created_desc", "created_asc", "name_asc", "activity_desc"]).default("created_desc"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(25),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

/** Parses Next.js searchParams leniently (bad values fall back to defaults). */
export function parseListQuery(params: Record<string, string | string[] | undefined>): ListQuery {
  const flat = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]).filter(([, v]) => v !== "" && v !== undefined));
  const parsed = listQuerySchema.safeParse(flat);
  if (parsed.success) return parsed.data;
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(flat)) {
    const field = listQuerySchema.shape[k as keyof typeof listQuerySchema.shape];
    if (field && field.safeParse(v).success) cleaned[k] = v;
  }
  return listQuerySchema.parse(cleaned);
}

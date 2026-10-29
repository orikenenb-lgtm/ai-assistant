import { z } from "zod";
import { CALLBACK_WINDOWS, LEAD_SOURCES } from "@/lib/lead-constants";
import { parsePhone } from "@/lib/phone";

export { CALLBACK_LABELS, CALLBACK_WINDOWS, LEAD_SOURCES } from "@/lib/lead-constants";

const trimmed = (max: number) => z.string().trim().max(max);

/** What the browser (form or demo agent) may send. */
export const leadInputSchema = z.object({
  name: trimmed(60).min(2, "נא למלא שם (לפחות 2 תווים)"),
  phone: trimmed(40).refine((v) => parsePhone(v) !== null, "מספר הטלפון לא נראה תקין"),
  business: trimmed(80).optional().default(""),
  message: trimmed(1000).optional().default(""),
  callback: z.enum(CALLBACK_WINDOWS).optional().default("asap"),
  marketingConsent: z.boolean().optional().default(false),
  source: z.enum(LEAD_SOURCES).optional().default("form"),
  /** Honeypot: real people never see or fill it. */
  website: z.string().max(200).optional().default(""),
  /** Page the lead came from, plus UTM params; informational only. */
  page: trimmed(300).optional().default(""),
});

export type LeadInput = z.input<typeof leadInputSchema>;

export type Lead = {
  id: string;
  createdAt: string;
  name: string;
  phone: string;
  phoneDisplay: string;
  business: string;
  message: string;
  callback: (typeof CALLBACK_WINDOWS)[number];
  marketingConsent: boolean;
  source: (typeof LEAD_SOURCES)[number];
  page: string;
};

export type LeadParseResult =
  | { ok: true; lead: Lead; spam: boolean }
  | { ok: false; errors: Record<string, string> };

export function parseLead(input: unknown): LeadParseResult {
  const result = leadInputSchema.safeParse(input);
  if (!result.success) {
    const errors: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = String(issue.path[0] ?? "form");
      if (!errors[key]) errors[key] = issue.message;
    }
    return { ok: false, errors };
  }
  const data = result.data;
  const phone = parsePhone(data.phone)!;
  return {
    ok: true,
    spam: data.website.trim().length > 0,
    lead: {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      name: data.name,
      phone: phone.e164,
      phoneDisplay: phone.display,
      business: data.business,
      message: data.message,
      callback: data.callback,
      marketingConsent: data.marketingConsent,
      source: data.source,
      page: data.page,
    },
  };
}

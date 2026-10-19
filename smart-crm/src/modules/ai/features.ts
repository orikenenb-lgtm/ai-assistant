import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@/server/db";
import type { ServiceCtx } from "@/server/context";
import { audit } from "@/server/audit";
import { AppError } from "@/server/errors";
import { hasHebrew, looksLikeInjection, sanitizeDraft, systemPreamble, untrusted } from "./guard";
import { parseJson, runAi } from "./runtime";
import { loadContactContext, loadConversation, loadDeal, loadLead, salesStats, transcriptText, type TranscriptLine } from "./data";

type Locale = "he" | "en";
const strictObject = (properties: Record<string, unknown>) => ({
  type: "object",
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
});
const str = { type: "string" };
const strArray = { type: "array", items: { type: "string" } };

/* ------------------------------------------------------------- heuristics */

export const INTENTS = ["purchase", "pricing", "support", "complaint", "scheduling", "information", "spam", "other"] as const;
export type Intent = (typeof INTENTS)[number];

const INTENT_KEYWORDS: [Intent, RegExp][] = [
  ["complaint", /(תלונה|לא מרוצה|גרוע|מאוכזב|החזר כספי|refund|complain|terrible|disappointed|broken)/i],
  ["pricing", /(מחיר|כמה עולה|הצעת מחיר|הנחה|price|cost|quote|discount|how much)/i],
  ["purchase", /(להזמין|הזמנה|לקנות|רוצה לרכוש|order|buy|purchase|in stock|במלאי)/i],
  ["scheduling", /(פגישה|לתאם|מתי אפשר|זמין|meeting|schedule|appointment|available)/i],
  ["support", /(תקלה|בעיה|לא עובד|עזרה|support|problem|issue|not working|help)/i],
  ["spam", /(bitcoin|crypto investment|lottery|הגרלה זכית|click here)/i],
  ["information", /(שאלה|מידע|פרטים|האם|question|info|details|\?)/i],
];

export function heuristicIntent(text: string): { intent: Intent; confidence: number; needsHuman: boolean } {
  const hit = INTENT_KEYWORDS.find(([, re]) => re.test(text));
  const intent: Intent = hit?.[0] ?? "other";
  const needsHuman = intent === "complaint" || /(נציג|אדם אמיתי|human|agent|representative)/i.test(text);
  return { intent, confidence: hit ? 0.7 : 0.3, needsHuman };
}

function lastCustomerText(lines: TranscriptLine[]) {
  return [...lines].reverse().find((l) => l.from === "customer")?.text ?? "";
}

function detectLocale(lines: TranscriptLine[], fallback: Locale): Locale {
  const sample = lines.filter((l) => l.from === "customer").map((l) => l.text).join(" ");
  if (!sample) return fallback;
  return hasHebrew(sample) ? "he" : "en";
}

/* --------------------------------------------------- conversation features */

const summarySchema = z.object({
  summary: z.string(),
  keyPoints: z.array(z.string()),
  sentiment: z.enum(["positive", "neutral", "negative"]),
  openQuestions: z.array(z.string()),
});
export type ConversationSummary = z.infer<typeof summarySchema> & { suspicious: boolean };

export async function summarizeConversation(ctx: ServiceCtx, conversationId: string, locale: Locale): Promise<ConversationSummary> {
  const conv = await loadConversation(ctx, conversationId);
  if (!conv.lines.length) throw new AppError("VALIDATION", "ai.nothingToAnalyze");
  const transcript = transcriptText(conv.lines);
  const result = await runAi(
    ctx,
    "summarize",
    { type: "conversation", id: conversationId },
    {
      messages: [
        { role: "system", content: systemPreamble(locale) },
        {
          role: "user",
          // The display name comes from the customer's WhatsApp profile: untrusted like the messages.
          content: `Summarize this WhatsApp conversation for a sales agent. Return JSON.\nCustomer display name:\n${untrusted("customer_name", conv.contactName, 200)}\n${untrusted("whatsapp_conversation", transcript, 12000)}`,
        },
      ],
      jsonSchema: {
        name: "conversation_summary",
        schema: strictObject({ summary: str, keyPoints: strArray, sentiment: { type: "string", enum: ["positive", "neutral", "negative"] }, openQuestions: strArray }),
      },
      mockResponse: () => {
        const customer = conv.lines.filter((l) => l.from === "customer");
        const negative = customer.some((l) => heuristicIntent(l.text).intent === "complaint");
        const he = locale === "he";
        return JSON.stringify({
          summary: he
            ? `שיחה עם ${conv.contactName || "הלקוח"}: ${customer.length} הודעות מהלקוח ו-${conv.lines.length - customer.length} תגובות. ההודעה האחרונה: "${lastCustomerText(conv.lines).slice(0, 120)}"`
            : `Conversation with ${conv.contactName || "the customer"}: ${customer.length} customer messages and ${conv.lines.length - customer.length} replies. Last message: "${lastCustomerText(conv.lines).slice(0, 120)}"`,
          keyPoints: customer.slice(-3).map((l) => l.text.slice(0, 100)),
          sentiment: negative ? "negative" : "neutral",
          openQuestions: customer.filter((l) => l.text.includes("?")).slice(-2).map((l) => l.text.slice(0, 100)),
        });
      },
    },
    { estimatedTokens: Math.ceil(transcript.length / 3) + 500 },
  );
  return { ...summarySchema.parse(parseJson(result.content)), suspicious: conv.lines.some((l) => l.from === "customer" && looksLikeInjection(l.text)) };
}

const draftSchema = z.object({ reply: z.string().min(1) });

/** Drafts a reply for the agent to review — it is never sent automatically. */
export async function draftReply(ctx: ServiceCtx, conversationId: string, opts: { locale: Locale; instructions?: string }) {
  const conv = await loadConversation(ctx, conversationId, 20);
  const replyLocale = detectLocale(conv.lines, opts.locale);
  const last = lastCustomerText(conv.lines);
  const result = await runAi(
    ctx,
    "draft_reply",
    { type: "conversation", id: conversationId },
    {
      messages: [
        { role: "system", content: systemPreamble(opts.locale) },
        {
          role: "user",
          content: [
            `Draft the next WhatsApp reply from our business to the customer, in ${replyLocale === "he" ? "Hebrew" : "English"}.`,
            "Friendly, professional, short (max 3 sentences). Do not invent prices, stock or promises; if information is missing, ask or say we will check.",
            opts.instructions ? `Agent instructions (trusted): ${opts.instructions.slice(0, 500)}` : "",
            untrusted("whatsapp_conversation", transcriptText(conv.lines), 8000),
            'Return JSON {"reply": "..."}',
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
      jsonSchema: { name: "draft_reply", schema: strictObject({ reply: str }) },
      mockResponse: () => {
        const intent = heuristicIntent(last).intent;
        const name = conv.contactName.split(" ")[0];
        const he: Record<Intent, string> = {
          purchase: "תודה על ההתעניינות! אשמח לעזור עם ההזמנה — אילו מוצרים ובאיזו כמות?",
          pricing: "תודה על הפנייה! אבדוק את המחיר המעודכן ואחזור אליך עם הצעה מסודרת בהקדם.",
          support: "מצטערים לשמוע על הבעיה. נבדוק מיד — אפשר לשלוח פרטים או תמונה?",
          complaint: "אנחנו מצטערים מאוד על החוויה. נציג בכיר יחזור אליך עוד היום כדי לפתור את העניין.",
          scheduling: "בשמחה! אילו ימים ושעות נוחים לך השבוע?",
          information: "שאלה מצוינת — אבדוק ואחזור אליך עם כל הפרטים.",
          spam: "תודה על ההודעה.",
          other: "תודה על הפנייה! איך אפשר לעזור?",
        };
        const en: Record<Intent, string> = {
          purchase: "Thanks for your interest! Happy to help with your order — which products and quantities?",
          pricing: "Thanks for reaching out! I'll check the current price and get back to you with a quote shortly.",
          support: "Sorry to hear about the issue. We'll look into it right away — could you share details or a photo?",
          complaint: "We're very sorry about your experience. A senior team member will contact you today to make it right.",
          scheduling: "Gladly! Which days and times work for you this week?",
          information: "Great question — I'll check and get back to you with the details.",
          spam: "Thanks for your message.",
          other: "Thanks for reaching out! How can we help?",
        };
        const greeting = name ? (replyLocale === "he" ? `היי ${name}, ` : `Hi ${name}, `) : "";
        return JSON.stringify({ reply: greeting + (replyLocale === "he" ? he : en)[intent] });
      },
    },
  );
  const parsed = draftSchema.parse(parseJson(result.content));
  return { reply: sanitizeDraft(parsed.reply), language: replyLocale, interactionId: result.interactionId };
}

const intentSchema = z.object({ intent: z.enum(INTENTS), confidence: z.number().min(0).max(1), needsHuman: z.boolean(), reason: z.string() });

export async function detectIntent(ctx: ServiceCtx, conversationId: string, locale: Locale) {
  const conv = await loadConversation(ctx, conversationId, 10);
  const last = lastCustomerText(conv.lines);
  if (!last) throw new AppError("VALIDATION", "ai.nothingToAnalyze");
  const result = await runAi(
    ctx,
    "intent",
    { type: "conversation", id: conversationId },
    {
      messages: [
        { role: "system", content: systemPreamble(locale) },
        {
          role: "user",
          content: `Classify the customer's current intent. Allowed intents: ${INTENTS.join(", ")}. needsHuman=true for complaints, explicit requests for a person, or sensitive issues. Return JSON.\n${untrusted("whatsapp_conversation", transcriptText(conv.lines), 4000)}`,
        },
      ],
      jsonSchema: {
        name: "intent",
        schema: strictObject({ intent: { type: "string", enum: [...INTENTS] }, confidence: { type: "number" }, needsHuman: { type: "boolean" }, reason: str }),
      },
      mockResponse: () => {
        const h = heuristicIntent(last);
        return JSON.stringify({ ...h, reason: locale === "he" ? "זוהה לפי מילות מפתח בהודעה האחרונה" : "Detected from keywords in the latest message" });
      },
    },
  );
  return intentSchema.parse(parseJson(result.content));
}

/* --------------------------------------------------------- CRM features */

const leadClassSchema = z.object({ classification: z.enum(["hot", "warm", "cold", "spam"]), score: z.number().int().min(0).max(100), reason: z.string() });

export function heuristicLeadScore(lead: { email: string | null; phone: string | null; companyName: string | null; message: string | null; estimatedValueCents: number | null; source: string }) {
  let score = 20;
  if (lead.phone) score += 15;
  if (lead.email) score += 10;
  if (lead.companyName) score += 10;
  if (lead.estimatedValueCents && lead.estimatedValueCents >= 1_000_000) score += 20;
  if (["referral", "event"].includes(lead.source)) score += 15;
  const intent = heuristicIntent(lead.message ?? "").intent;
  if (intent === "purchase" || intent === "pricing") score += 15;
  if (intent === "spam") return { classification: "spam" as const, score: 0 };
  score = Math.min(100, score);
  return { classification: (score >= 70 ? "hot" : score >= 45 ? "warm" : "cold") as "hot" | "warm" | "cold", score };
}

/** Classifies and scores a lead; persists the result when the user may edit leads. */
export async function classifyLead(ctx: ServiceCtx, leadId: string, locale: Locale) {
  const { lead, activities } = await loadLead(ctx, leadId);
  // Name and company are typed by the lead (web forms): passed as untrusted data, not facts.
  const facts = {
    source: lead.source,
    hasPhone: Boolean(lead.phone),
    hasEmail: Boolean(lead.email),
    estimatedValue: lead.estimatedValueCents ? lead.estimatedValueCents / 100 : null,
    status: lead.status,
    recentActivityTypes: activities.map((a) => a.type),
  };
  const result = await runAi(
    ctx,
    "classify_lead",
    { type: "lead", id: leadId },
    {
      messages: [
        { role: "system", content: systemPreamble(locale) },
        {
          role: "user",
          content: `Classify this sales lead as hot, warm, cold or spam and give a 0-100 score with a one-sentence reason (in ${locale === "he" ? "Hebrew" : "English"}). Facts (trusted): ${JSON.stringify(facts)}\nWhat the lead submitted (name, company, message):\n${untrusted("lead_form", `${lead.fullName}\n${lead.companyName ?? ""}\n${lead.message ?? ""}`, 2400)}`,
        },
      ],
      jsonSchema: {
        name: "lead_classification",
        schema: strictObject({ classification: { type: "string", enum: ["hot", "warm", "cold", "spam"] }, score: { type: "integer" }, reason: str }),
      },
      mockResponse: () => {
        const h = heuristicLeadScore(lead);
        return JSON.stringify({
          ...h,
          reason: locale === "he" ? `ניקוד לפי שלמות הפרטים, מקור (${lead.source}) ותוכן הפנייה` : `Scored on completeness, source (${lead.source}) and message content`,
        });
      },
    },
  );
  const out = leadClassSchema.parse(parseJson(result.content));
  if (ctx.can("leads.update") && !ctx.readOnly) {
    await ctx.run(async (tx) => {
      await tx
        .update(schema.leads)
        .set({ aiClassification: out.classification, aiClassificationReason: out.reason.slice(0, 1000), aiClassifiedAt: new Date(), score: out.score })
        .where(and(eq(schema.leads.id, leadId), eq(schema.leads.tenantId, ctx.tenantId)));
      await audit(tx, { ...ctx, actorType: "ai" }, { action: "lead.ai_classified", entityType: "lead", entityId: leadId, metadata: { classification: out.classification, score: out.score } });
    });
  }
  return out;
}

const contactSummarySchema = z.object({ summary: z.string(), highlights: z.array(z.string()), risks: z.array(z.string()), suggestedNextStep: z.string() });

export async function summarizeContact(ctx: ServiceCtx, contactId: string, locale: Locale) {
  const data = await loadContactContext(ctx, contactId);
  const c = data.contact;
  const facts = {
    name: `${c.firstName} ${c.lastName}`.trim(),
    lifecycleStage: c.lifecycleStage,
    whatsappConsent: c.whatsappConsent,
    deals: data.deals.map((d) => ({ title: d.title, value: d.valueCents / 100, currency: d.currency, status: d.status, stage: d.stage, expectedClose: d.expectedClose })),
    openTasks: data.tasks.map((t) => ({ title: t.title, dueAt: t.dueAt })),
    recentActivity: data.activities.map((a) => ({ type: a.type, subject: a.subject, at: a.at })),
  };
  const notesText = data.notes.map((n) => n.body).join("\n---\n");
  const result = await runAi(
    ctx,
    "summarize",
    { type: "contact", id: contactId },
    {
      messages: [
        { role: "system", content: systemPreamble(locale) },
        {
          role: "user",
          content: `Write a short account brief for a salesperson: summary (2-3 sentences), highlights, risks and one suggested next step. Facts (trusted CRM data): ${JSON.stringify(facts)}\nTeam notes and logged activity text:\n${untrusted("crm_notes", notesText + "\n" + data.activities.map((a) => a.body ?? "").join("\n"), 6000)}`,
        },
      ],
      jsonSchema: { name: "contact_brief", schema: strictObject({ summary: str, highlights: strArray, risks: strArray, suggestedNextStep: str }) },
      mockResponse: () => {
        const he = locale === "he";
        const open = data.deals.filter((d) => d.status === "open");
        const won = data.deals.filter((d) => d.status === "won");
        const lastAct = data.activities[0];
        const daysSince = lastAct ? Math.floor((Date.now() - new Date(lastAct.at).getTime()) / 86400_000) : null;
        return JSON.stringify({
          summary: he
            ? `${facts.name || "איש הקשר"} בשלב "${c.lifecycleStage}", עם ${open.length} עסקאות פתוחות ו-${won.length} עסקאות שנסגרו.`
            : `${facts.name || "This contact"} is at stage "${c.lifecycleStage}" with ${open.length} open and ${won.length} won deals.`,
          highlights: [
            ...won.slice(0, 2).map((d) => (he ? `נסגרה עסקה: ${d.title}` : `Won: ${d.title}`)),
            ...data.notes.slice(0, 1).map((n) => n.body.slice(0, 120)),
          ],
          risks: [
            ...(daysSince !== null && daysSince > 14 ? [he ? `אין פעילות כבר ${daysSince} ימים` : `No activity for ${daysSince} days`] : []),
            ...(c.whatsappConsent === "opted_out" ? [he ? "ביקש/ה להסיר מ-WhatsApp" : "Opted out of WhatsApp"] : []),
          ],
          suggestedNextStep: open.length
            ? he
              ? `לקדם את "${open[0].title}" — לתאם שיחת המשך`
              : `Advance "${open[0].title}" — schedule a follow-up call`
            : he
              ? "לבדוק צורך חדש ולהציע מוצרים רלוונטיים"
              : "Check for new needs and suggest relevant products",
        });
      },
    },
  );
  return contactSummarySchema.parse(parseJson(result.content));
}

const actionsSchema = z.object({
  actions: z.array(
    z.object({
      title: z.string(),
      rationale: z.string(),
      kind: z.enum(["call", "message", "meeting", "task", "deal_update"]),
      dueInDays: z.number().int().min(0).max(60),
      priority: z.enum(["low", "medium", "high", "urgent"]),
    }),
  ),
});
export type RecommendedAction = z.infer<typeof actionsSchema>["actions"][number];

/** Next best actions for a contact or deal (advice only; tasks become proposals). */
export async function recommendNextActions(ctx: ServiceCtx, entity: { type: "contact" | "deal"; id: string }, locale: Locale): Promise<RecommendedAction[]> {
  const he = locale === "he";
  let facts: Record<string, unknown>;
  let fallback: RecommendedAction[];
  if (entity.type === "deal") {
    const d = await loadDeal(ctx, entity.id);
    const daysSince = d.activities[0] ? Math.floor((Date.now() - new Date(d.activities[0].at).getTime()) / 86400_000) : null;
    facts = { title: d.deal.title, value: d.deal.valueCents / 100, stage: d.stage, probability: d.deal.probability ?? d.stageProbability, expectedClose: d.deal.expectedCloseDate, status: d.deal.status, daysSinceLastActivity: daysSince };
    fallback = [
      { title: he ? `שיחת מעקב על "${d.deal.title}"` : `Follow-up call on "${d.deal.title}"`, rationale: he ? "שמירה על מומנטום בעסקה" : "Keep momentum on the deal", kind: "call", dueInDays: 1, priority: "high" },
      { title: he ? "שליחת הצעת מחיר מעודכנת" : "Send an updated quote", rationale: he ? `העסקה בשלב "${d.stage}"` : `Deal is in stage "${d.stage}"`, kind: "task", dueInDays: 3, priority: "medium" },
    ];
  } else {
    const c = await loadContactContext(ctx, entity.id);
    facts = { lifecycleStage: c.contact.lifecycleStage, openDeals: c.deals.filter((d) => d.status === "open").length, openTasks: c.tasks.length, lastActivity: c.activities[0]?.at ?? null };
    fallback = [
      { title: he ? "שיחת היכרות/מעקב" : "Check-in call", rationale: he ? "יצירת קשר אישי" : "Build the relationship", kind: "call", dueInDays: 2, priority: "medium" },
      ...(c.deals.some((d) => d.status === "open")
        ? []
        : [{ title: he ? "פתיחת עסקה חדשה" : "Open a new deal", rationale: he ? "אין עסקה פתוחה" : "No open deal", kind: "deal_update" as const, dueInDays: 7, priority: "low" as const }]),
    ];
  }
  const result = await runAi(
    ctx,
    "next_actions",
    { type: entity.type, id: entity.id },
    {
      messages: [
        { role: "system", content: systemPreamble(locale) },
        { role: "user", content: `Recommend up to 3 concrete next actions for this ${entity.type} (titles in ${he ? "Hebrew" : "English"}). CRM facts (trusted): ${JSON.stringify(facts)}. Return JSON.` },
      ],
      jsonSchema: {
        name: "next_actions",
        schema: strictObject({
          actions: {
            type: "array",
            items: strictObject({
              title: str,
              rationale: str,
              kind: { type: "string", enum: ["call", "message", "meeting", "task", "deal_update"] },
              dueInDays: { type: "integer" },
              priority: { type: "string", enum: ["low", "medium", "high", "urgent"] },
            }),
          },
        }),
      },
      mockResponse: () => JSON.stringify({ actions: fallback }),
    },
  );
  return actionsSchema.parse(parseJson(result.content)).actions.slice(0, 3);
}

const trendsSchema = z.object({ headline: z.string(), insights: z.array(z.string()), recommendations: z.array(z.string()) });

export async function analyzeTrends(ctx: ServiceCtx, days: number, locale: Locale) {
  const stats = await salesStats(ctx, days);
  const he = locale === "he";
  const result = await runAi(
    ctx,
    "trends",
    null,
    {
      messages: [
        { role: "system", content: systemPreamble(locale) },
        { role: "user", content: `Analyze these sales metrics for the last ${days} days vs the previous period. Give a headline, 2-4 insights and 2-3 recommendations. Money is in cents. Data (trusted): ${JSON.stringify(stats)}. Return JSON.` },
      ],
      jsonSchema: { name: "trends", schema: strictObject({ headline: str, insights: strArray, recommendations: strArray }) },
      mockResponse: () => {
        const delta = stats.wonValueCents - stats.previousWonValueCents;
        const winRate = stats.won + stats.lost > 0 ? Math.round((stats.won / (stats.won + stats.lost)) * 100) : null;
        const topSource = stats.leadsBySource[0];
        return JSON.stringify({
          headline: he
            ? `${stats.won} עסקאות נסגרו ב-${days} הימים האחרונים (${delta >= 0 ? "עלייה" : "ירידה"} לעומת התקופה הקודמת)`
            : `${stats.won} deals won in the last ${days} days (${delta >= 0 ? "up" : "down"} vs the previous period)`,
          insights: [
            ...(winRate !== null ? [he ? `שיעור הזכייה: ${winRate}%` : `Win rate: ${winRate}%`] : []),
            he ? `${stats.open} עסקאות פתוחות בצנרת` : `${stats.open} open deals in the pipeline`,
            ...(topSource ? [he ? `מקור הלידים המוביל: ${topSource.source} (${topSource.leads})` : `Top lead source: ${topSource.source} (${topSource.leads})`] : []),
            ...(stats.lostReasons[0] ? [he ? `סיבת ההפסד הנפוצה: ${stats.lostReasons[0].reason}` : `Most common loss reason: ${stats.lostReasons[0].reason}`] : []),
          ],
          recommendations: [
            he ? "לתעדף מעקב אחרי עסקאות בשלבים המתקדמים" : "Prioritize follow-ups on late-stage deals",
            ...(topSource ? [he ? `להשקיע עוד במקור "${topSource.source}"` : `Invest more in the "${topSource.source}" channel`] : []),
          ],
        });
      },
    },
  );
  return { stats, ...trendsSchema.parse(parseJson(result.content)) };
}

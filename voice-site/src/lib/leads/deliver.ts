import "server-only";
import { createHmac } from "node:crypto";
import { brand } from "@/config/site";
import { CALLBACK_LABELS, type Lead } from "@/lib/lead";

/**
 * Lead delivery. Every configured destination gets the lead in parallel; the
 * lead counts as delivered when at least one destination accepted it, so a
 * single flaky integration never loses a lead.
 *
 * Destinations (all optional, configured by env):
 * - LEAD_WEBHOOK_URL (+ LEAD_WEBHOOK_SECRET for an HMAC signature): Make,
 *   Zapier, n8n, a voice-agent platform that should call the lead back, etc.
 * - RESEND_API_KEY + LEAD_EMAIL_TO (+ LEAD_EMAIL_FROM): an email per lead.
 * - SMART_CRM_API_URL + SMART_CRM_API_KEY: creates a contact (stage "lead")
 *   and a call-back task in SMART CRM AI through its REST API v1.
 *
 * With nothing configured, development logs the lead to the console; production
 * refuses ("not_configured") so the visitor is told to use another channel
 * instead of the lead silently disappearing.
 */

export type DeliveryOutcome = {
  destination: "webhook" | "email" | "smart-crm" | "dev-log";
  ok: boolean;
  error?: string;
};

export type DeliveryResult =
  | { status: "delivered"; outcomes: DeliveryOutcome[] }
  | { status: "failed"; outcomes: DeliveryOutcome[] }
  | { status: "not_configured"; outcomes: [] };

const TIMEOUT_MS = 8000;

type Env = Record<string, string | undefined>;

function summaryLines(lead: Lead): string[] {
  return [
    `שם: ${lead.name}`,
    `טלפון: ${lead.phoneDisplay} (${lead.phone})`,
    lead.business ? `עסק: ${lead.business}` : "",
    `מתי לחזור: ${CALLBACK_LABELS[lead.callback]}`,
    lead.message ? `הודעה: ${lead.message}` : "",
    `מקור: ${lead.source === "demo-agent" ? "הסוכנת בדמו החי" : "טופס באתר"}`,
    lead.page ? `עמוד: ${lead.page}` : "",
    `הסכמה לדיוור: ${lead.marketingConsent ? "כן" : "לא"}`,
  ].filter(Boolean);
}

async function postJson(url: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
}

async function toWebhook(lead: Lead, env: Env): Promise<DeliveryOutcome> {
  const payload = { type: "lead.created", brand: brand.name, lead };
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {};
  if (env.LEAD_WEBHOOK_SECRET) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = createHmac("sha256", env.LEAD_WEBHOOK_SECRET).update(`${timestamp}.${body}`).digest("hex");
    headers["X-Signature"] = `t=${timestamp},v1=${signature}`;
  }
  const res = await fetch(env.LEAD_WEBHOOK_URL!, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  return res.ok ? { destination: "webhook", ok: true } : { destination: "webhook", ok: false, error: `HTTP ${res.status}` };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

async function toEmail(lead: Lead, env: Env): Promise<DeliveryOutcome> {
  const lines = summaryLines(lead);
  const res = await postJson(
    "https://api.resend.com/emails",
    {
      from: env.LEAD_EMAIL_FROM || `${brand.name} <onboarding@resend.dev>`,
      to: env.LEAD_EMAIL_TO!.split(",").map((s) => s.trim()).filter(Boolean),
      subject: `ליד חדש מהאתר: ${lead.name}${lead.business ? ` · ${lead.business}` : ""}`,
      text: lines.join("\n"),
      html: `<div dir="rtl" style="font-family:Arial,sans-serif;font-size:15px;line-height:1.7">${lines
        .map((l) => `<div>${escapeHtml(l)}</div>`)
        .join("")}<p><a href="tel:${lead.phone}">חיוג ל-${escapeHtml(lead.phoneDisplay)}</a></p></div>`,
    },
    { Authorization: `Bearer ${env.RESEND_API_KEY}` },
  );
  return res.ok ? { destination: "email", ok: true } : { destination: "email", ok: false, error: `HTTP ${res.status}` };
}

function splitName(full: string): { firstName: string; lastName?: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

async function toSmartCrm(lead: Lead, env: Env): Promise<DeliveryOutcome> {
  const base = env.SMART_CRM_API_URL!.replace(/\/$/, "");
  const auth = { Authorization: `Bearer ${env.SMART_CRM_API_KEY}` };
  const contactRes = await postJson(
    `${base}/contacts`,
    { ...splitName(lead.name), phone: lead.phone, lifecycleStage: "lead", source: "website" },
    auth,
  );
  // 409: the person is already in the CRM. Still worth a call-back task.
  if (!contactRes.ok && contactRes.status !== 409) {
    return { destination: "smart-crm", ok: false, error: `contacts HTTP ${contactRes.status}` };
  }

  // The contact is the lead of record; the task is a best-effort reminder.
  try {
    const contact = contactRes.ok ? ((await contactRes.json()) as { data?: { id?: string } }) : {};
    const contactId = contact.data?.id;
    const dueAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await postJson(
      `${base}/tasks`,
      {
        title: `לחזור לליד מהאתר: ${lead.name}`,
        description: summaryLines(lead).join("\n"),
        priority: "high",
        dueAt,
        ...(contactId ? { contactId } : {}),
      },
      auth,
    );
  } catch {
    // ignored: the contact already exists in the CRM
  }
  return { destination: "smart-crm", ok: true };
}

export function configuredDestinations(env: Env = process.env): DeliveryOutcome["destination"][] {
  const list: DeliveryOutcome["destination"][] = [];
  if (env.LEAD_WEBHOOK_URL) list.push("webhook");
  if (env.RESEND_API_KEY && env.LEAD_EMAIL_TO) list.push("email");
  if (env.SMART_CRM_API_URL && env.SMART_CRM_API_KEY) list.push("smart-crm");
  return list;
}

export async function deliverLead(lead: Lead, env: Env = process.env): Promise<DeliveryResult> {
  const destinations = configuredDestinations(env);

  if (destinations.length === 0) {
    if (env.NODE_ENV === "production") return { status: "not_configured", outcomes: [] };
    console.info("[lead] no destination configured, logging only (dev):", JSON.stringify(lead));
    return { status: "delivered", outcomes: [{ destination: "dev-log", ok: true }] };
  }

  const senders: Record<string, (l: Lead, e: Env) => Promise<DeliveryOutcome>> = {
    webhook: toWebhook,
    email: toEmail,
    "smart-crm": toSmartCrm,
  };

  const outcomes = await Promise.all(
    destinations.map(async (d) => {
      try {
        return await senders[d](lead, env);
      } catch (err) {
        return { destination: d, ok: false, error: err instanceof Error ? err.name : "error" } as DeliveryOutcome;
      }
    }),
  );

  for (const o of outcomes) {
    if (!o.ok) console.error(`[lead] delivery to ${o.destination} failed: ${o.error} (lead ${lead.id})`);
  }
  return outcomes.some((o) => o.ok) ? { status: "delivered", outcomes } : { status: "failed", outcomes };
}

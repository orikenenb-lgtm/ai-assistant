import { llmEnabled, respondWithClaude } from "@/lib/agent/llm";
import { isGoodbye, leadFailedReply, respond } from "@/lib/agent/rules";
import { agentRequestSchema } from "@/lib/agent/schema";
import { MAX_USER_TURNS, initialDemoState, type AgentResponse, type PendingLead } from "@/lib/agent/types";
import { json, readBody } from "@/lib/http";
import { parseLead } from "@/lib/lead";
import { deliverLead } from "@/lib/leads/deliver";
import { extractPhone } from "@/lib/phone";
import { clientIp, isSameOrigin, leadRateLimit, rateLimit } from "@/lib/rate-limit";
import type { ChatMessage } from "@/lib/agent/types";

const TEN_MINUTES = 10 * 60 * 1000;

/**
 * The slot state comes from the browser, so it is never trusted on its own:
 * the phone number must have been said by the visitor in this conversation,
 * and demo leads share the per-IP lead budget with the contact form.
 */
async function saveDemoLead(lead: PendingLead, ctx: { page: string; ip: string; messages: ChatMessage[] }): Promise<boolean> {
  const parsed = parseLead({ ...lead, source: "demo-agent", page: ctx.page, message: "נרשם/ה דרך הסוכנת בדמו החי באתר" });
  if (!parsed.ok) return false;
  const saidByVisitor = ctx.messages.some((m) => m.role === "user" && extractPhone(m.content)?.e164 === parsed.lead.phone);
  if (!saidByVisitor) return false;
  if (!leadRateLimit(ctx.ip).ok) return false;
  const result = await deliverLead(parsed.lead);
  return result.status === "delivered";
}

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return json({ error: "forbidden" }, { status: 403 });

  const ip = clientIp(request);
  const limited = rateLimit(`agent:${ip}`, 60, TEN_MINUTES);
  if (!limited.ok) {
    return json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } });
  }

  const body = await readBody(request);
  const parsed = body ? agentRequestSchema.safeParse(body.data) : null;
  if (!parsed?.success) return json({ error: "bad_request" }, { status: 400 });

  const { messages } = parsed.data;
  const state = parsed.data.state ?? initialDemoState;
  const page = request.headers.get("referer")?.slice(0, 300) ?? "";

  const userTurns = messages.filter((m) => m.role === "user").length;
  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";

  if (llmEnabled() && state.stage === "chat" && userTurns <= MAX_USER_TURNS) {
    try {
      const result = await respondWithClaude(messages, state, (lead) => saveDemoLead(lead, { page, ip, messages }));
      const response: AgentResponse = {
        reply: result.reply,
        state: result.state,
        lead: result.lead,
        end: (!result.lead && isGoodbye(lastUser)) || undefined,
        source: "llm",
      };
      return json(response);
    } catch (err) {
      console.error("[agent] Claude request failed, using rule engine:", err instanceof Error ? err.message : err);
    }
  }

  const result = respond(messages, state);
  const response: AgentResponse = { reply: result.reply, state: result.state, end: result.end, source: "rules" };

  if (result.saveLead) {
    const ok = await saveDemoLead(result.saveLead, { page, ip, messages });
    response.lead = ok ? "saved" : "failed";
    if (!ok) {
      response.reply = leadFailedReply;
      response.state = { ...result.state, leadSaved: false };
    }
  }
  return json(response);
}

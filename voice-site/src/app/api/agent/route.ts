import { llmEnabled, respondWithClaude } from "@/lib/agent/llm";
import { isGoodbye, leadFailedReply, respond } from "@/lib/agent/rules";
import { agentRequestSchema } from "@/lib/agent/schema";
import { MAX_USER_TURNS, initialDemoState, type AgentResponse, type PendingLead } from "@/lib/agent/types";
import { json, readBody } from "@/lib/http";
import { parseLead } from "@/lib/lead";
import { deliverLead } from "@/lib/leads/deliver";
import { clientIp, isSameOrigin, rateLimit } from "@/lib/rate-limit";

const TEN_MINUTES = 10 * 60 * 1000;

async function saveDemoLead(lead: PendingLead, page: string): Promise<boolean> {
  const parsed = parseLead({ ...lead, source: "demo-agent", page, message: "נרשם/ה דרך הסוכנת בדמו החי באתר" });
  if (!parsed.ok) return false;
  const result = await deliverLead(parsed.lead);
  return result.status === "delivered";
}

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return json({ error: "forbidden" }, { status: 403 });

  const limited = rateLimit(`agent:${clientIp(request)}`, 60, TEN_MINUTES);
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
      const result = await respondWithClaude(messages, state, (lead) => saveDemoLead(lead, page));
      const response: AgentResponse = {
        reply: result.reply,
        state: result.state,
        lead: result.lead,
        end: isGoodbye(lastUser) || undefined,
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
    const ok = await saveDemoLead(result.saveLead, page);
    response.lead = ok ? "saved" : "failed";
    if (!ok) {
      response.reply = leadFailedReply;
      response.state = { ...result.state, leadSaved: false };
    }
  }
  return json(response);
}

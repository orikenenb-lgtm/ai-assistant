import OpenAI from "openai";
import { env } from "@/server/env";

export type ChatRole = "system" | "user" | "assistant" | "tool";
export type ToolCall = { id: string; name: string; arguments: string };
export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; toolCalls?: ToolCall[] }
  | { role: "tool"; content: string; toolCallId: string };

export type ToolDef = { name: string; description: string; parameters: Record<string, unknown> };

export type CompletionRequest = {
  messages: ChatMessage[];
  tools?: ToolDef[];
  /** Forces structured JSON output matching this schema. */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  maxTokens?: number;
  /**
   * Deterministic answer used by the mock provider (each feature computes a
   * heuristic result from the same data it sends to the model).
   */
  mockResponse?: () => string | { toolCalls: ToolCall[] };
};

export type CompletionResult = {
  content: string | null;
  toolCalls: ToolCall[];
  usage: { inputTokens: number; outputTokens: number };
  model: string;
};

export interface AiProvider {
  readonly name: "openai" | "mock";
  readonly model: string;
  complete(req: CompletionRequest): Promise<CompletionResult>;
}

class OpenAIProvider implements AiProvider {
  readonly name = "openai" as const;
  private client: OpenAI;
  constructor(
    apiKey: string,
    readonly model: string,
  ) {
    this.client = new OpenAI({ apiKey, timeout: 45_000, maxRetries: 2 });
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const messages = req.messages.map((m) => {
      if (m.role === "tool") return { role: "tool" as const, content: m.content, tool_call_id: m.toolCallId };
      if (m.role === "assistant") {
        return {
          role: "assistant" as const,
          content: m.content,
          ...(m.toolCalls?.length
            ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: c.arguments } })) }
            : {}),
        };
      }
      return { role: m.role, content: m.content };
    });
    const res = await this.client.chat.completions.create({
      model: this.model,
      messages,
      max_completion_tokens: req.maxTokens ?? 1200,
      ...(req.tools?.length
        ? { tools: req.tools.map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.parameters } })) }
        : {}),
      ...(req.jsonSchema
        ? { response_format: { type: "json_schema" as const, json_schema: { name: req.jsonSchema.name, schema: req.jsonSchema.schema, strict: true } } }
        : {}),
    });
    const choice = res.choices[0];
    const toolCalls: ToolCall[] = (choice?.message.tool_calls ?? [])
      .filter((c) => c.type === "function")
      .map((c) => ({ id: c.id, name: c.function.name, arguments: c.function.arguments }));
    return {
      content: choice?.message.content ?? null,
      toolCalls,
      usage: { inputTokens: res.usage?.prompt_tokens ?? 0, outputTokens: res.usage?.completion_tokens ?? 0 },
      model: res.model,
    };
  }
}

/**
 * MOCK PROVIDER — development/tests only. Never contacts OpenAI. Returns each
 * feature's deterministic heuristic answer and estimates token usage, so the
 * full pipeline (metering, quotas, approvals) is exercised.
 */
class MockAiProvider implements AiProvider {
  readonly name = "mock" as const;
  readonly model = "mock-heuristics-v1";
  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const out = req.mockResponse?.() ?? JSON.stringify({ text: "Mock response" });
    const inputChars = req.messages.reduce((n, m) => n + (m.content?.length ?? 0), 0);
    if (typeof out === "object") {
      return { content: null, toolCalls: out.toolCalls, usage: { inputTokens: Math.ceil(inputChars / 4), outputTokens: 20 }, model: this.model };
    }
    return {
      content: out,
      toolCalls: [],
      usage: { inputTokens: Math.ceil(inputChars / 4), outputTokens: Math.ceil(out.length / 4) },
      model: this.model,
    };
  }
}

let provider: AiProvider | undefined;
export function aiProvider(): AiProvider {
  if (!provider) {
    const e = env();
    provider = e.AI_PROVIDER === "openai" && e.OPENAI_API_KEY ? new OpenAIProvider(e.OPENAI_API_KEY, e.OPENAI_MODEL) : new MockAiProvider();
  }
  return provider;
}

/** Test hook: swap the provider (e.g. a scripted fake). */
export function setAiProviderForTests(p: AiProvider | undefined) {
  provider = p;
}

/** USD micro-dollars for a call, from env-configured per-1M-token prices. */
export function costMicros(usage: { inputTokens: number; outputTokens: number }, providerName: string): number {
  if (providerName === "mock") return 0;
  const e = env();
  return Math.round(usage.inputTokens * e.OPENAI_PRICE_INPUT_PER_1M + usage.outputTokens * e.OPENAI_PRICE_OUTPUT_PER_1M);
}

import { beforeEach, describe, expect, it, vi } from "vitest";
import { initialDemoState, type ChatMessage } from "@/lib/agent/types";

const create = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    beta = { messages: { create } };
  },
}));

const { llmEnabled, respondWithClaude } = await import("@/lib/agent/llm");

const text = (t: string) => ({ type: "text", text: t });
const toolUse = (input: Record<string, string>, id = "tu_1") => ({ type: "tool_use", id, name: "save_lead", input });
const reply = (content: unknown[], stop_reason = "end_turn") => ({ content, stop_reason });

const history: ChatMessage[] = [
  { role: "assistant", content: "היי! אני נועה" },
  { role: "user", content: "כמה זה עולה?" },
];

beforeEach(() => {
  create.mockReset();
});

describe("llmEnabled", () => {
  it("needs a credential and can be forced off", () => {
    expect(llmEnabled({})).toBe(false);
    expect(llmEnabled({ ANTHROPIC_API_KEY: "sk" })).toBe(true);
    expect(llmEnabled({ ANTHROPIC_API_KEY: "sk", AGENT_MODE: "rules" })).toBe(false);
  });
});

describe("respondWithClaude", () => {
  it("returns the model's text and sends a well-formed request", async () => {
    create.mockResolvedValueOnce(reply([text("יש שלוש חבילות.")]));
    const save = vi.fn();
    const r = await respondWithClaude(history, initialDemoState, save);
    expect(r.reply).toBe("יש שלוש חבילות.");
    expect(save).not.toHaveBeenCalled();

    const req = create.mock.calls[0][0];
    expect(req.model).toBe("claude-opus-5-5");
    expect(req.messages[0].role).toBe("user"); // leading assistant greeting dropped
    expect(req.tools[0].name).toBe("save_lead");
    expect(req.betas).toContain("server-side-fallback-2026-07-01");
    expect(req.fallbacks).toBe("default");
    expect(req.output_config).toEqual({ effort: "low" });
    expect(req.thinking).toBeUndefined();
    expect(req.tool_choice).toBeUndefined();
  });

  it("saves a lead through the tool and reports it", async () => {
    create
      .mockResolvedValueOnce(reply([text("שומרת"), toolUse({ name: "דני", business: "מוסך", phone: "050-123-4567" })], "tool_use"))
      .mockResolvedValueOnce(reply([text("רשמתי, נחזור אליך.")]));
    const save = vi.fn().mockResolvedValue(true);
    const r = await respondWithClaude(history, initialDemoState, save);

    expect(save).toHaveBeenCalledWith({ name: "דני", business: "מוסך", phone: "+972501234567" });
    expect(r.lead).toBe("saved");
    expect(r.state.leadSaved).toBe(true);
    expect(r.reply).toBe("רשמתי, נחזור אליך.");

    const second = create.mock.calls[1][0];
    const results = second.messages.at(-1).content;
    expect(results[0]).toMatchObject({ type: "tool_result", tool_use_id: "tu_1", is_error: false });
  });

  it("rejects an invalid phone back to the model instead of saving", async () => {
    create
      .mockResolvedValueOnce(reply([toolUse({ name: "דני", business: "מוסך", phone: "123" })], "tool_use"))
      .mockResolvedValueOnce(reply([text("מה המספר המלא?")]));
    const save = vi.fn();
    const r = await respondWithClaude(history, initialDemoState, save);
    expect(save).not.toHaveBeenCalled();
    expect(r.lead).toBeUndefined();
    const results = create.mock.calls[1][0].messages.at(-1).content;
    expect(results[0]).toMatchObject({ type: "tool_result", is_error: true });
    expect(r.reply).toBe("מה המספר המלא?");
  });

  it("reports a failed save", async () => {
    create
      .mockResolvedValueOnce(reply([toolUse({ name: "דני", business: "מוסך", phone: "0501234567" })], "tool_use"))
      .mockResolvedValueOnce(reply([text("לא הצלחתי, השאירו פרטים בטופס.")]));
    const r = await respondWithClaude(history, initialDemoState, vi.fn().mockResolvedValue(false));
    expect(r.lead).toBe("failed");
    expect(r.state.leadSaved).toBe(false);
  });

  it("never saves the same conversation twice", async () => {
    create
      .mockResolvedValueOnce(reply([toolUse({ name: "דני", business: "מוסך", phone: "0501234567" })], "tool_use"))
      .mockResolvedValueOnce(reply([text("כבר רשום.")]));
    const save = vi.fn();
    await respondWithClaude(history, { ...initialDemoState, leadSaved: true }, save);
    expect(save).not.toHaveBeenCalled();
  });

  it("handles a refusal without leaking anything", async () => {
    create.mockResolvedValueOnce(reply([], "refusal"));
    const r = await respondWithClaude(history, initialDemoState, vi.fn());
    expect(r.reply).toContain("לא יכולה");
  });

  it("stops after a bounded number of tool rounds", async () => {
    create.mockResolvedValue(reply([toolUse({ name: "x", business: "", phone: "1" })], "tool_use"));
    const r = await respondWithClaude(history, initialDemoState, vi.fn());
    expect(create).toHaveBeenCalledTimes(3);
    expect(r.reply).toContain("השתבש");
  });
});

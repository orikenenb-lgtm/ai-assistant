/** Plain types and limits shared by the browser and the server (no zod here). */

export const MAX_MESSAGES = 40;
export const MAX_MESSAGE_CHARS = 600;
/**
 * After this many visitor turns the demo wraps up. Must stay below what fits in
 * the MAX_MESSAGES window the browser sends (about half of it is visitor turns).
 */
export const MAX_USER_TURNS = 16;

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type DemoStage = "chat" | "ask_name" | "ask_business" | "ask_phone" | "confirm";

export type DemoState = {
  stage: DemoStage;
  name?: string;
  business?: string;
  phone?: string;
  phoneDisplay?: string;
  phoneMisses: number;
  leadSaved: boolean;
};

export const initialDemoState: DemoState = { stage: "chat", phoneMisses: 0, leadSaved: false };

export type PendingLead = { name: string; business: string; phone: string };

export type EngineResult = {
  reply: string;
  state: DemoState;
  /** Set when the visitor confirmed their details and the lead should be saved now. */
  saveLead?: PendingLead;
  /** The visitor said goodbye; the client may hang up after speaking the reply. */
  end?: boolean;
};

export type AgentResponse = {
  reply: string;
  state: DemoState;
  end?: boolean;
  lead?: "saved" | "failed";
  source: "rules" | "llm";
};

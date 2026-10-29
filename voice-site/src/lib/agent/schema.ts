import { z } from "zod";
import { MAX_MESSAGE_CHARS, MAX_MESSAGES, type DemoState } from "@/lib/agent/types";

/** Visitor turns are capped tightly; agent turns come back from our own API. */
export const chatMessageSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1).max(2000),
  })
  .refine((m) => m.role === "assistant" || m.content.length <= MAX_MESSAGE_CHARS, "message too long");

export const demoStateSchema = z.object({
  stage: z.enum(["chat", "ask_name", "ask_business", "ask_phone", "confirm"]).default("chat"),
  name: z.string().max(60).optional(),
  business: z.string().max(80).optional(),
  phone: z.string().max(20).optional(),
  phoneDisplay: z.string().max(20).optional(),
  phoneMisses: z.number().int().min(0).max(10).default(0),
  leadSaved: z.boolean().default(false),
}) satisfies z.ZodType<DemoState, unknown>;

export const agentRequestSchema = z.object({
  messages: z.array(chatMessageSchema).min(1).max(MAX_MESSAGES),
  state: demoStateSchema.optional(),
});

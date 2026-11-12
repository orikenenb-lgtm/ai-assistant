/** AI assistant contracts — mirrors `apps/api/app/modules/ai/schemas.py` (api-contract §3.6). */
import { z } from 'zod';
import { IsoDateSchema } from './common';
import { CanonicalOfferSchema } from './offers';

export const AI_MESSAGE_MAX_CHARS = 2000;
export const AI_HISTORY_MAX_ITEMS = 20;
export const AI_HISTORY_ITEM_MAX_CHARS = 4000;

export const AiStatusSchema = z.object({
  provider: z.string(),
  available: z.boolean(),
  model: z.string().nullable().optional(),
  paid: z.boolean().default(false),
  label: z.string(),
  message: z.string(),
});
export type AiStatus = z.infer<typeof AiStatusSchema>;

export const GroundingSchema = z.object({
  ok: z.boolean().default(true),
  removed_claims: z.array(z.string()).default([]),
});
export type Grounding = z.infer<typeof GroundingSchema>;

export const ChatReplySchema = z.object({
  text: z.string(),
  mode: z.enum(['model', 'fallback']),
  cards: z.array(CanonicalOfferSchema).default([]),
  search_ids: z.array(z.string()).default([]),
  clarifying_question: z.string().nullable().optional(),
  warnings: z.array(z.string()).default([]),
  grounding: GroundingSchema.default({ ok: true, removed_claims: [] }),
});
export type ChatReply = z.infer<typeof ChatReplySchema>;

export const ToolCallSchema = z.object({
  name: z.string(),
  status: z.enum(['ok', 'error', 'rejected', 'skipped']),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

export const ChatResponseSchema = z.object({
  reply: ChatReplySchema,
  tool_calls: z.array(ToolCallSchema).default([]),
});
export type ChatResponse = z.infer<typeof ChatResponseSchema>;

export interface ChatRequest {
  message: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  context?: { trip_id?: string };
}

export const PlanItemSchema = z.object({
  type: z.enum(['activity', 'free']),
  time_slot: z.string(),
  time_slot_label: z.string(),
  title: z.string(),
  offer_id: z.string().nullable().optional(),
  start_time: z.string().nullable().optional(),
  duration_minutes: z.number().nullable().optional(),
  reasons: z.array(z.string()).default([]),
  card: CanonicalOfferSchema.nullable().optional(),
});
export type PlanItem = z.infer<typeof PlanItemSchema>;

export const PlanDaySchema = z.object({
  date: IsoDateSchema,
  weekday: z.string(),
  label: z.string(),
  items: z.array(PlanItemSchema),
});
export type PlanDay = z.infer<typeof PlanDaySchema>;

export const PlanTripResponseSchema = z.object({
  destination: z.string(),
  destination_code: z.string().nullable().optional(),
  start_date: IsoDateSchema,
  end_date: IsoDateSchema,
  days: z.array(PlanDaySchema),
  intro: z.string(),
  intro_mode: z.enum(['model', 'template']),
  search_id: z.string().nullable().optional(),
  interests: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
  grounding: GroundingSchema.default({ ok: true, removed_claims: [] }),
});
export type PlanTripResponse = z.infer<typeof PlanTripResponseSchema>;

export interface PlanTripRequest {
  destination: string;
  start_date: string;
  end_date: string;
  interests: string[];
  adults: number;
  children_ages: number[];
}

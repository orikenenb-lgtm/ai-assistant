/**
 * Client-side conversation store. Conversations live ONLY in this browser tab's
 * sessionStorage (last 20 turns); the server keeps nothing. Every storage access is
 * guarded — private windows / blocked storage must never break the chat.
 */
import { AI_HISTORY_ITEM_MAX_CHARS, AI_HISTORY_MAX_ITEMS, ChatResponseSchema, type ChatReply, type ToolCall } from '@/lib/schemas/ai';
import { z } from 'zod';

export const CONVERSATION_STORAGE_KEY = 'ori.assistant.conversation.v1';
export const MAX_STORED_TURNS = 20;

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** Present on assistant messages only. */
  reply?: ChatReply;
  toolCalls?: ToolCall[];
}

const StoredMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  text: z.string(),
  reply: ChatResponseSchema.shape.reply.optional(),
  toolCalls: ChatResponseSchema.shape.tool_calls.optional(),
});

let counter = 0;
export function newMessageId(): string {
  counter += 1;
  return `m${Date.now().toString(36)}${counter}`;
}

function storage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** Keep the last N *turns* (a turn is one user message and its reply = 2 messages). */
export function trimMessages(messages: ChatMessage[]): ChatMessage[] {
  const max = MAX_STORED_TURNS * 2;
  return messages.length > max ? messages.slice(messages.length - max) : messages;
}

export function loadConversation(): ChatMessage[] {
  const s = storage();
  if (!s) return [];
  try {
    const raw = s.getItem(CONVERSATION_STORAGE_KEY);
    if (!raw) return [];
    const parsed = z.array(StoredMessageSchema).safeParse(JSON.parse(raw));
    return parsed.success ? trimMessages(parsed.data) : [];
  } catch {
    return [];
  }
}

export function saveConversation(messages: ChatMessage[]): void {
  const s = storage();
  if (!s) return;
  const trimmed = trimMessages(messages);
  try {
    if (trimmed.length === 0) {
      s.removeItem(CONVERSATION_STORAGE_KEY);
      return;
    }
    s.setItem(CONVERSATION_STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Quota exceeded: retry without the (large) offer cards.
    try {
      const light = trimmed.map((m) => (m.reply ? { ...m, reply: { ...m.reply, cards: [] } } : m));
      s.setItem(CONVERSATION_STORAGE_KEY, JSON.stringify(light));
    } catch {
      // storage unavailable — the chat still works in memory
    }
  }
}

export function clearConversation(): void {
  try {
    storage()?.removeItem(CONVERSATION_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** History payload for POST /api/ai/chat: plain text only, newest 20 items, each within the server limit. */
export function toHistory(messages: ChatMessage[]): Array<{ role: 'user' | 'assistant'; content: string }> {
  return messages
    .filter((m) => m.text.trim().length > 0)
    .slice(-AI_HISTORY_MAX_ITEMS)
    .map((m) => ({ role: m.role, content: m.text.slice(0, AI_HISTORY_ITEM_MAX_CHARS) }));
}

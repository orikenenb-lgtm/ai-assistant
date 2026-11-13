import { beforeEach, describe, expect, it } from 'vitest';
import {
  CONVERSATION_STORAGE_KEY,
  clearConversation,
  loadConversation,
  saveConversation,
  toHistory,
  type ChatMessage,
} from './conversation';

const msg = (i: number, role: 'user' | 'assistant' = 'user'): ChatMessage => ({ id: `m${i}`, role, text: `הודעה ${i}` });

describe('conversation store', () => {
  beforeEach(() => sessionStorage.clear());

  it('keeps only the last 20 turns (40 messages)', () => {
    const all = Array.from({ length: 50 }, (_, i) => msg(i, i % 2 ? 'assistant' : 'user'));
    saveConversation(all);
    const loaded = loadConversation();
    expect(loaded).toHaveLength(40);
    expect(loaded[0]?.id).toBe('m10');
  });
  it('clears', () => {
    saveConversation([msg(1)]);
    clearConversation();
    expect(sessionStorage.getItem(CONVERSATION_STORAGE_KEY)).toBeNull();
    expect(loadConversation()).toEqual([]);
  });
  it('ignores corrupt storage', () => {
    sessionStorage.setItem(CONVERSATION_STORAGE_KEY, '{not json');
    expect(loadConversation()).toEqual([]);
  });
  it('builds a plain-text history of at most 20 items with bounded content', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ ...msg(i), text: 'x'.repeat(5000) }));
    const h = toHistory(many);
    expect(h).toHaveLength(20);
    expect(h[0]?.content.length).toBe(4000);
    expect(Object.keys(h[0] ?? {})).toEqual(['role', 'content']);
  });
});

import { vi, type Mock } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import type { AnthropicLike } from '../../../../src/main/ai/llm-client';

/**
 * MOCK: לקוח דמוי-Anthropic SDK — רק beta.messages.create ו-models.retrieve, בלי רשת.
 */
export interface MockAnthropic {
  client: AnthropicLike;
  create: Mock<(params: Record<string, unknown>, options: Record<string, unknown>) => Promise<Anthropic.Beta.BetaMessage>>;
  retrieve: Mock<(model: string, params: unknown, options: Record<string, unknown>) => Promise<unknown>>;
}

export function createMockAnthropic(): MockAnthropic {
  const create = vi.fn<(params: Record<string, unknown>, options: Record<string, unknown>) => Promise<Anthropic.Beta.BetaMessage>>();
  const retrieve = vi.fn<(model: string, params: unknown, options: Record<string, unknown>) => Promise<unknown>>(async (model) => ({
    id: model,
    type: 'model',
  }));
  const client = { beta: { messages: { create } }, models: { retrieve } } as unknown as AnthropicLike;
  return { client, create, retrieve };
}

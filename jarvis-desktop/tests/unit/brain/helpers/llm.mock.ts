import type Anthropic from '@anthropic-ai/sdk';
import type { LlmClient, LlmTurnRequest } from '../../../../src/main/ai/llm-client';
import { ProviderError } from '../../../../src/main/core/contracts';

/**
 * MOCK: לקוח LLM עם תשובות מתוסרטות (BetaMessage), שמתעד כל בקשה שקיבל.
 * שום דבר כאן לא פונה לרשת.
 */

export type MockStep =
  | Anthropic.Beta.BetaMessage
  | Error
  | 'hang'
  | ((req: LlmTurnRequest) => Anthropic.Beta.BetaMessage | Promise<Anthropic.Beta.BetaMessage>);

export interface RecordedRequest {
  system: string;
  messages: Anthropic.Beta.BetaMessageParam[];
  tools: Anthropic.Beta.BetaTool[];
  model: string;
  effort: string;
  timeoutMs: number;
  /** כל המפתחות שהגיעו בבקשה (כדי לוודא שלא נשלח thinking וכו'). */
  keys: string[];
}

export interface MockLlm extends LlmClient {
  readonly requests: RecordedRequest[];
  readonly signals: AbortSignal[];
  setConfigured(value: boolean): void;
  push(...steps: MockStep[]): void;
}

export function createMockLlm(steps: MockStep[] = [], opts: { configured?: boolean } = {}): MockLlm {
  const queue = [...steps];
  const requests: RecordedRequest[] = [];
  const signals: AbortSignal[] = [];
  let configured = opts.configured ?? true;

  return {
    requests,
    signals,
    setConfigured(value) {
      configured = value;
    },
    push(...more) {
      queue.push(...more);
    },
    isConfigured: () => configured,
    async runTurn(req) {
      requests.push({
        system: req.system,
        messages: structuredClone(req.messages),
        tools: structuredClone(req.tools),
        model: req.model,
        effort: req.effort,
        timeoutMs: req.timeoutMs,
        keys: Object.keys(req),
      });
      signals.push(req.signal);
      const step = queue.shift();
      if (step === undefined) throw new Error('MOCK llm: no scripted response left');
      if (step === 'hang') {
        return new Promise<Anthropic.Beta.BetaMessage>((_resolve, reject) => {
          const abort = (): void => reject(new ProviderError('CANCELLED', 'הבקשה ל-Claude בוטלה.', false));
          if (req.signal.aborted) abort();
          else req.signal.addEventListener('abort', abort, { once: true });
        });
      }
      if (step instanceof Error) throw step;
      if (typeof step === 'function') return step(req);
      return structuredClone(step);
    },
    async ping() {
      return undefined;
    },
  };
}

export function mockMessage(
  content: Array<Record<string, unknown>>,
  stop_reason: Anthropic.Beta.BetaStopReason,
  extra: Record<string, unknown> = {},
): Anthropic.Beta.BetaMessage {
  return {
    id: 'msg_mock',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content,
    stop_reason,
    stop_sequence: null,
    stop_details: null,
    container: null,
    context_management: null,
    diagnostics: null,
    usage: { input_tokens: 12, output_tokens: 7, cache_creation_input_tokens: 0, cache_read_input_tokens: 100 },
    ...extra,
  } as unknown as Anthropic.Beta.BetaMessage;
}

export const textBlock = (text: string): Record<string, unknown> => ({ type: 'text', text, citations: null });
export const thinkingBlock = (signature = 'sig-mock'): Record<string, unknown> => ({ type: 'thinking', thinking: '', signature });
export const toolUseBlock = (id: string, name: string, input: unknown): Record<string, unknown> => ({ type: 'tool_use', id, name, input });

import { describe, expect, it, vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import {
  createAnthropicLlmClient,
  createAnthropicVisionAnalyzer,
  mapAnthropicError,
  supportsServerFallback,
  VISION_SYSTEM_PROMPT,
  type LlmTurnRequest,
} from '../../../src/main/ai/llm-client';
import { ProviderError, type CapturedImage } from '../../../src/main/core/contracts';
import { createMockAnthropic } from './helpers/anthropic.mock';
import { createMockDatabase } from './helpers/db.mock';
import { createMockClock, createMockLogger, mockDisplay } from './helpers/env.mock';
import { mockMessage, textBlock, thinkingBlock } from './helpers/llm.mock';

const KEY = 'sk-ant-api03-MOCKKEY-0123456789abcdef';

function setup(key: string | null = KEY) {
  const mock = createMockAnthropic();
  const db = createMockDatabase();
  const logger = createMockLogger();
  const clock = createMockClock();
  let apiKey = key;
  const createClient = vi.fn(() => mock.client);
  const llm = createAnthropicLlmClient({ getApiKey: () => apiKey, logger, usage: db.usage, clock, createClient });
  return {
    mock,
    db,
    logger,
    llm,
    createClient,
    setKey: (k: string | null) => {
      apiKey = k;
    },
  };
}

function request(overrides: Partial<LlmTurnRequest> = {}): LlmTurnRequest {
  return {
    system: 'SYSTEM',
    messages: [{ role: 'user', content: 'היי' }],
    tools: [{ name: 'get_system_status', description: 'd', input_schema: { type: 'object', properties: {}, additionalProperties: false }, strict: true }],
    model: 'claude-opus-5-5',
    effort: 'low',
    signal: new AbortController().signal,
    timeoutMs: 60_000,
    ...overrides,
  };
}

const headers = new Headers();

describe('createAnthropicLlmClient (MOCK Anthropic client)', () => {
  it('sends the documented request shape: no thinking/temperature/tool_choice, cached system, effort, server fallback (mock)', async () => {
    const t = setup();
    t.mock.create.mockResolvedValue(mockMessage([thinkingBlock(), textBlock('שלום')], 'end_turn'));
    const req = request();
    const res = await t.llm.runTurn(req);
    expect(res.stop_reason).toBe('end_turn');

    const [params, options] = t.mock.create.mock.calls[0]!;
    expect(params).toEqual({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      system: [{ type: 'text', text: 'SYSTEM', cache_control: { type: 'ephemeral' } }],
      tools: req.tools,
      messages: req.messages,
      output_config: { effort: 'low' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
    for (const forbidden of ['thinking', 'temperature', 'top_p', 'top_k', 'tool_choice']) expect(params).not.toHaveProperty(forbidden);
    expect(options).toEqual({ signal: req.signal, timeout: 60_000, maxRetries: 2 });
  });

  it('server-side fallback only for the supported models (mock)', async () => {
    expect(['claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5', 'claude-fable-5-1'].every(supportsServerFallback)).toBe(true);
    expect(supportsServerFallback('claude-haiku-4-5')).toBe(false);
    const t = setup();
    t.mock.create.mockResolvedValue(mockMessage([textBlock('x')], 'end_turn'));
    await t.llm.runTurn(request({ model: 'claude-haiku-4-5' }));
    const [params] = t.mock.create.mock.calls[0]!;
    expect(params).not.toHaveProperty('betas');
    expect(params).not.toHaveProperty('fallbacks');
  });

  it('records usage (provider anthropic, kind llm, total input incl. cache) (mock)', async () => {
    const t = setup();
    t.mock.create.mockResolvedValue(mockMessage([textBlock('x')], 'end_turn'));
    await t.llm.runTurn(request());
    expect(t.db.usageEntries).toEqual([
      { provider: 'anthropic', kind: 'llm', model: 'claude-opus-5-5', inputTokens: 112, outputTokens: 7, createdAt: '2026-10-05T17:15:00.000Z' },
    ]);
  });

  it('missing key -> MISSING_API_KEY without calling the SDK (mock)', async () => {
    const t = setup(null);
    expect(t.llm.isConfigured()).toBe(false);
    await expect(t.llm.runTurn(request())).rejects.toMatchObject({ code: 'MISSING_API_KEY', retryable: false });
    await expect(t.llm.ping(new AbortController().signal)).rejects.toMatchObject({ code: 'MISSING_API_KEY' });
    expect(t.createClient).not.toHaveBeenCalled();
  });

  it('caches the SDK client per key and recreates it when the key changes (mock)', async () => {
    const t = setup();
    t.mock.create.mockResolvedValue(mockMessage([textBlock('x')], 'end_turn'));
    await t.llm.runTurn(request());
    await t.llm.runTurn(request());
    expect(t.createClient).toHaveBeenCalledTimes(1);
    t.setKey('sk-ant-api03-OTHER-KEY-000000000000');
    await t.llm.runTurn(request());
    expect(t.createClient).toHaveBeenCalledTimes(2);
    expect(t.createClient.mock.calls[1]).toEqual(['sk-ant-api03-OTHER-KEY-000000000000']);
  });

  it('ping uses models.retrieve (no token cost) with the requested model (mock)', async () => {
    const t = setup();
    const signal = new AbortController().signal;
    await t.llm.ping(signal);
    expect(t.mock.retrieve).toHaveBeenCalledWith('claude-opus-5-5', {}, expect.objectContaining({ signal }));
    await t.llm.ping(signal, 'claude-sonnet-5-5');
    expect(t.mock.retrieve.mock.calls[1]![0]).toBe('claude-sonnet-5-5');
    expect(t.mock.create).not.toHaveBeenCalled();
    t.mock.retrieve.mockRejectedValueOnce(new Anthropic.AuthenticationError(401, { type: 'error' }, 'invalid x-api-key', headers));
    await expect(t.llm.ping(signal)).rejects.toMatchObject({ code: 'INVALID_API_KEY' });
  });

  it('maps SDK errors (most specific first) to ProviderError with Hebrew messages (mock)', async () => {
    const cases: Array<[unknown, string, boolean]> = [
      [new Anthropic.AuthenticationError(401, { type: 'error' }, 'invalid x-api-key', headers), 'INVALID_API_KEY', false],
      [new Anthropic.PermissionDeniedError(403, { type: 'error' }, 'forbidden', headers), 'PERMISSION_DENIED', false],
      [new Anthropic.RateLimitError(429, { type: 'error' }, 'rate', headers), 'RATE_LIMITED', true],
      [new Anthropic.InternalServerError(500, { type: 'error' }, 'oops', headers), 'PROVIDER_UNAVAILABLE', true],
      [Anthropic.APIError.generate(529, { type: 'error', error: { type: 'overloaded_error' } }, 'overloaded', headers), 'PROVIDER_UNAVAILABLE', true],
      [new Anthropic.APIError(503, { type: 'error' }, 'unavailable', headers), 'PROVIDER_UNAVAILABLE', true],
      [new Anthropic.APIConnectionTimeoutError(), 'TIMEOUT', true],
      [new Anthropic.APIConnectionError({ message: 'ECONNRESET' }), 'NETWORK', true],
      [new Anthropic.APIUserAbortError(), 'CANCELLED', false],
      [new Anthropic.BadRequestError(400, { type: 'error' }, 'bad', headers), 'PROVIDER_ERROR', false],
      [new Anthropic.NotFoundError(404, { type: 'error' }, 'model not found', headers), 'PROVIDER_ERROR', false],
      [new Error('weird'), 'PROVIDER_ERROR', false],
    ];
    for (const [err, code, retryable] of cases) {
      const t = setup();
      t.mock.create.mockRejectedValue(err);
      const failure = await t.llm.runTurn(request()).then(
        () => null,
        (e: unknown) => e,
      );
      expect(failure, String(code)).toBeInstanceOf(ProviderError);
      expect(failure).toMatchObject({ code, retryable });
      expect((failure as ProviderError).message_he).toMatch(/[א-ת]/);
      expect(JSON.stringify(t.logger.records)).not.toContain(KEY);
    }
    const mapped = mapAnthropicError(new Anthropic.AuthenticationError(401, { type: 'error' }, 'x', headers));
    expect(mapped.message_he).toBe('מפתח ה-API של Claude לא תקין. עדכן אותו בהגדרות ← מוח.');
  });

  it('an aborted signal surfaces as CANCELLED (mock)', async () => {
    const t = setup();
    const controller = new AbortController();
    t.mock.create.mockImplementation(
      (_params, options) =>
        new Promise((_resolve, reject) => {
          (options.signal as AbortSignal).addEventListener('abort', () => reject(new Anthropic.APIUserAbortError()));
        }),
    );
    const pending = t.llm.runTurn(request({ signal: controller.signal }));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
  });
});

describe('createAnthropicVisionAnalyzer (MOCK Anthropic client)', () => {
  const image: CapturedImage = {
    data: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    mediaType: 'image/png',
    width: 1920,
    height: 1080,
    display: mockDisplay('1', true),
  };

  function setupVision() {
    const mock = createMockAnthropic();
    const db = createMockDatabase();
    const analyzer = createAnthropicVisionAnalyzer({
      getApiKey: () => KEY,
      getModel: () => 'claude-opus-5-5',
      logger: createMockLogger(),
      usage: db.usage,
      clock: createMockClock(),
      createClient: () => mock.client,
    });
    return { mock, db, analyzer };
  }

  it('sends a separate call with no tools: image first, then the question; effort medium (mock)', async () => {
    const t = setupVision();
    t.mock.create.mockResolvedValue(mockMessage([thinkingBlock(), textBlock('מה רואים בוודאות: חלון EPLAN.')], 'end_turn'));
    const text = await t.analyzer.analyze({ image, question: 'מה לא בסדר?', signal: new AbortController().signal });
    expect(text).toBe('מה רואים בוודאות: חלון EPLAN.');
    const [params] = t.mock.create.mock.calls[0]!;
    expect(params).not.toHaveProperty('tools');
    expect(params).not.toHaveProperty('thinking');
    expect(params).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      output_config: { effort: 'medium' },
      system: [{ type: 'text', text: VISION_SYSTEM_PROMPT }],
    });
    const content = (params.messages as Array<{ content: Array<Record<string, unknown>> }>)[0]!.content;
    expect(content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: image.data.toString('base64') } });
    expect(content[1]).toEqual({ type: 'text', text: 'מה לא בסדר?' });
    expect(t.db.usageEntries[0]).toMatchObject({ provider: 'anthropic', kind: 'vision' });
  });

  it('the vision system prompt enforces structure, untrusted on-screen text, no definite faults, no identification', () => {
    for (const fragment of ['מה רואים בוודאות', 'השערות (לא ודאי)', 'מה כדאי לבדוק', 'untrusted', 'ignored', 'EPLAN', 'definite electrical fault', 'do not identify people', 'Hebrew']) {
      expect(VISION_SYSTEM_PROMPT).toContain(fragment);
    }
  });

  it('refusal -> ProviderError REFUSAL; empty text -> PROVIDER_ERROR (mock)', async () => {
    const t = setupVision();
    t.mock.create.mockResolvedValueOnce(mockMessage([], 'refusal'));
    await expect(t.analyzer.analyze({ image, question: 'x', signal: new AbortController().signal })).rejects.toMatchObject({ code: 'REFUSAL' });
    t.mock.create.mockResolvedValueOnce(mockMessage([thinkingBlock()], 'end_turn'));
    await expect(t.analyzer.analyze({ image, question: 'x', signal: new AbortController().signal })).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
  });
});

import { describe, expect, it, vi } from 'vitest';
import { createVoiceService, looksLikeWav, vocabularyFrom } from '../../../src/main/voice/voice-service';
import { isHintsRejection, sanitizeKeywords, supportsLanguageHints } from '../../../src/main/voice/stt-providers';
import { IPC_REQUEST_SCHEMAS, TranscribeRequestSchema, VoiceCancelSchema } from '../../../src/shared/ipc-schemas';
import { IPC } from '../../../src/shared/ipc-channels';
import { buildAzureSsml, escapeXml, ssmlRate } from '../../../src/main/voice/tts-providers';
import { silentLogger } from '../../../src/main/app/logger';
import { defaultSettings, type SecretName, type Settings } from '../../../src/shared/settings-schema';
import type { SecretService, UsageEntry, UsageRepository } from '../../../src/main/core/contracts';

/** WAV מינימלי תקין (44 בתים כותרת + מעט דגימות). */
function wav(): Uint8Array {
  const b = new Uint8Array(44 + 32);
  b.set([...'RIFF'].map((c) => c.charCodeAt(0)), 0);
  b.set([...'WAVE'].map((c) => c.charCodeAt(0)), 8);
  return b;
}

function mockSecrets(values: Partial<Record<SecretName, string>>): SecretService {
  return {
    get: (n) => values[n] ?? null,
    set: () => undefined,
    clear: () => undefined,
    status: () => ({ secureStorageAvailable: true, entries: [] }),
  };
}

function mockUsage(): UsageRepository & { entries: UsageEntry[] } {
  const entries: UsageEntry[] = [];
  return { entries, record: (e) => entries.push(e), summary: () => [], clear: () => undefined };
}

interface Captured {
  url: string;
  init: RequestInit;
}

function mockFetch(responses: Array<Response | Error>): { fetchImpl: (u: string, i?: RequestInit) => Promise<Response>; calls: Captured[] } {
  const calls: Captured[] = [];
  return {
    calls,
    fetchImpl: async (url, init) => {
      calls.push({ url, init: init ?? {} });
      const next = responses.shift();
      if (!next) throw new Error('no more mock responses');
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

function settingsWith(mut: (s: Settings) => void): Settings {
  const s = defaultSettings();
  mut(s);
  return s;
}

const clock = { now: () => new Date('2026-10-05T17:00:00Z') };

describe('STT helpers', () => {
  it('sanitizes keywords per the OpenAI rules (single line, no angle brackets, de-duplicated)', () => {
    expect(sanitizeKeywords(['EPLAN', 'eplan', 'Spo<ti>fy', 'a\nb', '  '])).toEqual(['EPLAN', 'Spo ti fy', 'a b']);
  });
  it('only gpt-transcribe gets languages/keywords hints', () => {
    expect(supportsLanguageHints('gpt-transcribe')).toBe(true);
    expect(supportsLanguageHints('gpt-4o-transcribe')).toBe(false);
    expect(supportsLanguageHints('whisper-1')).toBe(false);
  });
  it('builds a Latin-script vocabulary from configured apps', () => {
    const v = vocabularyFrom(defaultSettings());
    expect(v).toContain('EPLAN');
    expect(v).toContain('Spotify');
    expect(v.every((w) => /[A-Za-z]/.test(w))).toBe(true);
  });
  it('recognizes WAV headers', () => {
    expect(looksLikeWav(wav())).toBe(true);
    expect(looksLikeWav(new Uint8Array(100))).toBe(false);
  });
});

describe('voice service — STT (mock HTTP)', () => {
  it('OpenAI gpt-transcribe: multipart with languages he+en, keywords, bearer key, and records usage', async () => {
    const { fetchImpl, calls } = mockFetch([new Response(JSON.stringify({ text: 'תפתח EPLAN' }), { status: 200 })]);
    const usage = mockUsage();
    const svc = createVoiceService({
      getSettings: () => defaultSettings(),
      secrets: mockSecrets({ openaiApiKey: 'sk-test-openai-1234567' }),
      usage,
      logger: silentLogger,
      clock,
      fetchImpl,
    });
    const res = await svc.transcribe({ audio: wav(), mimeType: 'audio/wav', durationMs: 2400 });
    expect(res).toEqual({ ok: true, text: 'תפתח EPLAN', provider: 'openai', durationMs: 2400 });
    expect(calls[0]!.url).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test-openai-1234567');
    const form = calls[0]!.init.body as FormData;
    expect(form.get('model')).toBe('gpt-transcribe');
    expect(form.getAll('languages[]')).toEqual(['he', 'en']);
    expect(form.getAll('keywords[]')).toContain('EPLAN');
    expect(form.get('language')).toBeNull();
    expect(usage.entries[0]).toMatchObject({ provider: 'openai', kind: 'stt', audioSeconds: 2.4 });
  });

  it('retries once without hints when the server rejects languages/keywords (400)', async () => {
    const { fetchImpl, calls } = mockFetch([
      new Response('{"error":"unknown parameter"}', { status: 400 }),
      new Response(JSON.stringify({ text: 'מצב מערכת' }), { status: 200 }),
    ]);
    const svc = createVoiceService({
      getSettings: () => defaultSettings(),
      secrets: mockSecrets({ openaiApiKey: 'sk-test-openai-1234567' }),
      usage: mockUsage(),
      logger: silentLogger,
      clock,
      fetchImpl,
    });
    const res = await svc.transcribe({ audio: wav(), mimeType: 'audio/wav', durationMs: 1500 });
    expect(res.ok).toBe(true);
    const second = calls[1]!.init.body as FormData;
    expect(second.get('language')).toBe('he');
    expect(second.getAll('languages[]')).toEqual([]);
  });

  it('missing key -> MISSING_API_KEY without any network call', async () => {
    const { fetchImpl, calls } = mockFetch([]);
    const svc = createVoiceService({ getSettings: () => defaultSettings(), secrets: mockSecrets({}), usage: mockUsage(), logger: silentLogger, clock, fetchImpl });
    const res = await svc.transcribe({ audio: wav(), mimeType: 'audio/wav', durationMs: 1500 });
    expect(res).toMatchObject({ ok: false, code: 'MISSING_API_KEY' });
    expect(calls).toHaveLength(0);
  });

  it('maps 401 / 429 / 503 / network failure to Hebrew errors', async () => {
    const cases: Array<[Response | Error, string]> = [
      [new Response('', { status: 401 }), 'INVALID_API_KEY'],
      [new Response('', { status: 429 }), 'RATE_LIMITED'],
      [new Response('', { status: 503 }), 'PROVIDER_UNAVAILABLE'],
      [new TypeError('fetch failed'), 'NETWORK'],
    ];
    for (const [response, code] of cases) {
      const { fetchImpl } = mockFetch([response]);
      const svc = createVoiceService({
        getSettings: () => defaultSettings(),
        secrets: mockSecrets({ openaiApiKey: 'sk-test-openai-1234567' }),
        usage: mockUsage(),
        logger: silentLogger,
        clock,
        fetchImpl,
      });
      const res = await svc.transcribe({ audio: wav(), mimeType: 'audio/wav', durationMs: 1000 });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe(code);
        expect(res.message_he).toMatch(/[֐-׿]/);
      }
    }
  });

  it('local OpenAI-compatible server: no key needed, language=he, custom base URL', async () => {
    const { fetchImpl, calls } = mockFetch([new Response(JSON.stringify({ text: 'בדיקה' }), { status: 200 })]);
    const s = settingsWith((x) => {
      x.stt.provider = 'local-openai-compatible';
      x.stt.localBaseUrl = 'http://127.0.0.1:8000/v1/';
      x.stt.localModel = 'ivrit-ai/whisper-large-v3-turbo-ct2';
    });
    const svc = createVoiceService({ getSettings: () => s, secrets: mockSecrets({}), usage: mockUsage(), logger: silentLogger, clock, fetchImpl });
    const res = await svc.transcribe({ audio: wav(), mimeType: 'audio/wav', durationMs: 1000 });
    expect(res.ok).toBe(true);
    expect(calls[0]!.url).toBe('http://127.0.0.1:8000/v1/audio/transcriptions');
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect((calls[0]!.init.body as FormData).get('language')).toBe('he');
  });

  it('Azure short-audio REST: he-IL, WAV content type, NoMatch -> empty transcript', async () => {
    const { fetchImpl, calls } = mockFetch([new Response(JSON.stringify({ RecognitionStatus: 'NoMatch' }), { status: 200 })]);
    const s = settingsWith((x) => {
      x.stt.provider = 'azure';
      x.azure.region = 'westeurope';
    });
    const svc = createVoiceService({ getSettings: () => s, secrets: mockSecrets({ azureSpeechKey: 'azure-key-123456' }), usage: mockUsage(), logger: silentLogger, clock, fetchImpl });
    const res = await svc.transcribe({ audio: wav(), mimeType: 'audio/wav', durationMs: 1000 });
    expect(res).toMatchObject({ ok: false, code: 'EMPTY_TRANSCRIPT' });
    expect(calls[0]!.url).toContain('https://westeurope.stt.speech.microsoft.com/');
    expect(calls[0]!.url).toContain('language=he-IL');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers['Ocp-Apim-Subscription-Key']).toBe('azure-key-123456');
    expect(headers['Content-Type']).toBe('audio/wav; codecs=audio/pcm; samplerate=16000');
  });

  it('rejects non-WAV audio before contacting any provider', async () => {
    const fetchImpl = vi.fn();
    const svc = createVoiceService({
      getSettings: () => defaultSettings(),
      secrets: mockSecrets({ openaiApiKey: 'sk-test-openai-1234567' }),
      usage: mockUsage(),
      logger: silentLogger,
      clock,
      fetchImpl,
    });
    const res = await svc.transcribe({ audio: new Uint8Array(100), mimeType: 'audio/wav', durationMs: 1000 });
    expect(res).toMatchObject({ ok: false, code: 'AUDIO_INVALID' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('voice service — TTS (mock HTTP)', () => {
  it('escapes SSML and converts rate', () => {
    expect(escapeXml(`<a&b>"'`)).toBe('&lt;a&amp;b&gt;&quot;&apos;');
    expect(ssmlRate(1)).toBe('+0%');
    expect(ssmlRate(1.25)).toBe('+25%');
    expect(ssmlRate(0.8)).toBe('-20%');
    const ssml = buildAzureSsml('שלום <script>', 'he-IL-AvriNeural', 1);
    expect(ssml).toContain('xml:lang="he-IL"');
    expect(ssml).toContain('<voice name="he-IL-AvriNeural">');
    expect(ssml).toContain('שלום &lt;script&gt;');
  });

  it('Azure: correct endpoint, headers, mp3 output and usage in characters', async () => {
    const mp3 = new Uint8Array([0xff, 0xf3, 1, 2, 3]);
    const { fetchImpl, calls } = mockFetch([new Response(mp3, { status: 200 })]);
    const usage = mockUsage();
    const s = settingsWith((x) => {
      x.tts.provider = 'azure';
      x.azure.region = 'westeurope';
    });
    const svc = createVoiceService({ getSettings: () => s, secrets: mockSecrets({ azureSpeechKey: 'azure-key-123456' }), usage, logger: silentLogger, clock, fetchImpl });
    const res = await svc.synthesize({ text: 'פתחתי את EPLAN.' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(Array.from(res.audio)).toEqual(Array.from(mp3));
    expect(calls[0]!.url).toBe('https://westeurope.tts.speech.microsoft.com/cognitiveservices/v1');
    const h = calls[0]!.init.headers as Record<string, string>;
    expect(h['X-Microsoft-OutputFormat']).toBe('audio-24khz-48kbitrate-mono-mp3');
    expect(h['Content-Type']).toBe('application/ssml+xml');
    expect(h['User-Agent']).toBe('JARVIS-Desktop');
    expect(usage.entries[0]).toMatchObject({ kind: 'tts', characters: 'פתחתי את EPLAN.'.length });
  });

  it('system voice is handled by the renderer, not by main', async () => {
    const fetchImpl = vi.fn();
    const svc = createVoiceService({ getSettings: () => defaultSettings(), secrets: mockSecrets({}), usage: mockUsage(), logger: silentLogger, clock, fetchImpl });
    const res = await svc.synthesize({ text: 'שלום' });
    expect(res).toMatchObject({ ok: false, code: 'NOT_CONFIGURED' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('OpenAI TTS: JSON body with Hebrew instructions for gpt-4o-mini-tts', async () => {
    const { fetchImpl, calls } = mockFetch([new Response(new Uint8Array([1, 2, 3]), { status: 200 })]);
    const s = settingsWith((x) => {
      x.tts.provider = 'openai';
    });
    const svc = createVoiceService({ getSettings: () => s, secrets: mockSecrets({ openaiApiKey: 'sk-test-openai-1234567' }), usage: mockUsage(), logger: silentLogger, clock, fetchImpl });
    const res = await svc.synthesize({ text: 'שלום אורי' });
    expect(res.ok).toBe(true);
    const body = JSON.parse(String(calls[0]!.init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ model: 'gpt-4o-mini-tts', input: 'שלום אורי', response_format: 'mp3' });
    expect(String(body.instructions)).toMatch(/Hebrew/);
  });

  it('reports configured statuses without network calls', () => {
    const fetchImpl = vi.fn();
    const svc = createVoiceService({ getSettings: () => defaultSettings(), secrets: mockSecrets({}), usage: mockUsage(), logger: silentLogger, clock, fetchImpl });
    const statuses = svc.configuredStatuses();
    expect(statuses.find((x) => x.service === 'stt')).toMatchObject({ provider: 'openai', configured: false, state: 'not_configured' });
    expect(statuses.find((x) => x.service === 'tts')).toMatchObject({ provider: 'system', configured: true, state: 'local' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('voice service — review fixes (mock HTTP)', () => {
  const openai = () => mockSecrets({ openaiApiKey: 'sk-test-openai-1234567' });

  it('retries without hints only when the 400 is about languages/keywords, not on every 400 (mock)', async () => {
    expect(isHintsRejection('{"error":{"message":"Unrecognized request argument supplied: languages"}}')).toBe(true);
    expect(isHintsRejection('{"error":{"param":"keywords","message":"invalid"}}')).toBe(true);
    expect(isHintsRejection('{"error":{"message":"Audio file might be corrupted or unsupported"}}')).toBe(false);
    const { fetchImpl, calls } = mockFetch([new Response('{"error":{"message":"Audio file might be corrupted"}}', { status: 400 })]);
    const svc = createVoiceService({ getSettings: () => defaultSettings(), secrets: openai(), usage: mockUsage(), logger: silentLogger, clock, fetchImpl });
    const res = await svc.transcribe({ audio: wav(), mimeType: 'audio/wav', durationMs: 1500 });
    expect(res).toMatchObject({ ok: false, code: 'PROVIDER_ERROR' });
    expect(calls).toHaveLength(1);
  });

  it('Azure BabbleTimeout is an empty transcript; an unknown status gets a Hebrew message (mock)', async () => {
    const s = settingsWith((x) => {
      x.stt.provider = 'azure';
      x.azure.region = 'westeurope';
    });
    for (const status of ['BabbleTimeout', 'InitialSilenceTimeout', 'NoMatch']) {
      const { fetchImpl } = mockFetch([new Response(JSON.stringify({ RecognitionStatus: status }), { status: 200 })]);
      const svc = createVoiceService({ getSettings: () => s, secrets: mockSecrets({ azureSpeechKey: 'azure-key-123456' }), usage: mockUsage(), logger: silentLogger, clock, fetchImpl });
      expect(await svc.transcribe({ audio: wav(), mimeType: 'audio/wav', durationMs: 1000 })).toMatchObject({ ok: false, code: 'EMPTY_TRANSCRIPT' });
    }
    const { fetchImpl } = mockFetch([new Response(JSON.stringify({ RecognitionStatus: 'Error' }), { status: 200 })]);
    const svc = createVoiceService({ getSettings: () => s, secrets: mockSecrets({ azureSpeechKey: 'azure-key-123456' }), usage: mockUsage(), logger: silentLogger, clock, fetchImpl });
    const res = await svc.transcribe({ audio: wav(), mimeType: 'audio/wav', durationMs: 1000 });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.message_he).toMatch(/^[^A-Za-z]*Azure Speech [א-ת]/);
      expect(res.message_he).not.toContain('Error');
    }
  });

  it('cancel(requestId) aborts an in-flight transcription; the service is not marked as failing (mock)', async () => {
    let seenSignal: AbortSignal | undefined;
    const fetchImpl = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        seenSignal = init?.signal ?? undefined;
        init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
    const usage = mockUsage();
    const svc = createVoiceService({ getSettings: () => defaultSettings(), secrets: openai(), usage, logger: silentLogger, clock, fetchImpl });
    const pending = svc.transcribe({ audio: wav(), mimeType: 'audio/wav', durationMs: 1500, requestId: 'req-1' });
    await Promise.resolve();
    expect(svc.cancel('req-1')).toBe(true);
    expect(seenSignal?.aborted).toBe(true);
    expect(await pending).toEqual({ ok: false, code: 'CANCELLED', message_he: 'הבקשה בוטלה.' });
    expect(usage.entries).toHaveLength(0);
    expect(svc.configuredStatuses().find((x) => x.service === 'stt')?.state).not.toBe('error');
    // ביטול של מזהה שכבר הסתיים — אין מה לבטל
    expect(svc.cancel('req-1')).toBe(false);
  });

  it('a cancel that arrives before its synthesis request still cancels it (mock)', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    });
    const s = settingsWith((x) => {
      x.tts.provider = 'azure';
    });
    const svc = createVoiceService({ getSettings: () => s, secrets: mockSecrets({ azureSpeechKey: 'azure-key-123456' }), usage: mockUsage(), logger: silentLogger, clock, fetchImpl });
    expect(svc.cancel('chunk-2')).toBe(false);
    expect(await svc.synthesize({ text: 'שלום', requestId: 'chunk-2' })).toMatchObject({ ok: false, code: 'CANCELLED' });
    expect(await svc.synthesize({ text: 'שלום', requestId: 'chunk-3' })).toMatchObject({ ok: true });
  });

  it('connection-test messages name the provider in Hebrew, not by its technical id (mock)', async () => {
    const s = settingsWith((x) => {
      x.stt.provider = 'local-openai-compatible';
      x.stt.localBaseUrl = 'http://127.0.0.1:8000/v1';
    });
    const { fetchImpl } = mockFetch([new TypeError('fetch failed')]);
    const svc = createVoiceService({ getSettings: () => s, secrets: mockSecrets({}), usage: mockUsage(), logger: silentLogger, clock, fetchImpl });
    const st = await svc.test('stt');
    expect(st.lastError_he).toContain('שרת התמלול המקומי');
    expect(st.lastError_he).not.toContain('local-openai-compatible');
  });

  it('SSML drops XML-illegal control characters (Azure would reject the request)', () => {
    const ssml = buildAzureSsml('שלום\u0007עולם\u001b\u000b\u0000', 'he-IL-AvriNeural', 1);
    // eslint-disable-next-line no-control-regex -- בודקים בדיוק את התווים האלה
    expect(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(ssml)).toBe(false);
    expect(ssml).toContain('שלוםעולם');
    expect(escapeXml('a\tb\nc\rd')).toBe('a\tb\nc\rd');
  });

  it('IPC schemas: requestId is a short safe token; voice:cancel requires one', () => {
    expect(TranscribeRequestSchema.safeParse({ audio: wav(), mimeType: 'audio/wav', durationMs: 1000, requestId: 'a1-b_2' }).success).toBe(true);
    expect(TranscribeRequestSchema.safeParse({ audio: wav(), mimeType: 'audio/wav', durationMs: 1000, requestId: 'bad id!' }).success).toBe(false);
    expect(TranscribeRequestSchema.safeParse({ audio: wav(), mimeType: 'audio/wav', durationMs: 1000, requestId: 'x'.repeat(65) }).success).toBe(false);
    expect(VoiceCancelSchema.safeParse({ requestId: 'r1' }).success).toBe(true);
    expect(VoiceCancelSchema.safeParse({}).success).toBe(false);
    expect(IPC_REQUEST_SCHEMAS[IPC.voiceCancel]).toBe(VoiceCancelSchema);
    // מילת הפעלה: stop/status דורשים מזהה סשן (UUID)
    const sid = '00000000-0000-4000-8000-000000000001';
    expect(IPC_REQUEST_SCHEMAS[IPC.wakewordStop].safeParse({ sessionId: sid }).success).toBe(true);
    expect(IPC_REQUEST_SCHEMAS[IPC.wakewordStop].safeParse({}).success).toBe(false);
    expect(IPC_REQUEST_SCHEMAS[IPC.wakewordStatus].safeParse({ sessionId: 'not-a-uuid' }).success).toBe(false);
  });
});

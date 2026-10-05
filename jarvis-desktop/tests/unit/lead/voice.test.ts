import { describe, expect, it, vi } from 'vitest';
import { createVoiceService, looksLikeWav, vocabularyFrom } from '../../../src/main/voice/voice-service';
import { sanitizeKeywords, supportsLanguageHints } from '../../../src/main/voice/stt-providers';
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

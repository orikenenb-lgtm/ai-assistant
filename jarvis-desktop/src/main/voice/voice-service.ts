import type { SynthesizeResult, TranscribeResult } from '../../shared/api-types';
import type { ServiceStatus } from '../../shared/types';
import type { Settings } from '../../shared/settings-schema';
import {
  ProviderError,
  type Clock,
  type Logger,
  type SecretService,
  type SttProvider,
  type TtsProvider,
  type UsageRepository,
} from '../core/contracts';
import { combineSignals, mapFetchError, type FetchLike } from './http';
import { createAzureStt, createOpenAiCompatibleStt } from './stt-providers';
import { createAzureTts, createOpenAiTts } from './tts-providers';

/**
 * שירות הקול ב-main: בוחר ספק לפי ההגדרות, מוסיף רמזי אוצר מילים (שמות תוכנות),
 * מתעד שימוש (שניות אודיו / תווים) ומחזיר תוצאות בפורמט Result ל-renderer.
 */

export interface VoiceService {
  transcribe(input: { audio: Uint8Array; mimeType: 'audio/wav'; durationMs: number }): Promise<TranscribeResult>;
  synthesize(input: { text: string }): Promise<SynthesizeResult>;
  test(service: 'stt' | 'tts'): Promise<ServiceStatus>;
  configuredStatuses(): ServiceStatus[];
}

export interface VoiceServiceDeps {
  getSettings: () => Settings;
  secrets: SecretService;
  usage: UsageRepository;
  logger: Logger;
  clock: Clock;
  fetchImpl?: FetchLike;
}

const OPENAI_BASE = 'https://api.openai.com/v1';

/** שמות תוכנות ופרויקטים בכתב לטיני — עוזר לתמלול "תפתח EPLAN" נכון. */
export function vocabularyFrom(settings: Settings): string[] {
  const words = ['JARVIS', 'EPLAN', 'Spotify'];
  for (const app of settings.launcher.apps) {
    if (!app.enabled) continue;
    words.push(app.name, ...app.aliases);
  }
  for (const p of settings.launcher.projects) if (p.enabled) words.push(p.name);
  // רק מילים שיש בהן אותיות לטיניות — עברית התמלול מבין ממילא
  return words.filter((w) => /[A-Za-z]/.test(w));
}

/** בדיקת תקינות בסיסית ל-WAV שמגיע מה-renderer (RIFF/WAVE, PCM). */
export function looksLikeWav(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 44) return false;
  const ascii = (o: number, n: number) => String.fromCharCode(...bytes.subarray(o, o + n));
  return ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WAVE';
}

export function createVoiceService(deps: VoiceServiceDeps): VoiceService {
  const fetchImpl: FetchLike = deps.fetchImpl ?? ((input, init) => fetch(input, init));
  const { logger, secrets } = deps;
  const lastStatus = new Map<'stt' | 'tts', ServiceStatus>();

  function sttProvider(s: Settings): SttProvider | null {
    switch (s.stt.provider) {
      case 'openai':
        return createOpenAiCompatibleStt({
          id: 'openai',
          label: 'OpenAI',
          baseUrl: OPENAI_BASE,
          model: s.stt.openaiModel,
          getApiKey: () => secrets.get('openaiApiKey'),
          requireKey: true,
          getKeywords: () => vocabularyFrom(s),
          fetchImpl,
          logger,
        });
      case 'local-openai-compatible':
        return createOpenAiCompatibleStt({
          id: 'local-openai-compatible',
          label: 'שרת התמלול המקומי',
          baseUrl: s.stt.localBaseUrl,
          model: s.stt.localModel || 'whisper-1',
          getApiKey: () => null,
          requireKey: false,
          getKeywords: () => vocabularyFrom(s),
          fetchImpl,
          logger,
        });
      case 'azure':
        return createAzureStt({ region: s.azure.region, getApiKey: () => secrets.get('azureSpeechKey'), fetchImpl, logger });
      case 'none':
        return null;
    }
  }

  function ttsProvider(s: Settings): TtsProvider | null {
    switch (s.tts.provider) {
      case 'azure':
        return createAzureTts({
          region: s.azure.region,
          voice: s.tts.azureVoice,
          rate: s.tts.rate,
          getApiKey: () => secrets.get('azureSpeechKey'),
          fetchImpl,
          logger,
        });
      case 'openai':
        return createOpenAiTts({
          model: s.tts.openaiModel,
          voice: s.tts.openaiVoice,
          getApiKey: () => secrets.get('openaiApiKey'),
          fetchImpl,
          logger,
        });
      case 'system':
      case 'none':
        return null;
    }
  }

  function remember(service: 'stt' | 'tts', provider: string, state: ServiceStatus['state'], error?: string): void {
    lastStatus.set(service, {
      service,
      provider,
      configured: state !== 'not_configured',
      state,
      lastCheckedAt: deps.clock.now().toISOString(),
      ...(error ? { lastError_he: error } : {}),
    });
  }

  return {
    async transcribe({ audio, durationMs }) {
      const s = deps.getSettings();
      const provider = sttProvider(s);
      if (!provider) {
        return { ok: false, code: 'NOT_CONFIGURED', message_he: 'תמלול לא מוגדר. בחר ספק תמלול בהגדרות ← קול.' };
      }
      if (!looksLikeWav(audio)) return { ok: false, code: 'AUDIO_INVALID', message_he: 'ההקלטה לא תקינה.' };
      const controller = new AbortController();
      try {
        const text = await provider.transcribe({
          wav: audio,
          durationMs,
          vocabularyHint: `JARVIS. ${vocabularyFrom(s).join(', ')}.`,
          signal: controller.signal,
        });
        deps.usage.record({
          provider: provider.id,
          kind: 'stt',
          model: provider.id === 'azure' ? 'azure-short-audio' : s.stt.provider === 'openai' ? s.stt.openaiModel : s.stt.localModel || 'local',
          audioSeconds: Math.round(durationMs / 100) / 10,
          createdAt: deps.clock.now().toISOString(),
        });
        remember('stt', provider.id, 'ok');
        logger.info('stt.done', { provider: provider.id, durationMs, chars: text.length });
        if (!text) return { ok: false, code: 'EMPTY_TRANSCRIPT', message_he: 'לא זוהה דיבור בהקלטה.' };
        return { ok: true, text, provider: provider.id, durationMs };
      } catch (err) {
        const pe = err instanceof ProviderError ? err : new ProviderError('INTERNAL', 'התמלול נכשל.', false, { cause: err });
        remember('stt', provider.id, pe.code === 'MISSING_API_KEY' ? 'not_configured' : 'error', pe.message_he);
        logger.warn('stt.failed', { provider: provider.id, code: pe.code });
        return { ok: false, code: pe.code, message_he: pe.message_he };
      }
    },

    async synthesize({ text }) {
      const s = deps.getSettings();
      const provider = ttsProvider(s);
      if (!provider) {
        return {
          ok: false,
          code: 'NOT_CONFIGURED',
          message_he: s.tts.provider === 'system' ? 'קול המערכת מופעל ישירות בממשק.' : 'הקראה כבויה בהגדרות.',
        };
      }
      const controller = new AbortController();
      try {
        const { audio, mimeType } = await provider.synthesize({ text, signal: controller.signal });
        deps.usage.record({
          provider: provider.id,
          kind: 'tts',
          model: provider.id === 'azure' ? s.tts.azureVoice : s.tts.openaiModel,
          characters: text.length,
          createdAt: deps.clock.now().toISOString(),
        });
        remember('tts', provider.id, 'ok');
        return { ok: true, audio, mimeType, provider: provider.id };
      } catch (err) {
        const pe = err instanceof ProviderError ? err : new ProviderError('INTERNAL', 'ההקראה נכשלה.', false, { cause: err });
        remember('tts', provider.id, pe.code === 'MISSING_API_KEY' ? 'not_configured' : 'error', pe.message_he);
        logger.warn('tts.failed', { provider: provider.id, code: pe.code });
        return { ok: false, code: pe.code, message_he: pe.message_he };
      }
    },

    async test(service) {
      const s = deps.getSettings();
      const now = deps.clock.now().toISOString();
      const providerId = service === 'stt' ? s.stt.provider : s.tts.provider;
      if (providerId === 'none') return { service, provider: 'none', configured: false, state: 'not_configured', lastCheckedAt: now };
      if (providerId === 'system') return { service, provider: 'system', configured: true, state: 'local', lastCheckedAt: now };

      // בדיקת חיבור והרשאה בלי לבזבז קרדיט: רשימת מודלים (OpenAI) / הנפקת טוקן (Azure) / זמינות השרת המקומי
      let url: string;
      let init: RequestInit;
      if (providerId === 'openai') {
        const key = secrets.get('openaiApiKey');
        if (!key) return { service, provider: 'openai', configured: false, state: 'not_configured', lastCheckedAt: now, lastError_he: 'אין מפתח OpenAI.' };
        url = `${OPENAI_BASE}/models`;
        init = { method: 'GET', headers: { Authorization: `Bearer ${key}` } };
      } else if (providerId === 'azure') {
        const key = secrets.get('azureSpeechKey');
        if (!key) return { service, provider: 'azure', configured: false, state: 'not_configured', lastCheckedAt: now, lastError_he: 'אין מפתח Azure Speech.' };
        url = `https://${s.azure.region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`;
        init = { method: 'POST', headers: { 'Ocp-Apim-Subscription-Key': key, 'Content-Length': '0' } };
      } else {
        url = `${s.stt.localBaseUrl.replace(/\/+$/, '')}/models`;
        init = { method: 'GET' };
      }
      const controller = new AbortController();
      const { signal, timedOut } = combineSignals(controller.signal, 10_000);
      try {
        const res = await fetchImpl(url, { ...init, signal });
        // לשרת מקומי מספיקה תשובת HTTP כלשהי (חלק מהשרתים לא מממשים /models)
        const ok = providerId === 'local-openai-compatible' ? res.status < 500 : res.ok;
        const status: ServiceStatus = ok
          ? { service, provider: providerId, configured: true, state: 'ok', lastCheckedAt: now }
          : {
              service,
              provider: providerId,
              configured: true,
              state: 'error',
              lastCheckedAt: now,
              lastError_he: res.status === 401 || res.status === 403 ? 'המפתח לא תקין.' : `השירות החזיר ${res.status}.`,
            };
        lastStatus.set(service, status);
        return status;
      } catch (err) {
        const pe = mapFetchError(err, timedOut(), providerId);
        const status: ServiceStatus = { service, provider: providerId, configured: true, state: 'error', lastCheckedAt: now, lastError_he: pe.message_he };
        lastStatus.set(service, status);
        return status;
      }
    },

    configuredStatuses() {
      const s = deps.getSettings();
      const out: ServiceStatus[] = [];
      for (const service of ['stt', 'tts'] as const) {
        const providerId = service === 'stt' ? s.stt.provider : s.tts.provider;
        const remembered = lastStatus.get(service);
        if (remembered && remembered.provider === providerId) {
          out.push(remembered);
          continue;
        }
        let configured: boolean;
        if (providerId === 'none') configured = false;
        else if (providerId === 'system' || providerId === 'local-openai-compatible') configured = true;
        else if (providerId === 'openai') configured = Boolean(secrets.get('openaiApiKey'));
        else configured = Boolean(secrets.get('azureSpeechKey'));
        out.push({
          service,
          provider: providerId,
          configured,
          state: !configured ? 'not_configured' : providerId === 'system' ? 'local' : 'unknown',
        });
      }
      return out;
    },
  };
}

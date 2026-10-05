import { ProviderError, type Logger, type TtsProvider } from '../core/contracts';
import { combineSignals, mapFetchError, mapHttpStatus, safeErrorSnippet, type FetchLike } from './http';

/**
 * ספקי הקראה (Text-to-Speech):
 * - Azure AI Speech: קולות עבריים טבעיים he-IL-AvriNeural (גבר) / he-IL-HilaNeural (אישה).
 *   REST: https://{region}.tts.speech.microsoft.com/cognitiveservices/v1 עם SSML.
 * - OpenAI: gpt-4o-mini-tts — עובד גם בעברית, אבל הקולות מותאמים לאנגלית (לפי התיעוד הרשמי), לכן לא ברירת מחדל.
 * - קול מערכת (Windows "Asaf") מטופל ב-renderer דרך speechSynthesis, ללא main.
 */

const TTS_TIMEOUT_MS = 30_000;

/** תווי בקרה שאסורים ב-XML 1.0 (Azure דוחה SSML איתם ב-400, והקראה נופלת לקול המערכת). */
// eslint-disable-next-line no-control-regex -- זה בדיוק מה שמסננים
const XML_ILLEGAL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

export function escapeXml(text: string): string {
  return text
    .replace(XML_ILLEGAL_CHARS, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** קצב הקראה כאחוז יחסי ל-SSML: 1.0 -> "+0%", 1.25 -> "+25%", 0.8 -> "-20%". */
export function ssmlRate(rate: number): string {
  const pct = Math.round((rate - 1) * 100);
  return `${pct >= 0 ? '+' : ''}${pct}%`;
}

export function buildAzureSsml(text: string, voice: string, rate: number): string {
  const lang = voice.slice(0, 5);
  return (
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${escapeXml(lang)}">` +
    `<voice name="${escapeXml(voice)}"><prosody rate="${ssmlRate(rate)}">${escapeXml(text)}</prosody></voice></speak>`
  );
}

export interface AzureTtsOptions {
  region: string;
  voice: string;
  rate: number;
  getApiKey: () => string | null;
  fetchImpl: FetchLike;
  logger: Logger;
}

export function createAzureTts(options: AzureTtsOptions): TtsProvider {
  return {
    id: 'azure',
    isConfigured: () => Boolean(options.getApiKey()),
    async synthesize({ text, signal }) {
      const key = options.getApiKey();
      if (!key) throw new ProviderError('MISSING_API_KEY', 'לא הוגדר מפתח Azure Speech. הוסף אותו בהגדרות ← קול.', false);
      const { signal: combined, timedOut } = combineSignals(signal, TTS_TIMEOUT_MS);
      let res: Response;
      try {
        res = await options.fetchImpl(`https://${options.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
          method: 'POST',
          headers: {
            'Ocp-Apim-Subscription-Key': key,
            'Content-Type': 'application/ssml+xml',
            'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
            'User-Agent': 'JARVIS-Desktop',
          },
          body: buildAzureSsml(text, options.voice, options.rate),
          signal: combined,
        });
      } catch (err) {
        throw mapFetchError(err, timedOut(), 'Azure Speech');
      }
      if (!res.ok) {
        options.logger.warn('tts.http_error', { provider: 'azure', status: res.status, snippet: await safeErrorSnippet(res) });
        throw mapHttpStatus(res.status, 'Azure Speech');
      }
      const audio = new Uint8Array(await res.arrayBuffer());
      if (audio.byteLength === 0) throw new ProviderError('PROVIDER_ERROR', 'Azure Speech החזיר אודיו ריק.', true);
      return { audio, mimeType: 'audio/mpeg' };
    },
  };
}

export interface OpenAiTtsOptions {
  model: string;
  voice: string;
  getApiKey: () => string | null;
  fetchImpl: FetchLike;
  logger: Logger;
}

export function createOpenAiTts(options: OpenAiTtsOptions): TtsProvider {
  return {
    id: 'openai',
    isConfigured: () => Boolean(options.getApiKey()),
    async synthesize({ text, signal }) {
      const key = options.getApiKey();
      if (!key) throw new ProviderError('MISSING_API_KEY', 'לא הוגדר מפתח OpenAI. הוסף אותו בהגדרות ← קול.', false);
      const body: Record<string, unknown> = {
        model: options.model,
        voice: options.voice,
        input: text.slice(0, 4096),
        response_format: 'mp3',
      };
      // instructions נתמך רק במודלי gpt-4o-mini-tts (לא ב-tts-1/tts-1-hd)
      if (options.model.startsWith('gpt-')) {
        body.instructions = 'Speak natural, fluent Israeli Hebrew with a calm, confident, friendly tone. Pronounce English product names in English.';
      }
      const { signal: combined, timedOut } = combineSignals(signal, TTS_TIMEOUT_MS);
      let res: Response;
      try {
        res = await options.fetchImpl('https://api.openai.com/v1/audio/speech', {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: combined,
        });
      } catch (err) {
        throw mapFetchError(err, timedOut(), 'OpenAI');
      }
      if (!res.ok) {
        options.logger.warn('tts.http_error', { provider: 'openai', status: res.status, snippet: await safeErrorSnippet(res) });
        throw mapHttpStatus(res.status, 'OpenAI');
      }
      const audio = new Uint8Array(await res.arrayBuffer());
      if (audio.byteLength === 0) throw new ProviderError('PROVIDER_ERROR', 'OpenAI החזיר אודיו ריק.', true);
      return { audio, mimeType: 'audio/mpeg' };
    },
  };
}

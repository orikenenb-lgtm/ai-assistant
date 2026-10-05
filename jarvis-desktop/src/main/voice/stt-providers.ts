import { ProviderError, type Logger, type SttProvider } from '../core/contracts';
import { combineSignals, mapFetchError, mapHttpStatus, safeErrorSnippet, type FetchLike } from './http';

/**
 * ספקי תמלול (Speech-to-Text). כל השליחה מתבצעת מ-main בלבד; המפתחות לא מגיעים ל-renderer.
 *
 * 1) OpenAI (ענן) ושרת מקומי תואם OpenAI (speaches / whisper.cpp server) — אותו פרוטוקול:
 *    POST {baseUrl}/audio/transcriptions, multipart: file, model, ...
 *    - gpt-transcribe: שולחים languages=[he,en] ו-keywords (שמות תוכנות באנגלית), בלי language.
 *      (לפי מפרט ה-OpenAPI הרשמי ומדריך המעבר של OpenAI.)
 *    - מודלים אחרים (whisper-1 / gpt-4o-* / מודלים מקומיים): language=he + prompt עם אוצר מילים.
 * 2) Azure AI Speech — REST לקטעי אודיו קצרים (עד 60 שניות, WAV PCM 16kHz מונו), he-IL.
 */

const STT_TIMEOUT_MS = 30_000;
const AZURE_MAX_MS = 60_000;
/** סטטוסים של Azure שמשמעותם "לא נשמע דיבור" (תיעוד ה-REST לקטעים קצרים). */
const AZURE_EMPTY_STATUSES = new Set(['NoMatch', 'InitialSilenceTimeout', 'BabbleTimeout']);

/** ניקוי מילות מפתח לפי כללי OpenAI: שורה אחת, בלי < > ובלי ירידת שורה. */
export function sanitizeKeywords(words: string[], max = 30): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const w of words) {
    const clean = w.replace(/[<>\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 50);
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * האם שגיאת 400 במצב hints נובעת מהפרמטרים languages/keywords (שרת/מודל שלא מכיר אותם).
 * רק אז שווה לנסות שוב במצב רגיל — 400 מסיבה אחרת (למשל קובץ פגום) ייכשל שוב ויחויב פעמיים.
 */
export function isHintsRejection(body: string): boolean {
  return /\blanguages?\b|\bkeywords?\b|\bhints?\b|unknown[\s_-]*(parameter|param|field|argument)|unrecognized[\s_-]*(request[\s_-]*)?(parameter|param|field|argument)|extra[\s_-]*(fields?|inputs?)[\s_-]*not[\s_-]*permitted/i.test(
    body,
  );
}

export function supportsLanguageHints(model: string): boolean {
  return /^gpt-transcribe(\b|-)/.test(model) || model === 'gpt-transcribe';
}

export interface OpenAiSttOptions {
  id: 'openai' | 'local-openai-compatible';
  label: string;
  baseUrl: string;
  model: string;
  getApiKey: () => string | null;
  /** בשרת מקומי המפתח אופציונלי. */
  requireKey: boolean;
  getKeywords: () => string[];
  fetchImpl: FetchLike;
  logger: Logger;
}

export function createOpenAiCompatibleStt(options: OpenAiSttOptions): SttProvider {
  const url = `${options.baseUrl.replace(/\/+$/, '')}/audio/transcriptions`;

  async function request(wav: Uint8Array, mode: 'hints' | 'plain', vocabularyHint: string, signal: AbortSignal): Promise<string> {
    const apiKey = options.getApiKey();
    if (options.requireKey && !apiKey) {
      throw new ProviderError('MISSING_API_KEY', `לא הוגדר מפתח ${options.label}. הוסף אותו בהגדרות ← קול.`, false);
    }
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'speech.wav');
    form.append('model', options.model);
    form.append('response_format', 'json');
    if (mode === 'hints') {
      form.append('languages[]', 'he');
      form.append('languages[]', 'en');
      for (const k of sanitizeKeywords(options.getKeywords())) form.append('keywords[]', k);
    } else {
      form.append('language', 'he');
      if (vocabularyHint) form.append('prompt', vocabularyHint.slice(0, 400));
    }
    const { signal: combined, timedOut } = combineSignals(signal, STT_TIMEOUT_MS);
    let res: Response;
    try {
      res = await options.fetchImpl(url, {
        method: 'POST',
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        body: form,
        signal: combined,
      });
    } catch (err) {
      throw mapFetchError(err, timedOut(), options.label);
    }
    if (!res.ok) {
      const snippet = await safeErrorSnippet(res);
      options.logger.warn('stt.http_error', { provider: options.id, status: res.status, mode, snippet });
      const mapped = mapHttpStatus(res.status, options.label);
      // 400 במצב hints שמזכיר את languages/keywords (או פרמטר לא מוכר) — ננסה פעם אחת במצב רגיל
      if (res.status === 400 && mode === 'hints' && isHintsRejection(snippet)) throw Object.assign(mapped, { retryPlain: true });
      throw mapped;
    }
    const json = (await res.json().catch(() => null)) as { text?: unknown } | null;
    if (!json || typeof json.text !== 'string') {
      throw new ProviderError('PROVIDER_ERROR', `${options.label} החזיר תשובה לא צפויה.`, false);
    }
    return json.text.trim();
  }

  return {
    id: options.id,
    isConfigured: () => !options.requireKey || Boolean(options.getApiKey()),
    async transcribe({ wav, vocabularyHint, signal }) {
      const mode = supportsLanguageHints(options.model) ? 'hints' : 'plain';
      try {
        return await request(wav, mode, vocabularyHint, signal);
      } catch (err) {
        if (mode === 'hints' && err instanceof ProviderError && (err as ProviderError & { retryPlain?: boolean }).retryPlain) {
          return request(wav, 'plain', vocabularyHint, signal);
        }
        throw err;
      }
    },
  };
}

export interface AzureSttOptions {
  region: string;
  getApiKey: () => string | null;
  fetchImpl: FetchLike;
  logger: Logger;
}

export function createAzureStt(options: AzureSttOptions): SttProvider {
  return {
    id: 'azure',
    isConfigured: () => Boolean(options.getApiKey()),
    async transcribe({ wav, durationMs, signal }) {
      const key = options.getApiKey();
      if (!key) throw new ProviderError('MISSING_API_KEY', 'לא הוגדר מפתח Azure Speech. הוסף אותו בהגדרות ← קול.', false);
      if (durationMs > AZURE_MAX_MS) throw new ProviderError('AUDIO_INVALID', 'Azure מתמלל עד 60 שניות בבקשה אחת.', false);
      const url = `https://${options.region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=he-IL&format=simple`;
      const { signal: combined, timedOut } = combineSignals(signal, STT_TIMEOUT_MS);
      let res: Response;
      try {
        res = await options.fetchImpl(url, {
          method: 'POST',
          headers: {
            'Ocp-Apim-Subscription-Key': key,
            'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000',
            Accept: 'application/json',
          },
          body: new Uint8Array(wav),
          signal: combined,
        });
      } catch (err) {
        throw mapFetchError(err, timedOut(), 'Azure Speech');
      }
      if (!res.ok) {
        options.logger.warn('stt.http_error', { provider: 'azure', status: res.status, snippet: await safeErrorSnippet(res) });
        throw mapHttpStatus(res.status, 'Azure Speech');
      }
      const json = (await res.json().catch(() => null)) as { RecognitionStatus?: string; DisplayText?: string } | null;
      if (!json) throw new ProviderError('PROVIDER_ERROR', 'Azure Speech החזיר תשובה לא צפויה.', false);
      if (json.RecognitionStatus === 'Success') return (json.DisplayText ?? '').trim();
      // אין דיבור מזוהה (שקט / רעש רקע / דיבור לא ברור) — תמלול ריק, לא תקלה: הממשק מציג "לא זוהה דיבור"
      if (json.RecognitionStatus && AZURE_EMPTY_STATUSES.has(json.RecognitionStatus)) return '';
      // הסטטוס הטכני נשמר ביומן בלבד — ההודעה למשתמש בעברית
      options.logger.warn('stt.azure_status', { status: String(json.RecognitionStatus ?? 'missing').slice(0, 40) });
      throw new ProviderError('PROVIDER_ERROR', 'Azure Speech לא הצליח לתמלל את ההקלטה. נסה שוב.', false);
    },
  };
}

import { ProviderError } from '../core/contracts';

/**
 * עזרי HTTP משותפים לספקי הקול: timeout + ביטול, ומיפוי שגיאות לקודים ולהודעות בעברית.
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function combineSignals(signal: AbortSignal, timeoutMs: number): { signal: AbortSignal; timedOut: () => boolean } {
  const timeout = AbortSignal.timeout(timeoutMs);
  return { signal: AbortSignal.any([signal, timeout]), timedOut: () => timeout.aborted && !signal.aborted };
}

export function mapHttpStatus(status: number, providerLabel: string): ProviderError {
  if (status === 401 || status === 403) {
    return new ProviderError('INVALID_API_KEY', `המפתח של ${providerLabel} לא תקין או חסר הרשאה. עדכן אותו בהגדרות ← קול.`, false);
  }
  if (status === 429) return new ProviderError('RATE_LIMITED', `${providerLabel} עמוס או שהגעת למכסה. נסה שוב בעוד רגע.`, true);
  if (status >= 500) return new ProviderError('PROVIDER_UNAVAILABLE', `${providerLabel} לא זמין כרגע. נסה שוב בעוד רגע.`, true);
  if (status === 413) return new ProviderError('AUDIO_INVALID', 'ההקלטה ארוכה מדי לשירות.', false);
  return new ProviderError('PROVIDER_ERROR', `${providerLabel} החזיר שגיאה (${status}).`, false);
}

export function mapFetchError(err: unknown, timedOut: boolean, providerLabel: string): ProviderError {
  if (err instanceof ProviderError) return err;
  if (timedOut) return new ProviderError('TIMEOUT', `${providerLabel} לא הגיב בזמן.`, true, { cause: err });
  if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
    return new ProviderError('CANCELLED', 'הבקשה בוטלה.', false, { cause: err });
  }
  return new ProviderError('NETWORK', `אין חיבור ל-${providerLabel}. בדוק את החיבור לאינטרנט.`, true, { cause: err });
}

/** קורא גוף שגיאה קצר ללוג בלבד (בלי להחזיר אותו למשתמש). */
export async function safeErrorSnippet(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text.slice(0, 300);
  } catch {
    return '';
  }
}

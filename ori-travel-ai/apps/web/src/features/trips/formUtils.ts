import { isApiError } from '@/lib/api';

/** Field-level server errors (422) → lookup by field name; matches dotted suffixes ("body.title" → "title"). */
export function serverFieldErrors(error: unknown): Record<string, string> {
  if (!isApiError(error)) return {};
  const raw = error.fieldErrors();
  const out: Record<string, string> = {};
  for (const [key, message] of Object.entries(raw)) {
    out[key] = message;
    const last = key.split('.').pop();
    if (last && !(last in out)) out[last] = message;
  }
  return out;
}

/** General (non-field) message for a failed submit, or null if field errors explain it. */
export function submitErrorMessage(error: unknown): string | null {
  if (!error) return null;
  if (isApiError(error)) {
    if (error.status === 422 && Object.keys(error.fieldErrors()).length > 0) return 'חלק מהשדות אינם תקינים. תקנו ונסו שוב.';
    return error.message;
  }
  return 'אירעה שגיאה בלתי צפויה. נסו שוב.';
}

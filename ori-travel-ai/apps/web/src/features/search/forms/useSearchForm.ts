import { useCallback, useMemo, useState } from 'react';
import type { FieldErrors, ValidationResult } from './common';

/**
 * Form state + validation lifecycle shared by the four search forms.
 * - Nothing is shown until the first submit attempt.
 * - After that, errors follow the current values live (client rules mirrored from the backend).
 * - Server 422 errors are shown until the user changes something.
 */
export function useSearchForm<S>(
  initial: S,
  validate: (s: S) => ValidationResult<Record<string, unknown>>,
  serverErrors: FieldErrors,
  onValid: (body: Record<string, unknown>) => void,
) {
  const [state, setState] = useState<S>(initial);
  const [submitted, setSubmitted] = useState(false);
  const [dirty, setDirty] = useState(false);

  const update = useCallback((patch: Partial<S>) => {
    setState((s) => ({ ...s, ...patch }));
    setDirty(true);
  }, []);

  const live = useMemo(() => validate(state), [validate, state]);
  const clientErrors: FieldErrors = live.ok ? {} : live.errors;
  const errors: FieldErrors = !submitted ? {} : dirty ? clientErrors : { ...clientErrors, ...serverErrors };

  const submit = useCallback(() => {
    setSubmitted(true);
    setDirty(false);
    if (live.ok) onValid(live.body);
  }, [live, onValid]);

  return { state, update, errors, submit };
}

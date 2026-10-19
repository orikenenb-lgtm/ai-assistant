"use client";

import { useCallback, useState, useTransition } from "react";
import { toast } from "sonner";
import type { ActionError, ActionResult } from "@/server/action";

type Options<O> = {
  onSuccess?: (data: O) => void;
  successMessage?: string;
  /** Show a toast for errors (default true). Field errors still render inline. */
  toastErrors?: boolean;
};

/** Calls a server action, tracking pending state and errors for the form UI. */
export function useServerAction<I, O>(action: (input: I) => Promise<ActionResult<O>>, opts: Options<O> = {}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<ActionError | null>(null);

  const run = useCallback(
    (input: I) =>
      new Promise<ActionResult<O>>((resolve) => {
        startTransition(async () => {
          let result: ActionResult<O>;
          try {
            result = await action(input);
          } catch {
            result = { ok: false, error: { code: "INTERNAL", message: "Network error" } };
          }
          if (result.ok) {
            setError(null);
            if (opts.successMessage) toast.success(opts.successMessage);
            opts.onSuccess?.(result.data);
          } else {
            setError(result.error);
            if (opts.toastErrors !== false && !result.error.fieldErrors) toast.error(result.error.message);
          }
          resolve(result);
        });
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [action, opts.successMessage, opts.toastErrors],
  );

  return { run, pending, error, fieldErrors: error?.fieldErrors ?? {}, reset: () => setError(null) };
}

export function formToObject(form: HTMLFormElement): Record<string, string> {
  const out: Record<string, string> = {};
  new FormData(form).forEach((v, k) => {
    if (typeof v === "string") out[k] = v;
  });
  return out;
}

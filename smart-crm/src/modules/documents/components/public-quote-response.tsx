"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Alert } from "@/components/ui/primitives";
import { recordQuoteViewAction, respondToQuoteAction } from "../actions";

/** Counts a customer view once per page load. Runs client-side so link-preview bots don't count. */
export function QuoteViewBeacon({ token }: { token: string }) {
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    void recordQuoteViewAction({ token });
  }, [token]);
  return null;
}

export type PublicResponseLabels = {
  title: string;
  body: string;
  name: string;
  note: string;
  accept: string;
  reject: string;
  thanks: string;
  nameInvalid: string;
  rateLimited: string;
  error: string;
};

/**
 * Accept/reject form on the public quote page. Labels come from the server in the
 * quote's language (not the visitor's UI locale), so errors are mapped here too.
 */
export function PublicQuoteResponse({ token, labels, dir }: { token: string; labels: PublicResponseLabels; dir: "rtl" | "ltr" }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<"accepted" | "rejected" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (decision: "accepted" | "rejected") => {
    setError(null);
    setNameError(null);
    if (name.trim().length < 2) return setNameError(labels.nameInvalid);
    setPending(decision);
    try {
      const res = await respondToQuoteAction({ token, decision, name: name.trim(), note: note.trim() || null });
      if (res.ok) {
        setDone(true);
        router.refresh();
        return;
      }
      if (res.error.fieldErrors?.name) setNameError(labels.nameInvalid);
      else if (res.error.code === "CONFLICT" || res.error.code === "NOT_FOUND") router.refresh();
      else setError(res.error.code === "RATE_LIMITED" ? labels.rateLimited : labels.error);
    } catch {
      setError(labels.error);
    } finally {
      setPending(null);
    }
  };

  if (done) return <Alert tone="success">{labels.thanks}</Alert>;

  return (
    <form
      noValidate
      dir={dir}
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit("accepted");
      }}
    >
      <div>
        <h2 className="text-lg font-semibold">{labels.title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{labels.body}</p>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      <Field label={labels.name} htmlFor="signer-name" error={nameError} required>
        <Input id="signer-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={120} dir="auto" />
      </Field>
      <Field label={labels.note} htmlFor="signer-note">
        <Textarea id="signer-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={1000} dir="auto" />
      </Field>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="submit" size="lg" className="sm:flex-1" loading={pending === "accepted"} disabled={pending !== null} data-testid="quote-accept">
          <Check /> {labels.accept}
        </Button>
        <Button type="button" variant="secondary" size="lg" loading={pending === "rejected"} disabled={pending !== null} onClick={() => void submit("rejected")}>
          <X /> {labels.reject}
        </Button>
      </div>
    </form>
  );
}

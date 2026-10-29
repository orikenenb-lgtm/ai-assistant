"use client";

import { CheckCircle2, Loader2, Send } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { clsx } from "clsx";
import { contact, whatsappLink } from "@/config/site";
import { CALLBACK_LABELS, CALLBACK_WINDOWS } from "@/lib/lead-constants";
import { parsePhone } from "@/lib/phone";
import { buttonClass } from "@/components/ui/Button";

type Errors = Partial<Record<"name" | "phone" | "business" | "message" | "form", string>>;
type Status = "idle" | "submitting" | "success" | "error";

function Field({
  label,
  error,
  required,
  children,
  hint,
  id,
}: {
  label: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
  hint?: string;
  id: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold text-ink">
        {label}
        {required ? <span className="text-danger"> *</span> : <span className="font-normal text-ink-3"> (רשות)</span>}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-sm font-medium text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-ink-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const inputClass = (invalid?: boolean) =>
  clsx(
    "h-12 w-full rounded-2xl border bg-surface px-4 text-base text-ink placeholder:text-ink-3/70 transition-colors focus:outline-none focus:ring-4",
    invalid ? "border-danger focus:ring-danger/15" : "border-line-strong focus:border-brand focus:ring-brand/15",
  );

export function ContactForm() {
  const uid = useId();
  const [status, setStatus] = useState<Status>("idle");
  const [errors, setErrors] = useState<Errors>({});
  const [message, setMessage] = useState("");
  const [callback, setCallback] = useState<(typeof CALLBACK_WINDOWS)[number]>("asap");
  const [serverError, setServerError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // "Start with <plan>" buttons on the pricing cards prefill the message.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest<HTMLAnchorElement>("a[data-plan]");
      if (!a) return;
      const name = a.textContent?.replace("מתחילים עם", "").trim();
      if (name) setMessage((m) => m || `מתעניינים בחבילת ${name}.`);
      setTimeout(() => nameRef.current?.focus({ preventScroll: true }), 600);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  const validate = (data: FormData): Errors => {
    const e: Errors = {};
    const name = String(data.get("name") ?? "").trim();
    const phone = String(data.get("phone") ?? "").trim();
    if (name.length < 2) e.name = "נא למלא שם (לפחות 2 תווים)";
    if (!phone) e.phone = "נא למלא מספר טלפון";
    else if (!parsePhone(phone)) e.phone = "מספר הטלפון לא נראה תקין. למשל: 050-123-4567";
    return e;
  };

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (status === "submitting") return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const clientErrors = validate(data);
    setErrors(clientErrors);
    setServerError(null);
    if (Object.keys(clientErrors).length) {
      const first = Object.keys(clientErrors)[0];
      form.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
      return;
    }

    setStatus("submitting");
    try {
      const res = await fetch("/api/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.get("name"),
          phone: data.get("phone"),
          business: data.get("business") ?? "",
          message: data.get("message") ?? "",
          callback,
          marketingConsent: data.get("marketingConsent") === "on",
          website: data.get("website") ?? "",
          page: `${location.pathname}${location.search}`.slice(0, 300),
          source: "form",
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; errors?: Errors };
      if (res.ok && body.ok) {
        setStatus("success");
        return;
      }
      if (res.status === 422 && body.errors) {
        setErrors(body.errors);
        setStatus("idle");
        return;
      }
      setStatus("error");
      setServerError(
        res.status === 429
          ? "שלחתם כבר כמה פניות בזמן קצר. נסו שוב בעוד כמה דקות."
          : "לא הצלחנו לשלוח את הפרטים כרגע. אפשר לנסות שוב, או לפנות אלינו ישירות.",
      );
    } catch {
      setStatus("error");
      setServerError("אין חיבור לרשת. בדקו את החיבור ונסו שוב.");
    }
  };

  const wa = whatsappLink("היי, אשמח לשמוע על נציגה טלפונית לעסק שלי");

  if (status === "success") {
    return (
      <div className="animate-in flex flex-col items-center rounded-[1.75rem] bg-surface p-8 text-center text-ink shadow-float sm:p-10" role="status">
        <CheckCircle2 className="size-14 text-brand" aria-hidden="true" />
        <p className="mt-4 text-2xl font-extrabold">קיבלנו! נחזור אליכם {contact.responseTime}.</p>
        <p className="mt-2 max-w-sm leading-relaxed text-ink-2">בינתיים אפשר לדבר עם הנציגה שלנו בראש העמוד, ולשמוע בדיוק איך זה יישמע אצלכם.</p>
        <button
          type="button"
          className={buttonClass("outline", "md", "mt-6")}
          onClick={() => {
            formRef.current?.reset();
            setMessage("");
            setStatus("idle");
          }}
        >
          שליחת פנייה נוספת
        </button>
      </div>
    );
  }

  const id = (n: string) => `${uid}-${n}`;
  const describedBy = (n: keyof Errors) => (errors[n] ? `${id(n)}-error` : undefined);

  return (
    <form
      ref={formRef}
      action="/api/lead"
      method="post"
      noValidate
      onSubmit={onSubmit}
      className="rounded-[1.75rem] bg-surface p-5 text-ink shadow-float sm:p-8"
      aria-labelledby={`${uid}-title`}
    >
      <p id={`${uid}-title`} className="text-xl font-extrabold">
        השאירו פרטים ונחזור אליכם
      </p>
      <p className="mt-1 text-sm text-ink-2">שיחת היכרות קצרה, בלי התחייבות. חוזרים {contact.responseTime}.</p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id={id("name")} label="שם" required error={errors.name}>
          <input
            ref={nameRef}
            id={id("name")}
            name="name"
            autoComplete="name"
            required
            maxLength={60}
            aria-invalid={Boolean(errors.name)}
            aria-describedby={describedBy("name")}
            className={inputClass(Boolean(errors.name))}
          />
        </Field>
        <Field id={id("phone")} label="טלפון" required error={errors.phone}>
          <input
            id={id("phone")}
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            required
            maxLength={40}
            dir="ltr"
            placeholder="050-123-4567"
            aria-invalid={Boolean(errors.phone)}
            aria-describedby={describedBy("phone")}
            className={clsx(inputClass(Boolean(errors.phone)), "text-end placeholder:text-end")}
          />
        </Field>
        <Field id={id("business")} label="תחום העסק" error={errors.business}>
          <input
            id={id("business")}
            name="business"
            autoComplete="organization"
            maxLength={80}
            placeholder="למשל: מרפאת שיניים, מוסך, משרד עו״ד"
            aria-invalid={Boolean(errors.business)}
            aria-describedby={describedBy("business")}
            className={inputClass(Boolean(errors.business))}
          />
        </Field>
        <fieldset>
          <legend className="mb-1.5 block text-sm font-semibold">מתי נוח שנחזור?</legend>
          <div className="flex flex-wrap gap-1.5">
            {CALLBACK_WINDOWS.map((w) => (
              <label
                key={w}
                className={clsx(
                  "cursor-pointer rounded-full border px-3 py-2 text-sm transition-colors has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-brand/20",
                  callback === w ? "border-brand bg-brand-soft font-semibold text-brand" : "border-line-strong text-ink-2 hover:bg-surface-2",
                )}
              >
                <input type="radio" name="callback" value={w} checked={callback === w} onChange={() => setCallback(w)} className="sr-only" />
                {CALLBACK_LABELS[w]}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="sm:col-span-2">
          <Field id={id("message")} label="מה הייתם רוצים שהנציגה תעשה?" error={errors.message}>
            <textarea
              id={id("message")}
              name="message"
              rows={3}
              maxLength={1000}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="למשל: לענות לשיחות כשאנחנו עם לקוחות ולקבוע תורים ביומן"
              aria-invalid={Boolean(errors.message)}
              aria-describedby={describedBy("message")}
              className={clsx(inputClass(Boolean(errors.message)), "h-auto resize-y py-3")}
            />
          </Field>
        </div>
      </div>

      {/* Honeypot: hidden from people and assistive tech, bots fill it */}
      <div aria-hidden="true" className="sr-only">
        <label htmlFor={id("website")}>אתר</label>
        <input id={id("website")} name="website" tabIndex={-1} autoComplete="off" />
      </div>

      <label className="mt-5 flex cursor-pointer items-start gap-2.5 text-sm text-ink-2">
        <input type="checkbox" name="marketingConsent" className="mt-0.5 size-4 shrink-0 accent-[var(--brand)]" />
        אשמח לקבל עדכונים וטיפים מדי פעם. אפשר להסיר בכל רגע.
      </label>

      {serverError ? (
        <div className="mt-5 rounded-2xl border border-danger/30 bg-danger/5 p-4 text-sm" role="alert">
          <p className="font-semibold text-danger">{serverError}</p>
          {wa || contact.email ? (
            <p className="mt-2 flex flex-wrap gap-3">
              {wa ? (
                <a href={wa} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand underline underline-offset-2">
                  כתבו לנו בוואטסאפ
                </a>
              ) : null}
              {contact.email ? (
                <a href={`mailto:${contact.email}`} className="font-semibold text-brand underline underline-offset-2">
                  {contact.email}
                </a>
              ) : null}
            </p>
          ) : null}
        </div>
      ) : null}

      <button type="submit" disabled={status === "submitting"} className={buttonClass("primary", "lg", "mt-6 w-full")}>
        {status === "submitting" ? <Loader2 className="size-5 animate-spin" aria-hidden="true" /> : <Send className="size-5 -scale-x-100" aria-hidden="true" />}
        {status === "submitting" ? "שולחים…" : "שלחו ונחזור אליכם"}
      </button>
      <p className="mt-3 text-center text-xs leading-relaxed text-ink-3">
        הפרטים משמשים רק כדי לחזור אליכם בנוגע לפנייה.{" "}
        <a href="/privacy" className="underline underline-offset-2 hover:text-ink">
          מדיניות הפרטיות
        </a>
      </p>
    </form>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/primitives";
import { formToObject, useServerAction } from "@/hooks/use-server-action";
import { resendVerificationAction, signInAction } from "../actions";

export function LoginForm({ next }: { next?: string }) {
  const t = useTranslations("auth");
  const router = useRouter();
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const { run, pending, fieldErrors, error } = useServerAction(signInAction, { toastErrors: false });
  const resend = useServerAction(resendVerificationAction);

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const data = formToObject(e.currentTarget);
        const res = await run({ ...data, next });
        if (!res.ok) return;
        if (res.data.status === "email_not_verified") {
          setUnverifiedEmail(data.email);
          return;
        }
        router.replace(res.data.redirectTo ?? "/dashboard");
        router.refresh();
      }}
    >
      {error && !error.fieldErrors && <Alert tone="danger">{error.message}</Alert>}
      {unverifiedEmail && (
        <Alert tone="warning" title={t("emailNotVerified")}>
          {resent ? (
            t("verificationSent")
          ) : (
            <button
              type="button"
              className="font-medium underline underline-offset-2"
              disabled={resend.pending}
              onClick={async () => {
                await resend.run({ email: unverifiedEmail });
                setResent(true);
              }}
            >
              {t("resendVerification")}
            </button>
          )}
        </Alert>
      )}
      <Field label={t("email")} htmlFor="email" error={fieldErrors.email}>
        <Input id="email" name="email" type="email" autoComplete="email" dir="ltr" required autoFocus />
      </Field>
      <Field label={t("password")} htmlFor="password" error={fieldErrors.password}>
        <Input id="password" name="password" type="password" autoComplete="current-password" dir="ltr" required />
      </Field>
      <div className="flex justify-end">
        <Link href="/forgot-password" className="text-sm font-medium text-primary hover:underline">
          {t("forgotPassword")}
        </Link>
      </div>
      <Button type="submit" className="w-full" size="lg" loading={pending}>
        {t("login")}
      </Button>
    </form>
  );
}

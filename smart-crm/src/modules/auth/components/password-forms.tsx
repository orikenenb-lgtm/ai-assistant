"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/primitives";
import { formToObject, useServerAction } from "@/hooks/use-server-action";
import { completePasswordResetAction, mfaChallengeAction, requestPasswordResetAction } from "../actions";

export function ForgotPasswordForm({ devMailbox }: { devMailbox: boolean }) {
  const t = useTranslations("auth");
  const [done, setDone] = useState(false);
  const { run, pending, fieldErrors } = useServerAction(requestPasswordResetAction);
  if (done) {
    return (
      <div className="space-y-4">
        <Alert tone="success">{t("resetSent")}</Alert>
        {devMailbox && (
          <a href="/dev/mailbox" className="text-sm font-medium text-primary hover:underline">
            {t("devMailbox")}
          </a>
        )}
      </div>
    );
  }
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const res = await run(formToObject(e.currentTarget));
        if (res.ok) setDone(true);
      }}
    >
      <Field label={t("email")} htmlFor="email" error={fieldErrors.email}>
        <Input id="email" name="email" type="email" autoComplete="email" dir="ltr" required autoFocus />
      </Field>
      <Button type="submit" className="w-full" size="lg" loading={pending}>
        {t("sendResetLink")}
      </Button>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token?: string }) {
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const [done, setDone] = useState(false);
  const { run, pending, fieldErrors, error } = useServerAction(completePasswordResetAction, { toastErrors: false });
  if (done) {
    return (
      <div className="space-y-4">
        <Alert tone="success">{t("resetDone")}</Alert>
        <Button asChild className="w-full" size="lg">
          <Link href="/login">{t("login")}</Link>
        </Button>
      </div>
    );
  }
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const res = await run({ ...formToObject(e.currentTarget), token });
        if (res.ok) setDone(true);
      }}
    >
      {error && !error.fieldErrors && <Alert tone="danger">{error.message}</Alert>}
      <Field label={t("newPassword")} htmlFor="password" error={fieldErrors.password} hint={t("passwordHint")}>
        <Input id="password" name="password" type="password" autoComplete="new-password" dir="ltr" required autoFocus />
      </Field>
      <Field label={t("confirmPassword")} htmlFor="confirmPassword" error={fieldErrors.confirmPassword}>
        <Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" dir="ltr" required />
      </Field>
      <Button type="submit" className="w-full" size="lg" loading={pending}>
        {tc("save")}
      </Button>
    </form>
  );
}

export function MfaChallengeForm({ next }: { next: string }) {
  const t = useTranslations("auth");
  const router = useRouter();
  const { run, pending, fieldErrors, error } = useServerAction(mfaChallengeAction, { toastErrors: false });
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const res = await run(formToObject(e.currentTarget));
        if (res.ok) {
          router.replace(next);
          router.refresh();
        }
      }}
    >
      {error && !error.fieldErrors && <Alert tone="danger">{error.message}</Alert>}
      <Field label={t("mfaCode")} htmlFor="code" error={fieldErrors.code}>
        <Input
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          dir="ltr"
          className="text-center text-lg tracking-[0.5em]"
          required
          autoFocus
        />
      </Field>
      <Button type="submit" className="w-full" size="lg" loading={pending}>
        {t("verify")}
      </Button>
    </form>
  );
}

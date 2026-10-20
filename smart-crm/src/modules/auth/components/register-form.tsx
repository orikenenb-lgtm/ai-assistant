"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { formToObject, useServerAction } from "@/hooks/use-server-action";
import { signUpAction } from "../actions";

export function RegisterForm({ devMailbox }: { devMailbox: boolean }) {
  const t = useTranslations("auth");
  const locale = useLocale();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const { run, pending, fieldErrors } = useServerAction(signUpAction);

  if (sentTo) {
    return (
      <div className="text-center" role="status">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl bg-success-soft text-success-foreground">
          <MailCheck className="size-6" />
        </div>
        <h2 className="text-xl font-semibold">{t("checkEmailTitle")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{t("checkEmailBody", { email: sentTo })}</p>
        {devMailbox && (
          <a href="/dev/mailbox" className="mt-4 inline-block text-sm font-medium text-primary hover:underline">
            {t("devMailbox")} ←
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
        const res = await run({ ...formToObject(e.currentTarget), locale });
        if (res.ok) setSentTo(res.data.email);
      }}
    >
      <Field label={t("fullName")} htmlFor="fullName" error={fieldErrors.fullName}>
        <Input id="fullName" name="fullName" autoComplete="name" required autoFocus />
      </Field>
      <Field label={t("email")} htmlFor="email" error={fieldErrors.email}>
        <Input id="email" name="email" type="email" autoComplete="email" dir="ltr" required />
      </Field>
      <Field label={t("password")} htmlFor="password" error={fieldErrors.password} hint={t("passwordHint")}>
        <Input id="password" name="password" type="password" autoComplete="new-password" dir="ltr" required />
      </Field>
      <Field label={t("confirmPassword")} htmlFor="confirmPassword" error={fieldErrors.confirmPassword}>
        <Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" dir="ltr" required />
      </Field>
      <Button type="submit" className="w-full" size="lg" loading={pending}>
        {t("register")}
      </Button>
      <p className="text-center text-xs text-muted-foreground">{t("terms")}</p>
    </form>
  );
}

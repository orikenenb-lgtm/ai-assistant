"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Building2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, NativeSelect } from "@/components/ui/input";
import { Alert, Badge } from "@/components/ui/primitives";
import { formToObject, useServerAction } from "@/hooks/use-server-action";
import { createOrganizationAction } from "../actions";
import { acceptInvitationByIdAction } from "../member-actions";

type Invite = { id: string; tenantName: string; role: string };

export function OnboardingForm({ locale, invites }: { locale: "he" | "en"; invites: Invite[] }) {
  const t = useTranslations("onboarding");
  const tm = useTranslations("members");
  const router = useRouter();
  const create = useServerAction(createOrganizationAction);
  const accept = useServerAction(acceptInvitationByIdAction);

  const go = () => {
    router.replace("/dashboard");
    router.refresh();
  };

  return (
    <div className="mt-6 space-y-6">
      {invites.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">{t("pendingInvites")}</p>
          {invites.map((inv) => (
            <div key={inv.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
              <div className="flex items-center gap-3">
                <UserPlus className="size-4 text-muted-foreground" />
                <span className="font-medium">{inv.tenantName}</span>
                <Badge tone="primary">{tm(`roles.${inv.role}` as "roles.agent")}</Badge>
              </div>
              <Button
                size="sm"
                loading={accept.pending}
                onClick={async () => {
                  const res = await accept.run({ invitationId: inv.id });
                  if (res.ok) go();
                }}
              >
                {t("accept")}
              </Button>
            </div>
          ))}
        </div>
      )}
      <form
        noValidate
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const res = await create.run(formToObject(e.currentTarget));
          if (res.ok) go();
        }}
      >
        <Field label={t("orgName")} htmlFor="name" error={create.fieldErrors.name} required>
          <Input id="name" name="name" placeholder={t("orgNamePlaceholder")} required autoFocus />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("language")} htmlFor="locale">
            <NativeSelect id="locale" name="locale" defaultValue={locale}>
              <option value="he">עברית</option>
              <option value="en">English</option>
            </NativeSelect>
          </Field>
          <Field label={t("currency")} htmlFor="currency">
            <NativeSelect id="currency" name="currency" defaultValue="ILS">
              <option value="ILS">₪ ILS</option>
              <option value="USD">$ USD</option>
              <option value="EUR">€ EUR</option>
              <option value="GBP">£ GBP</option>
            </NativeSelect>
          </Field>
        </div>
        <input type="hidden" name="timezone" value="Asia/Jerusalem" />
        <Alert tone="info">{t("trialNote")}</Alert>
        <Button type="submit" size="lg" className="w-full" loading={create.pending}>
          <Building2 />
          {t("create")}
        </Button>
      </form>
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRef, useState, useTransition } from "react";
import { ImageUp, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, NativeSelect } from "@/components/ui/input";
import { Alert, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { formToObject, useServerAction } from "@/hooks/use-server-action";
import { removeLogoAction, updateBrandColorAction, updateOrgProfileAction, uploadLogoAction } from "../actions";

export type OrgProfileValues = {
  name: string;
  locale: "he" | "en";
  timezone: string;
  currency: string;
  website: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  taxId: string | null;
  vatRatePercent: number;
  messagesRetentionDays: number | null;
  aiLogsRetentionDays: number | null;
};

const TIMEZONES = ["Asia/Jerusalem", "Europe/London", "Europe/Berlin", "Europe/Paris", "America/New_York", "America/Los_Angeles", "Asia/Dubai", "UTC"];

export function OrgProfileForm({ initial, canEdit }: { initial: OrgProfileValues; canEdit: boolean }) {
  const t = useTranslations("orgSettings");
  const tc = useTranslations("common");
  const router = useRouter();
  const { run, pending, fieldErrors } = useServerAction(updateOrgProfileAction, { successMessage: tc("saved"), onSuccess: () => router.refresh() });
  const timezones = TIMEZONES.includes(initial.timezone) ? TIMEZONES : [initial.timezone, ...TIMEZONES];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("profile")}</CardTitle>
      </CardHeader>
      <CardContent>
        {!canEdit && (
          <Alert tone="info" className="mb-4">
            {t("readOnlyNotice")}
          </Alert>
        )}
        <form
          noValidate
          className="space-y-5"
          onSubmit={async (e) => {
            e.preventDefault();
            await run(formToObject(e.currentTarget));
          }}
        >
          <fieldset disabled={!canEdit || pending} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("name")} htmlFor="name" error={fieldErrors.name} required className="sm:col-span-2">
                <Input id="name" name="name" defaultValue={initial.name} dir="auto" required />
              </Field>
              <Field label={t("locale")} htmlFor="locale">
                <NativeSelect id="locale" name="locale" defaultValue={initial.locale}>
                  <option value="he">עברית</option>
                  <option value="en">English</option>
                </NativeSelect>
              </Field>
              <Field label={t("timezone")} htmlFor="timezone" error={fieldErrors.timezone}>
                <NativeSelect id="timezone" name="timezone" defaultValue={initial.timezone} dir="ltr">
                  {timezones.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label={t("currency")} htmlFor="currency">
                <NativeSelect id="currency" name="currency" defaultValue={initial.currency}>
                  <option value="ILS">₪ ILS</option>
                  <option value="USD">$ USD</option>
                  <option value="EUR">€ EUR</option>
                  <option value="GBP">£ GBP</option>
                </NativeSelect>
              </Field>
              <Field label={t("vatRate")} htmlFor="vatRatePercent" hint={t("vatHint")} error={fieldErrors.vatRatePercent}>
                <Input id="vatRatePercent" name="vatRatePercent" type="number" min={0} max={100} step="0.01" defaultValue={initial.vatRatePercent} dir="ltr" />
              </Field>
              <Field label={t("website")} htmlFor="website" error={fieldErrors.website}>
                <Input id="website" name="website" type="url" defaultValue={initial.website ?? ""} dir="ltr" placeholder="https://" />
              </Field>
              <Field label={t("email")} htmlFor="email" error={fieldErrors.email}>
                <Input id="email" name="email" type="email" defaultValue={initial.email ?? ""} dir="ltr" />
              </Field>
              <Field label={t("phone")} htmlFor="phone" error={fieldErrors.phone}>
                <Input id="phone" name="phone" type="tel" defaultValue={initial.phone ?? ""} dir="ltr" />
              </Field>
              <Field label={t("taxId")} htmlFor="taxId" error={fieldErrors.taxId}>
                <Input id="taxId" name="taxId" defaultValue={initial.taxId ?? ""} dir="ltr" />
              </Field>
              <Field label={t("address")} htmlFor="address" error={fieldErrors.address} className="sm:col-span-2">
                <Input id="address" name="address" defaultValue={initial.address ?? ""} dir="auto" />
              </Field>
            </div>
            <div className="border-t border-border pt-5">
              <h3 className="text-sm font-semibold">{t("retention")}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{t("retentionHelp")}</p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field label={t("messagesRetention")} htmlFor="messagesRetentionDays" error={fieldErrors.messagesRetentionDays}>
                  <Input id="messagesRetentionDays" name="messagesRetentionDays" type="number" min={30} max={3650} defaultValue={initial.messagesRetentionDays ?? ""} dir="ltr" />
                </Field>
                <Field label={t("aiRetention")} htmlFor="aiLogsRetentionDays" error={fieldErrors.aiLogsRetentionDays}>
                  <Input id="aiLogsRetentionDays" name="aiLogsRetentionDays" type="number" min={30} max={3650} defaultValue={initial.aiLogsRetentionDays ?? ""} dir="ltr" />
                </Field>
              </div>
            </div>
          </fieldset>
          {canEdit && (
            <div className="flex justify-end">
              <Button type="submit" loading={pending}>
                {tc("save")}
              </Button>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

export function BrandingCard({ logoDataUrl, brandColor, canEdit }: { logoDataUrl: string | null; brandColor: string | null; canEdit: boolean }) {
  const t = useTranslations("orgSettings");
  const tc = useTranslations("common");
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [color, setColor] = useState(brandColor ?? "#4f46e5");
  const [busy, start] = useTransition();

  const upload = (file: File) =>
    start(async () => {
      const form = new FormData();
      form.set("logo", file);
      const res = await uploadLogoAction(form);
      if (!res.ok) return void toast.error(res.error.message);
      toast.success(tc("saved"));
      router.refresh();
    });

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{t("branding")}</CardTitle>
          <CardDescription>{t("brandingHelp")}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid gap-6 sm:grid-cols-2">
        <div>
          <p className="mb-2 text-sm font-medium">{t("logo")}</p>
          <div className="flex items-center gap-4">
            <div className="flex size-20 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted">
              {logoDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- inline data URL, no optimization needed
                <img src={logoDataUrl} alt={t("logo")} className="max-h-full max-w-full object-contain" />
              ) : (
                <span className="text-xs text-muted-foreground">{t("noLogo")}</span>
              )}
            </div>
            {canEdit && (
              <div className="flex flex-col gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  aria-label={t("uploadLogo")}
                  onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
                  data-testid="logo-input"
                />
                <Button size="sm" variant="secondary" loading={busy} onClick={() => fileRef.current?.click()}>
                  <ImageUp /> {logoDataUrl ? t("replaceLogo") : t("uploadLogo")}
                </Button>
                {logoDataUrl && (
                  <Button
                    size="sm"
                    variant="danger-ghost"
                    disabled={busy}
                    onClick={() =>
                      start(async () => {
                        const res = await removeLogoAction();
                        if (!res.ok) return void toast.error(res.error.message);
                        router.refresh();
                      })
                    }
                  >
                    <Trash2 /> {t("removeLogo")}
                  </Button>
                )}
              </div>
            )}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t("logoHint")}</p>
        </div>
        <div>
          <Field label={t("brandColor")} htmlFor="brandColor">
            <div className="flex items-center gap-2">
              <input
                id="brandColor"
                type="color"
                value={color}
                disabled={!canEdit}
                onChange={(e) => setColor(e.target.value)}
                className="h-9 w-14 cursor-pointer rounded-lg border border-input bg-surface p-1"
              />
              <Input value={color} onChange={(e) => setColor(e.target.value)} disabled={!canEdit} dir="ltr" className="w-28 font-mono" aria-label={t("brandColor")} />
            </div>
          </Field>
          {canEdit && (
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                loading={busy}
                onClick={() =>
                  start(async () => {
                    const res = await updateBrandColorAction({ brandColor: color });
                    if (!res.ok) return void toast.error(res.error.fieldErrors?.brandColor?.[0] ?? res.error.message);
                    toast.success(tc("saved"));
                    router.refresh();
                  })
                }
              >
                {tc("save")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  start(async () => {
                    await updateBrandColorAction({ brandColor: null });
                    setColor("#4f46e5");
                    router.refresh();
                  })
                }
              >
                {t("resetColor")}
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useRef, useState, useTransition } from "react";
import { Laptop, LogOut, ShieldCheck, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, NativeSelect } from "@/components/ui/input";
import { Alert, Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/data/confirm-dialog";
import { formToObject, useServerAction } from "@/hooks/use-server-action";
import { formatRelative } from "@/lib/format";
import { changePasswordAction } from "@/modules/auth/actions";
import {
  confirmMfaEnrollmentAction,
  disableMfaAction,
  revokeSessionAction,
  signOutOtherSessionsAction,
  startMfaEnrollmentAction,
  updateProfileAction,
} from "../actions";
import type { MfaEnrollment } from "../service";

export function ProfileCard({ initial }: { initial: { fullName: string; email: string; locale: "he" | "en"; theme: "light" | "dark" | "system" } }) {
  const t = useTranslations("account");
  const tc = useTranslations("common");
  const router = useRouter();
  const { setTheme } = useTheme();
  const { run, pending, fieldErrors } = useServerAction(updateProfileAction, { successMessage: tc("saved") });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("profile")}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          noValidate
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const data = formToObject(e.currentTarget);
            const res = await run(data);
            if (res.ok) {
              setTheme(data.theme);
              router.refresh();
            }
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("fullName")} htmlFor="fullName" error={fieldErrors.fullName} required>
              <Input id="fullName" name="fullName" defaultValue={initial.fullName} dir="auto" required />
            </Field>
            <Field label={t("email")} htmlFor="email">
              <Input id="email" value={initial.email} dir="ltr" readOnly disabled />
            </Field>
            <Field label={t("language")} htmlFor="locale">
              <NativeSelect id="locale" name="locale" defaultValue={initial.locale}>
                <option value="he">עברית</option>
                <option value="en">English</option>
              </NativeSelect>
            </Field>
            <Field label={t("theme")} htmlFor="theme">
              <NativeSelect id="theme" name="theme" defaultValue={initial.theme}>
                {(["system", "light", "dark"] as const).map((v) => (
                  <option key={v} value={v}>
                    {t(`themes.${v}`)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <div className="flex justify-end">
            <Button type="submit" loading={pending}>
              {tc("save")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export function PasswordCard() {
  const t = useTranslations("account");
  const ta = useTranslations("auth");
  const formRef = useRef<HTMLFormElement>(null);
  const { run, pending, fieldErrors } = useServerAction(changePasswordAction, { successMessage: t("passwordChanged") });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("password")}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          ref={formRef}
          noValidate
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const res = await run(formToObject(e.currentTarget));
            if (res.ok) formRef.current?.reset();
          }}
        >
          <Field label={t("currentPassword")} htmlFor="currentPassword" error={fieldErrors.currentPassword} required>
            <Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" dir="ltr" required />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("newPassword")} htmlFor="newPassword" error={fieldErrors.newPassword} hint={ta("passwordHint")} required>
              <Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" dir="ltr" required />
            </Field>
            <Field label={t("confirmPassword")} htmlFor="confirmPassword" error={fieldErrors.confirmPassword} required>
              <Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" dir="ltr" required />
            </Field>
          </div>
          <div className="flex justify-end">
            <Button type="submit" loading={pending}>
              {t("changePassword")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export function MfaCard({ enabled, factorId, canDisable }: { enabled: boolean; factorId: string | null; canDisable: boolean }) {
  const t = useTranslations("account");
  const tc = useTranslations("common");
  const router = useRouter();
  const [enrollment, setEnrollment] = useState<MfaEnrollment | null>(null);
  const [starting, start] = useTransition();
  const confirm = useServerAction(confirmMfaEnrollmentAction, {
    successMessage: t("mfaEnabledToast"),
    onSuccess: () => {
      setEnrollment(null);
      router.refresh();
    },
  });

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{t("mfa")}</CardTitle>
          <CardDescription>{t("mfaHelp")}</CardDescription>
        </div>
        <Badge tone={enabled ? "success" : "neutral"}>{enabled ? t("mfaEnabled") : t("mfaDisabled")}</Badge>
      </CardHeader>
      <CardContent>
        {enabled ? (
          canDisable && factorId ? (
            <ConfirmDialog
              trigger={
                <Button variant="danger-ghost" size="sm">
                  <ShieldOff /> {t("disableMfa")}
                </Button>
              }
              confirmLabel={t("disableMfa")}
              onConfirm={async () => {
                const res = await disableMfaAction({ factorId });
                if (!res.ok) return void toast.error(res.error.message);
                toast.success(t("mfaDisabledToast"));
                router.refresh();
              }}
            />
          ) : (
            <p className="text-sm text-muted-foreground">{t("mfaReauth")}</p>
          )
        ) : enrollment ? (
          <div className="grid gap-6 sm:grid-cols-[auto_1fr]">
            {/* eslint-disable-next-line @next/next/no-img-element -- QR code generated server-side as a data URL */}
            <img src={enrollment.qrDataUrl} alt="QR" width={180} height={180} className="rounded-lg border border-border bg-white p-2" />
            <div className="space-y-4">
              <p className="text-sm">{t("mfaScan")}</p>
              <div>
                <p className="text-xs text-muted-foreground">{t("mfaSecret")}</p>
                <code className="mt-1 block break-all rounded-md bg-muted px-2 py-1.5 font-mono text-sm" dir="ltr" data-testid="mfa-secret">
                  {enrollment.secret}
                </code>
              </div>
              <form
                noValidate
                className="flex flex-wrap items-end gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  await confirm.run({ factorId: enrollment.factorId, code: formToObject(e.currentTarget).code });
                }}
              >
                <Field label={t("mfaCode")} htmlFor="mfa-code" error={confirm.fieldErrors.code}>
                  <Input id="mfa-code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} dir="ltr" className="w-36 text-center tracking-[0.3em]" required />
                </Field>
                <Button type="submit" loading={confirm.pending}>
                  {t("mfaVerify")}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setEnrollment(null)}>
                  {tc("cancel")}
                </Button>
              </form>
            </div>
          </div>
        ) : (
          <Button
            loading={starting}
            onClick={() =>
              start(async () => {
                const res = await startMfaEnrollmentAction();
                if (!res.ok) return void toast.error(res.error.message);
                setEnrollment(res.data);
              })
            }
          >
            <ShieldCheck /> {t("enableMfa")}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

type SessionRow = { id: string; current: boolean; userAgent: string | null; ip: string | null; lastSeenAt: Date };

function deviceLabel(ua: string | null, fallback: string) {
  if (!ua) return fallback;
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : null;
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : null;
  return [browser, os].filter(Boolean).join(" · ") || fallback;
}

export function SessionsCard({ sessions }: { sessions: SessionRow[] | null }) {
  const t = useTranslations("account");
  const locale = useLocale() as "he" | "en";
  const router = useRouter();
  const [busy, start] = useTransition();
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{t("sessions")}</CardTitle>
          <CardDescription>{t("sessionsHelp")}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {sessions === null ? (
          <Alert tone="info">{t("sessionsUnavailable")}</Alert>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {sessions.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                <Laptop className="size-4 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {deviceLabel(s.userAgent, t("unknownDevice"))} {s.current && <Badge tone="success">{t("currentSession")}</Badge>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {s.ip && (
                      <>
                        <span dir="ltr">{s.ip}</span>
                        {" · "}
                      </>
                    )}
                    {t("lastSeen", { when: formatRelative(s.lastSeenAt, locale) })}
                  </p>
                </div>
                {!s.current && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      start(async () => {
                        const res = await revokeSessionAction({ sessionId: s.id });
                        if (!res.ok) return void toast.error(res.error.message);
                        router.refresh();
                      })
                    }
                  >
                    {t("revoke")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        <Button
          variant="secondary"
          size="sm"
          loading={busy}
          onClick={() =>
            start(async () => {
              const res = await signOutOtherSessionsAction();
              if (!res.ok) return void toast.error(res.error.message);
              toast.success(t("signedOutOthers"));
              router.refresh();
            })
          }
        >
          <LogOut /> {t("signOutOthers")}
        </Button>
      </CardContent>
    </Card>
  );
}

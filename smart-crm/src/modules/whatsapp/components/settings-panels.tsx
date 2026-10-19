"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Beaker, Check, Copy, KeyRound, Pencil, Plug, Plus, Power, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, NativeSelect } from "@/components/ui/input";
import { Alert, Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formToObject, useServerAction } from "@/hooks/use-server-action";
import { formatDateTime } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import {
  connectAccountAction,
  setAccountStatusAction,
  simulateInboundAction,
  syncTemplatesAction,
  testConnectionAction,
  updateAccountAction,
} from "../actions";
import type { AccountView, TemplateView } from "../accounts";

/* ------------------------------------------------------------- connect */

export function ConnectAccountDialog({ mockAvailable }: { mockAvailable: boolean }) {
  const t = useTranslations("whatsapp");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<"meta" | "mock">(mockAvailable ? "mock" : "meta");
  const connect = useServerAction(connectAccountAction, { successMessage: t("connected") });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) connect.reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus /> {t("connect")}
        </Button>
      </DialogTrigger>
      <DialogContent size="lg" closeLabel={tc("close")}>
        <DialogHeader>
          <DialogTitle>{t("connectTitle")}</DialogTitle>
          <DialogDescription>{t("official")}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="space-y-4"
          autoComplete="off"
          onSubmit={async (e) => {
            e.preventDefault();
            const data = formToObject(e.currentTarget);
            const res = await connect.run({ ...data, provider });
            if (res.ok) {
              setOpen(false);
              router.refresh();
            }
          }}
        >
          {connect.error?.fieldErrors?._form && <Alert tone="danger">{connect.error.fieldErrors._form[0]}</Alert>}
          <Field label={t("fields.provider")} htmlFor="wa-provider">
            <NativeSelect id="wa-provider" value={provider} onChange={(e) => setProvider(e.target.value as "meta" | "mock")}>
              <option value="meta">{t("providers.meta")}</option>
              {mockAvailable && <option value="mock">{t("providers.mock")}</option>}
            </NativeSelect>
          </Field>
          {provider === "mock" && <Alert tone="warning">{t("mockNotice")}</Alert>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("fields.displayName")} htmlFor="wa-displayName" error={connect.fieldErrors.displayName} required>
              <Input id="wa-displayName" name="displayName" dir="auto" autoFocus />
            </Field>
            <Field label={t("fields.phoneNumber")} htmlFor="wa-phoneNumber" error={connect.fieldErrors.phoneNumber} required>
              <Input id="wa-phoneNumber" name="phoneNumber" type="tel" dir="ltr" placeholder="+972 50 000 0000" />
            </Field>
            <Field label={t("fields.phoneNumberId")} htmlFor="wa-phoneNumberId" error={connect.fieldErrors.phoneNumberId} hint={t("hints.phoneNumberId")} required>
              <Input id="wa-phoneNumberId" name="phoneNumberId" dir="ltr" />
            </Field>
            <Field label={t("fields.wabaId")} htmlFor="wa-wabaId" error={connect.fieldErrors.wabaId} required>
              <Input id="wa-wabaId" name="wabaId" dir="ltr" />
            </Field>
          </div>
          {provider === "meta" && (
            <Field label={t("fields.accessToken")} htmlFor="wa-accessToken" error={connect.fieldErrors.accessToken} hint={t("hints.accessToken")} required>
              <Input id="wa-accessToken" name="accessToken" type="password" dir="ltr" autoComplete="new-password" spellCheck={false} />
            </Field>
          )}
          <Field label={t("fields.sendRate")} htmlFor="wa-sendRate" error={connect.fieldErrors.sendRatePerMinute} hint={t("hints.sendRate")}>
            <Input id="wa-sendRate" name="sendRatePerMinute" type="number" min={1} max={1000} defaultValue={60} dir="ltr" className="max-w-32" />
          </Field>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" loading={connect.pending}>
              <Plug /> {t("connect")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------- edit account */

function EditAccountDialog({ account }: { account: AccountView }) {
  const t = useTranslations("whatsapp");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const update = useServerAction(updateAccountAction, { successMessage: tc("saved") });
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) update.reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Pencil /> {t("edit")}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={tc("close")}>
        <DialogHeader>
          <DialogTitle>{account.displayName}</DialogTitle>
        </DialogHeader>
        <form
          noValidate
          className="space-y-4"
          autoComplete="off"
          onSubmit={async (e) => {
            e.preventDefault();
            const data = formToObject(e.currentTarget);
            const res = await update.run({ id: account.id, ...data });
            if (res.ok) {
              setOpen(false);
              router.refresh();
            }
          }}
        >
          <Field label={t("fields.displayName")} htmlFor={`dn-${account.id}`} error={update.fieldErrors.displayName}>
            <Input id={`dn-${account.id}`} name="displayName" defaultValue={account.displayName} dir="auto" />
          </Field>
          <Field label={t("fields.sendRate")} htmlFor={`sr-${account.id}`} error={update.fieldErrors.sendRatePerMinute} hint={t("hints.sendRate")}>
            <Input id={`sr-${account.id}`} name="sendRatePerMinute" type="number" min={1} max={1000} defaultValue={account.sendRatePerMinute} dir="ltr" className="max-w-32" />
          </Field>
          {account.provider === "meta" && (
            <Field label={t("rotateToken")} htmlFor={`tk-${account.id}`} error={update.fieldErrors.accessToken} hint={t("hints.tokenKeep")}>
              <Input id={`tk-${account.id}`} name="accessToken" type="password" dir="ltr" autoComplete="new-password" spellCheck={false} />
            </Field>
          )}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" loading={update.pending}>
              {t("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* --------------------------------------------------------- account card */

const statusTone = { active: "success", disabled: "neutral", error: "danger" } as const;
const templateTone = (s: string) => (s === "APPROVED" ? "success" : s === "REJECTED" || s === "DISABLED" ? "danger" : s === "PAUSED" ? "warning" : "neutral");

export function AccountCard({ account, templates, readOnly }: { account: AccountView; templates: TemplateView[]; readOnly: boolean }) {
  const t = useTranslations("whatsapp");
  const locale = useLocale() as "he" | "en";
  const router = useRouter();
  const [busy, setBusy] = useState<null | "test" | "status" | "sync">(null);

  const act = async <T,>(kind: "test" | "status" | "sync", fn: () => Promise<{ ok: true; data: T } | { ok: false; error: { message: string } }>, done: (data: T) => void) => {
    setBusy(kind);
    const res = await fn();
    setBusy(null);
    if (!res.ok) toast.error(res.error.message);
    else done(res.data);
    router.refresh();
  };

  return (
    <Card data-testid="wa-account">
      <CardHeader className="flex-wrap gap-3">
        <div className="min-w-0">
          <CardTitle className="flex flex-wrap items-center gap-2">
            <span dir="auto">{account.displayName}</span>
            <Badge tone={statusTone[account.status]}>{t(`status.${account.status}`)}</Badge>
            {account.provider === "mock" && (
              <Badge tone="warning">
                <Beaker /> {t("mockBadge")}
              </Badge>
            )}
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground" dir="ltr">
            {formatPhone(account.phoneNumber)}
          </p>
        </div>
        {!readOnly && (
          <div className="flex flex-wrap gap-1.5">
            <Button
              variant="secondary"
              size="sm"
              loading={busy === "test"}
              onClick={() =>
                act("test", () => testConnectionAction({ id: account.id }), (r) =>
                  r.ok ? toast.success(t("testOk")) : toast.error(t("testFailed", { error: r.error ?? "" })),
                )
              }
            >
              <Check /> {t("test")}
            </Button>
            <EditAccountDialog account={account} />
            <Button
              variant={account.status === "disabled" ? "soft" : "ghost"}
              size="sm"
              loading={busy === "status"}
              onClick={() =>
                act("status", () => setAccountStatusAction({ id: account.id, status: account.status === "disabled" ? "active" : "disabled" }), () => undefined)
              }
            >
              <Power /> {account.status === "disabled" ? t("enable") : t("disable")}
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">{t("fields.phoneNumberId")}</dt>
            <dd className="truncate font-mono text-xs" dir="ltr">
              {account.phoneNumberId}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("quality")}</dt>
            <dd>{account.qualityRating ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("fields.sendRate")}</dt>
            <dd className="tabular">{account.sendRatePerMinute}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("lastSync")}</dt>
            <dd>{account.lastSyncedAt ? formatDateTime(account.lastSyncedAt, locale) : "—"}</dd>
          </div>
        </dl>
        {account.provider === "meta" && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <KeyRound className="size-3.5" /> {account.hasToken ? t("tokenStored") : t("tokenMissing")}
          </p>
        )}
        {account.lastError && (
          <Alert tone="danger" title={t("lastError")}>
            <span dir="auto">{account.lastError}</span>
          </Alert>
        )}

        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h4 className="text-sm font-semibold">{t("templates")}</h4>
            {!readOnly && (
              <Button
                variant="ghost"
                size="sm"
                loading={busy === "sync"}
                onClick={() => act("sync", () => syncTemplatesAction({ accountId: account.id }), (r) => toast.success(t("synced", { count: r.synced })))}
              >
                <RefreshCw /> {t("sync")}
              </Button>
            )}
          </div>
          {templates.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">{t("noTemplates")}</p>
          ) : (
            <Table>
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>{t("templateCols.name")}</TH>
                  <TH>{t("templateCols.language")}</TH>
                  <TH className="hidden sm:table-cell">{t("templateCols.category")}</TH>
                  <TH>{t("templateCols.status")}</TH>
                </TR>
              </THead>
              <TBody>
                {templates.map((tpl) => (
                  <TR key={tpl.id} data-testid="wa-template">
                    <TD className="font-mono text-xs" dir="ltr">
                      {tpl.name}
                    </TD>
                    <TD dir="ltr">{tpl.language}</TD>
                    <TD className="hidden sm:table-cell">{tpl.category}</TD>
                    <TD>
                      <Badge tone={templateTone(tpl.status)} title={tpl.rejectedReason ?? undefined}>
                        {tpl.status}
                      </Badge>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------- webhook */

export function CopyValue({ value }: { value: string }) {
  const t = useTranslations("whatsapp.webhook");
  const tc = useTranslations("common");
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2.5 py-1.5 text-xs" dir="ltr">
        {value}
      </code>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={t("copy")}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            toast.success(tc("copied"));
          } catch {
            toast.error(value);
          }
        }}
      >
        <Copy />
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------ simulator */

export function SimulatorPanel({ accounts, signingConfigured }: { accounts: { id: string; displayName: string }[]; signingConfigured: boolean }) {
  const t = useTranslations("whatsapp.simulator");
  const [kind, setKind] = useState<"text" | "image" | "document">("text");
  const simulate = useServerAction(simulateInboundAction, { successMessage: t("done") });

  return (
    <Card className="border-warning/50" data-testid="wa-simulator">
      <CardHeader className="flex-col gap-1">
        <CardTitle className="flex items-center gap-2">
          <Beaker className="size-4" /> {t("title")}
        </CardTitle>
        <CardDescription>{t("body")}</CardDescription>
      </CardHeader>
      <CardContent>
        {!signingConfigured ? (
          <Alert tone="warning">{t("noSecret")}</Alert>
        ) : (
          <form
            noValidate
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const res = await simulate.run({ ...formToObject(form), kind });
              if (res.ok) (form.elements.namedItem("text") as HTMLInputElement | null)?.select();
            }}
          >
            <Field label={t("account")} htmlFor="sim-account">
              <NativeSelect id="sim-account" name="accountId" defaultValue={accounts[0]?.id}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.displayName}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label={t("kind")} htmlFor="sim-kind">
              <NativeSelect id="sim-kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
                {(["text", "image", "document"] as const).map((k) => (
                  <option key={k} value={k}>
                    {t(`kinds.${k}`)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label={t("from")} htmlFor="sim-from" error={simulate.fieldErrors.fromPhone}>
              <Input id="sim-from" name="fromPhone" type="tel" dir="ltr" defaultValue="+972501234567" />
            </Field>
            <Field label={t("name")} htmlFor="sim-name" error={simulate.fieldErrors.name}>
              <Input id="sim-name" name="name" dir="auto" defaultValue="דנה כהן" />
            </Field>
            <Field label={t("text")} htmlFor="sim-text" error={simulate.fieldErrors.text} className="sm:col-span-2">
              <Input id="sim-text" name="text" dir="auto" defaultValue="שלום" />
            </Field>
            <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
              <Button type="submit" loading={simulate.pending}>
                {t("send")}
              </Button>
              <Button asChild variant="link">
                <Link href="/inbox">{t("openInbox")}</Link>
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

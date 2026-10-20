"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { History, KeyRound, MoreHorizontal, Pencil, Plus, RotateCw, Trash2, Webhook } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox, Switch } from "@/components/ui/controls";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, SheetContent } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { Alert, Badge, Card, CardContent, EmptyState } from "@/components/ui/primitives";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/menu";
import { Spinner } from "@/components/ui/spinner";
import { useServerAction } from "@/hooks/use-server-action";
import { useRemoteData } from "@/hooks/use-remote-data";
import { formatDateTime } from "@/lib/format";
import { CopyButton } from "@/modules/api/components/api-keys-manager";
import {
  createWebhookAction,
  deleteWebhookAction,
  listDeliveriesAction,
  redeliverAction,
  rotateWebhookSecretAction,
  setWebhookActiveAction,
  updateWebhookAction,
} from "../actions";

type WebhookRow = {
  id: string;
  url: string;
  description: string | null;
  events: string[];
  active: boolean;
  consecutiveFailures: number;
  disabledReason: string | null;
  createdAt: Date;
};

type EventKey = "eventNames.contact.created";
const eventKey = (e: string) => `eventNames.${e}` as EventKey;

export function WebhooksManager({ webhooks, events, canEdit }: { webhooks: WebhookRow[]; events: readonly string[]; canEdit: boolean }) {
  const t = useTranslations("webhooks");
  const tc = useTranslations("common");
  const router = useRouter();
  const [busy, start] = useTransition();
  const [editing, setEditing] = useState<WebhookRow | "new" | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [history, setHistory] = useState<WebhookRow | null>(null);
  const [confirming, setConfirming] = useState<{ kind: "rotate" | "delete"; webhook: WebhookRow } | null>(null);

  const runConfirmed = async () => {
    if (!confirming) return;
    const { kind, webhook } = confirming;
    if (kind === "rotate") {
      const res = await rotateWebhookSecretAction({ id: webhook.id });
      if (!res.ok) return void toast.error(res.error.message);
      setConfirming(null);
      setSecret(res.data.secret);
    } else {
      const res = await deleteWebhookAction({ id: webhook.id });
      if (!res.ok) return void toast.error(res.error.message);
      setConfirming(null);
      toast.success(tc("deleted"));
      router.refresh();
    }
  };

  const act = (fn: () => Promise<{ ok: boolean; error?: { message: string } }>, success?: string) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(res.error?.message ?? tc("retry"));
      if (success) toast.success(success);
      router.refresh();
    });

  return (
    <>
      {canEdit && (
        <div className="flex justify-end">
          <Button onClick={() => setEditing("new")}>
            <Plus /> {t("create")}
          </Button>
        </div>
      )}
      {webhooks.length === 0 ? (
        <EmptyState icon={<Webhook />} title={t("emptyTitle")} description={t("emptyBody")} />
      ) : (
        <div className="space-y-3">
          {webhooks.map((w) => (
            <Card key={w.id} data-testid="webhook-row">
              <CardContent className="flex flex-wrap items-start gap-4 pt-5">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className="truncate font-mono text-sm font-medium" dir="ltr">
                    {w.url}
                  </p>
                  {w.description && <p className="text-sm text-muted-foreground">{w.description}</p>}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={w.active ? "success" : "warning"}>{w.active ? t("active") : t("disabled")}</Badge>
                    {w.consecutiveFailures > 0 && <Badge tone="danger">{t("failures", { count: w.consecutiveFailures })}</Badge>}
                    {w.events.slice(0, 4).map((e) => (
                      <Badge key={e} tone="neutral">
                        {t(eventKey(e))}
                      </Badge>
                    ))}
                    {w.events.length > 4 && <Badge tone="outline">+{w.events.length - 4}</Badge>}
                  </div>
                  {w.disabledReason === "too_many_failures" && !w.active && (
                    <p className="text-xs text-danger-foreground">{t("autoDisabled")}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {canEdit && (
                    <Switch
                      checked={w.active}
                      disabled={busy}
                      aria-label={w.active ? t("disable") : t("enable")}
                      onCheckedChange={(active) => act(() => setWebhookActiveAction({ id: w.id, active }))}
                    />
                  )}
                  <Button variant="ghost" size="sm" onClick={() => setHistory(w)}>
                    <History /> {t("deliveries")}
                  </Button>
                  {canEdit && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={tc("actions")} disabled={busy}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem onSelect={() => setEditing(w)}>
                          <Pencil /> {tc("edit")}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setConfirming({ kind: "rotate", webhook: w })}>
                          <KeyRound /> {t("rotate")}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="danger" onSelect={() => setConfirming({ kind: "delete", webhook: w })}>
                          <Trash2 /> {tc("delete")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {editing && (
        <WebhookDialog
          initial={editing === "new" ? null : editing}
          events={events}
          onClose={() => setEditing(null)}
          onSaved={(s) => {
            setEditing(null);
            if (s) setSecret(s);
            router.refresh();
          }}
        />
      )}

      <Dialog open={secret !== null} onOpenChange={(o) => !o && setSecret(null)}>
        <DialogContent closeLabel={tc("close")}>
          <DialogHeader>
            <DialogTitle>{t("secretTitle")}</DialogTitle>
            <DialogDescription>{t("secretBody")}</DialogDescription>
          </DialogHeader>
          <code className="block break-all rounded-lg bg-muted px-3 py-2 font-mono text-sm" dir="ltr" data-testid="webhook-secret">
            {secret}
          </code>
          <DialogFooter>
            {secret && <CopyButton value={secret} label={tc("copy")} />}
            <Button onClick={() => setSecret(null)}>{tc("close")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirming !== null} onOpenChange={(o) => !o && setConfirming(null)}>
        <DialogContent size="sm" closeLabel={tc("close")}>
          <DialogHeader>
            <DialogTitle>{confirming?.kind === "rotate" ? t("rotate") : tc("confirmDeleteTitle")}</DialogTitle>
            <DialogDescription>{confirming?.kind === "rotate" ? t("rotateConfirm") : t("deleteConfirm")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirming(null)} disabled={busy}>
              {tc("cancel")}
            </Button>
            <Button variant={confirming?.kind === "delete" ? "danger" : "primary"} loading={busy} onClick={() => start(runConfirmed)}>
              {confirming?.kind === "rotate" ? t("rotate") : tc("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={history !== null} onOpenChange={(o) => !o && setHistory(null)}>
        {history && <DeliveriesSheet webhook={history} canEdit={canEdit} />}
      </Dialog>
    </>
  );
}

function WebhookDialog({
  initial,
  events,
  onClose,
  onSaved,
}: {
  initial: WebhookRow | null;
  events: readonly string[];
  onClose: () => void;
  onSaved: (secret: string | null) => void;
}) {
  const t = useTranslations("webhooks");
  const tc = useTranslations("common");
  const [selected, setSelected] = useState<string[]>(initial?.events ?? []);
  const create = useServerAction(createWebhookAction);
  const update = useServerAction(updateWebhookAction);
  const { pending, fieldErrors, error } = initial ? update : create;
  const allSelected = selected.length === events.length;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={tc("close")} size="lg">
        <DialogHeader>
          <DialogTitle>{initial ? t("edit") : t("create")}</DialogTitle>
          <DialogDescription>{t("subtitle")}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            const input = { url: String(form.get("url") ?? ""), description: String(form.get("description") ?? ""), events: selected };
            if (initial) {
              const res = await update.run({ ...input, id: initial.id });
              if (res.ok) onSaved(null);
            } else {
              const res = await create.run(input);
              if (res.ok) onSaved(res.data.secret);
            }
          }}
        >
          <Field label={t("url")} htmlFor="webhook-url" error={fieldErrors.url} required>
            <Input id="webhook-url" name="url" type="url" dir="ltr" placeholder="https://example.com/hooks/crm" defaultValue={initial?.url} required autoFocus />
          </Field>
          <Field label={t("description")} htmlFor="webhook-description" error={fieldErrors.description}>
            <Input id="webhook-description" name="description" maxLength={200} defaultValue={initial?.description ?? ""} />
          </Field>
          <fieldset>
            <div className="mb-2 flex items-center justify-between">
              <legend className="text-sm font-medium">{t("events")}</legend>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={allSelected} onCheckedChange={(c) => setSelected(c === true ? [...events] : [])} />
                {t("selectAll")}
              </label>
            </div>
            <div className="grid max-h-64 gap-1.5 overflow-y-auto rounded-lg border border-border p-2 sm:grid-cols-2">
              {events.map((ev) => (
                <label key={ev} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent">
                  <Checkbox
                    checked={selected.includes(ev)}
                    onCheckedChange={(c) => setSelected((cur) => (c === true ? [...cur, ev] : cur.filter((x) => x !== ev)))}
                  />
                  <span className="min-w-0 flex-1">{t(eventKey(ev))}</span>
                  <code className="hidden text-[11px] text-muted-foreground sm:inline" dir="ltr">
                    {ev}
                  </code>
                </label>
              ))}
            </div>
            {fieldErrors.events && <p className="mt-1 text-xs text-danger-foreground">{fieldErrors.events[0]}</p>}
          </fieldset>
          {error && !error.fieldErrors && <p className="text-sm text-danger-foreground">{error.message}</p>}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              {tc("cancel")}
            </Button>
            <Button type="submit" loading={pending} disabled={selected.length === 0}>
              {tc("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const DELIVERY_TONE = { pending: "info", succeeded: "success", failed: "warning", dead: "danger" } as const;

function DeliveriesSheet({ webhook, canEdit }: { webhook: WebhookRow; canEdit: boolean }) {
  const t = useTranslations("webhooks");
  const tc = useTranslations("common");
  const locale = useLocale() as "he" | "en";
  const [busy, start] = useTransition();
  const { data, reload } = useRemoteData(async () => {
    const res = await listDeliveriesAction({ id: webhook.id });
    if (!res.ok) {
      toast.error(res.error.message);
      return [];
    }
    return res.data;
  }, webhook.id);

  return (
    <SheetContent closeLabel={tc("close")} className="max-w-lg">
      <DialogTitle className="text-lg font-semibold">{t("deliveries")}</DialogTitle>
      <DialogDescription className="mt-1 truncate font-mono text-xs" dir="ltr">
        {webhook.url}
      </DialogDescription>
      <div className="mt-5 flex-1">
        {data === null ? (
          <div className="flex justify-center py-10">
            <Spinner label={tc("loading")} />
          </div>
        ) : data.length === 0 ? (
          <Alert tone="info">{t("noDeliveries")}</Alert>
        ) : (
          <ul className="space-y-2">
            {data.map((d) => (
              <li key={d.id} className="rounded-lg border border-border p-3 text-sm" data-testid="delivery-row">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="font-mono text-xs" dir="ltr">
                    {d.eventType}
                  </code>
                  <Badge tone={DELIVERY_TONE[d.status as keyof typeof DELIVERY_TONE] ?? "neutral"}>
                    {t(`deliveryStatus.${d.status}` as "deliveryStatus.pending")}
                  </Badge>
                  <span className="ms-auto text-xs text-muted-foreground">{formatDateTime(d.createdAt, locale)}</span>
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {t("attempts")}: {d.attempts}
                  {d.responseStatus !== null && (
                    <>
                      {" · "}
                      {t("response")}: <span dir="ltr">HTTP {d.responseStatus}</span>
                    </>
                  )}
                </p>
                {d.lastError && (
                  <p className="mt-1 break-all font-mono text-xs text-danger-foreground" dir="ltr">
                    {d.lastError}
                  </p>
                )}
                {canEdit && d.status !== "pending" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-2"
                    disabled={busy}
                    onClick={() =>
                      start(async () => {
                        const res = await redeliverAction({ id: d.id });
                        if (!res.ok) return void toast.error(res.error.message);
                        toast.success(t("redelivered"));
                        reload();
                      })
                    }
                  >
                    <RotateCw /> {t("redeliver")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </SheetContent>
  );
}

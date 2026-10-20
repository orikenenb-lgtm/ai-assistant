"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Check, Copy, KeyRound, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/controls";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, NativeSelect } from "@/components/ui/input";
import { Alert, Badge, Card, CardContent, EmptyState } from "@/components/ui/primitives";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/data/confirm-dialog";
import { formToObject, useServerAction } from "@/hooks/use-server-action";
import { formatDate, formatRelative } from "@/lib/format";
import { createApiKeyAction, revokeApiKeyAction } from "../actions";

export type ApiKeyRow = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  status: "active" | "revoked" | "expired";
};

const EXPIRY_OPTIONS = [30, 90, 365] as const;

export function CopyButton({ value, label }: { value: string; label: string }) {
  const tc = useTranslations("common");
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          toast.error(tc("retry"));
        }
      }}
    >
      {copied ? <Check /> : <Copy />} {copied ? tc("copied") : label}
    </Button>
  );
}

export function ApiKeysManager({ keys, scopes, canEdit }: { keys: ApiKeyRow[]; scopes: readonly string[]; canEdit: boolean }) {
  const t = useTranslations("apiKeys");
  const locale = useLocale() as "he" | "en";
  const router = useRouter();
  const [busy, start] = useTransition();

  const statusTone = { active: "success", revoked: "neutral", expired: "warning" } as const;

  return (
    <Card>
      <CardContent className="pt-6">
        {canEdit && (
          <div className="mb-4 flex justify-end">
            <CreateKeyDialog scopes={scopes} onDone={() => router.refresh()} />
          </div>
        )}
        {keys.length === 0 ? (
          <EmptyState icon={<KeyRound />} title={t("emptyTitle")} description={t("emptyBody")} />
        ) : (
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>{t("name")}</TH>
                <TH>{t("prefix")}</TH>
                <TH className="hidden lg:table-cell">{t("scopes")}</TH>
                <TH className="hidden md:table-cell">{t("lastUsed")}</TH>
                <TH className="hidden md:table-cell">{t("expiresAt")}</TH>
                <TH>{t("status")}</TH>
                <TH className="w-24">
                  <span className="sr-only">{t("revoke")}</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {keys.map((k) => (
                <TR key={k.id} data-testid="api-key-row">
                  <TD className="font-medium">{k.name}</TD>
                  <TD>
                    <code className="font-mono text-xs" dir="ltr">
                      {k.prefix}_…
                    </code>
                  </TD>
                  <TD className="hidden lg:table-cell">
                    <div className="flex max-w-xs flex-wrap gap-1">
                      {k.scopes.map((s) => (
                        <Badge key={s} tone="neutral">
                          {t(`scopeNames.${s}` as "scopeNames.contacts:read")}
                        </Badge>
                      ))}
                    </div>
                  </TD>
                  <TD className="hidden text-muted-foreground md:table-cell">{k.lastUsedAt ? formatRelative(k.lastUsedAt, locale) : t("never")}</TD>
                  <TD className="hidden text-muted-foreground md:table-cell">{k.expiresAt ? formatDate(k.expiresAt, locale) : t("noExpiry")}</TD>
                  <TD>
                    <Badge tone={statusTone[k.status]}>{t(k.status)}</Badge>
                  </TD>
                  <TD>
                    {canEdit && k.status !== "revoked" && (
                      <ConfirmDialog
                        trigger={
                          <Button variant="danger-ghost" size="sm" disabled={busy}>
                            {t("revoke")}
                          </Button>
                        }
                        title={t("revoke")}
                        description={t("revokeConfirm", { name: k.name })}
                        confirmLabel={t("revoke")}
                        onConfirm={() =>
                          start(async () => {
                            const res = await revokeApiKeyAction({ id: k.id });
                            if (!res.ok) return void toast.error(res.error.message);
                            toast.success(t("revoked"));
                            router.refresh();
                          })
                        }
                      />
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function CreateKeyDialog({ scopes, onDone }: { scopes: readonly string[]; onDone: () => void }) {
  const t = useTranslations("apiKeys");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>(["contacts:read"]);
  const [created, setCreated] = useState<string | null>(null);
  const { run, pending, fieldErrors, error, reset } = useServerAction(createApiKeyAction);

  const onOpenChange = (o: boolean) => {
    setOpen(o);
    if (!o) {
      if (created) onDone();
      setCreated(null);
      setSelected(["contacts:read"]);
      reset();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> {t("create")}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={tc("close")}>
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>{t("created")}</DialogTitle>
              <DialogDescription>{t("copyNow")}</DialogDescription>
            </DialogHeader>
            <Alert tone="warning">{t("copyNow")}</Alert>
            <code className="mt-4 block break-all rounded-lg bg-muted px-3 py-2 font-mono text-sm" dir="ltr" data-testid="new-api-key">
              {created}
            </code>
            <DialogFooter>
              <CopyButton value={created} label={t("copy")} />
              <Button onClick={() => onOpenChange(false)}>{t("done")}</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t("create")}</DialogTitle>
              <DialogDescription>{t("subtitle")}</DialogDescription>
            </DialogHeader>
            <form
              noValidate
              className="space-y-4"
              onSubmit={async (e) => {
                e.preventDefault();
                const data = formToObject(e.currentTarget);
                const res = await run({
                  name: data.name,
                  scopes: selected,
                  expiresInDays: data.expiresInDays ? Number(data.expiresInDays) : null,
                });
                if (res.ok) setCreated(res.data.key);
              }}
            >
              <Field label={t("name")} htmlFor="api-key-name" error={fieldErrors.name} required>
                <Input id="api-key-name" name="name" placeholder={t("namePlaceholder")} maxLength={80} required autoFocus />
              </Field>
              <fieldset className="space-y-2">
                <legend className="mb-1 text-sm font-medium">{t("scopes")}</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {scopes.map((s) => (
                    <label key={s} className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                      <Checkbox
                        checked={selected.includes(s)}
                        onCheckedChange={(c) => setSelected((cur) => (c === true ? [...cur, s] : cur.filter((x) => x !== s)))}
                        aria-label={s}
                      />
                      <span>{t(`scopeNames.${s}` as "scopeNames.contacts:read")}</span>
                    </label>
                  ))}
                </div>
                {fieldErrors.scopes && <p className="text-xs text-danger-foreground">{fieldErrors.scopes[0]}</p>}
              </fieldset>
              <Field label={t("expires")} htmlFor="api-key-expiry">
                <NativeSelect id="api-key-expiry" name="expiresInDays" defaultValue="">
                  <option value="">{t("noExpiry")}</option>
                  {EXPIRY_OPTIONS.map((d) => (
                    <option key={d} value={d}>
                      {t("days", { days: d })}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              {error && !error.fieldErrors && <p className="text-sm text-danger-foreground">{error.message}</p>}
              <DialogFooter>
                <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
                  {tc("cancel")}
                </Button>
                <Button type="submit" loading={pending} disabled={selected.length === 0}>
                  {tc("create")}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

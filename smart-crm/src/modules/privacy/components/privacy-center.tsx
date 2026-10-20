"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Download, FileDown, RefreshCw, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { AsyncCombobox, type ComboOption } from "@/components/data/async-combobox";
import { useServerAction } from "@/hooks/use-server-action";
import { formatDateTime } from "@/lib/format";
import { searchContactsAction } from "@/modules/crm/lookup-actions";
import { eraseContactAction, exportDownloadAction, requestContactExportAction, requestTenantDeletionAction, requestTenantExportAction } from "../actions";

type RequestRow = {
  id: string;
  type: "export" | "delete";
  subjectType: "contact" | "tenant";
  status: string;
  createdAt: Date;
  completedAt: Date | null;
  downloadable: boolean;
  requestedByName: string | null;
};

const STATUS_TONE: Record<string, "neutral" | "info" | "success" | "danger"> = {
  pending: "neutral",
  processing: "info",
  completed: "success",
  failed: "danger",
  canceled: "neutral",
};

export function ContactRequestsCard({ canEdit }: { canEdit: boolean }) {
  const t = useTranslations("privacy");
  const router = useRouter();
  const [contact, setContact] = useState<ComboOption | null>(null);
  const [busy, start] = useTransition();

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{t("contactSection")}</CardTitle>
          <CardDescription>{t("contactHelp")}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field label={t("selectContact")} htmlFor="privacy-contact" className="flex-1">
          <AsyncCombobox id="privacy-contact" value={contact} onChange={setContact} search={searchContactsAction} disabled={!canEdit} />
        </Field>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            disabled={!contact || !canEdit}
            loading={busy}
            onClick={() =>
              contact &&
              start(async () => {
                const res = await requestContactExportAction({ contactId: contact.id });
                if (!res.ok) return void toast.error(res.error.message);
                toast.success(t("exportRequested"));
                router.refresh();
              })
            }
          >
            <FileDown /> {t("exportContact")}
          </Button>
          {contact && canEdit && (
            <EraseContactDialog
              contact={contact}
              onDone={() => {
                setContact(null);
                router.refresh();
              }}
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function EraseContactDialog({ contact, onDone }: { contact: ComboOption; onDone: () => void }) {
  const t = useTranslations("privacy");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const { run, pending, fieldErrors } = useServerAction(eraseContactAction, { successMessage: t("erased") });
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        setTyped("");
      }}
    >
      <DialogTrigger asChild>
        <Button variant="danger-ghost">
          <Trash2 /> {t("eraseContact")}
        </Button>
      </DialogTrigger>
      <DialogContent size="sm" closeLabel={tc("close")}>
        <DialogHeader>
          <DialogTitle>{t("eraseTitle", { name: contact.name })}</DialogTitle>
          <DialogDescription>{t("eraseBody")}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          onSubmit={async (e) => {
            e.preventDefault();
            const res = await run({ contactId: contact.id, confirmation: typed });
            if (res.ok) {
              setOpen(false);
              onDone();
            }
          }}
        >
          <Field label={t("typeToConfirm", { name: contact.name })} htmlFor="erase-confirm" error={fieldErrors.confirmation}>
            <Input id="erase-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} dir="auto" autoComplete="off" />
          </Field>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" variant="danger" loading={pending} disabled={typed.trim() !== contact.name}>
              {t("erase")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DataRequestsCard({ requests, canEdit }: { requests: RequestRow[]; canEdit: boolean }) {
  const t = useTranslations("privacy");
  const tc = useTranslations("common");
  const locale = useLocale() as "he" | "en";
  const router = useRouter();
  const [busy, start] = useTransition();

  const download = (id: string) =>
    start(async () => {
      const res = await exportDownloadAction({ id });
      if (!res.ok) return void toast.error(res.error.message);
      window.location.assign(res.data.url);
    });

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{t("tenantSection")}</CardTitle>
          <CardDescription>{t("requests")}</CardDescription>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="icon-sm" aria-label={tc("retry")} onClick={() => router.refresh()}>
            <RefreshCw />
          </Button>
          {canEdit && (
            <Button
              variant="secondary"
              loading={busy}
              onClick={() =>
                start(async () => {
                  const res = await requestTenantExportAction();
                  if (!res.ok) return void toast.error(res.error.message);
                  toast.success(t("exportRequested"));
                  router.refresh();
                })
              }
            >
              <FileDown /> {t("exportTenant")}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {requests.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t("noRequests")}</p>
        ) : (
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>{tc("date")}</TH>
                <TH>{t("kind")}</TH>
                <TH className="hidden sm:table-cell">{t("requestedBy")}</TH>
                <TH>{tc("status")}</TH>
                <TH className="w-28">
                  <span className="sr-only">{t("download")}</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {requests.map((r) => (
                <TR key={r.id} data-testid="data-request-row">
                  <TD className="text-muted-foreground">{formatDateTime(r.createdAt, locale)}</TD>
                  <TD>
                    {t(`type.${r.type}`)} · {t(`subject.${r.subjectType}`)}
                  </TD>
                  <TD className="hidden text-muted-foreground sm:table-cell">{r.requestedByName ?? "—"}</TD>
                  <TD>
                    <Badge tone={STATUS_TONE[r.status] ?? "neutral"}>{t(`status.${r.status}` as "status.pending")}</Badge>
                  </TD>
                  <TD>
                    {r.downloadable && (
                      <Button variant="ghost" size="sm" disabled={busy} onClick={() => download(r.id)}>
                        <Download /> {t("download")}
                      </Button>
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

export function DeleteTenantCard({ orgName, graceDays }: { orgName: string; graceDays: number }) {
  const t = useTranslations("privacy");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const router = useRouter();
  const { run, pending, fieldErrors } = useServerAction(requestTenantDeletionAction);
  return (
    <Card className="border-danger/40">
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2 text-danger-foreground">
            <TriangleAlert className="size-4" /> {t("danger")}
          </CardTitle>
          <CardDescription>{t("deleteTenantBody", { days: graceDays })}</CardDescription>
        </div>
        <Dialog
          open={open}
          onOpenChange={(o) => {
            setOpen(o);
            setTyped("");
          }}
        >
          <DialogTrigger asChild>
            <Button variant="danger">{t("deleteTenant")}</Button>
          </DialogTrigger>
          <DialogContent size="sm" closeLabel={tc("close")}>
            <DialogHeader>
              <DialogTitle>{t("deleteTenant")}</DialogTitle>
              <DialogDescription>{t("deleteTenantBody", { days: graceDays })}</DialogDescription>
            </DialogHeader>
            <form
              noValidate
              onSubmit={async (e) => {
                e.preventDefault();
                const res = await run({ confirmName: typed });
                if (res.ok) {
                  router.replace("/");
                  router.refresh();
                }
              }}
            >
              <Field label={t("deleteTenantConfirm", { name: orgName })} htmlFor="delete-tenant-confirm" error={fieldErrors.confirmName}>
                <Input id="delete-tenant-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} dir="auto" autoComplete="off" />
              </Field>
              <DialogFooter>
                <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                  {tc("cancel")}
                </Button>
                <Button type="submit" variant="danger" loading={pending} disabled={typed.trim() !== orgName}>
                  {t("deleteTenantButton")}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </CardHeader>
    </Card>
  );
}

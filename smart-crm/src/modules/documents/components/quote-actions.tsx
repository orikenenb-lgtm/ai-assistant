"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Ban, Check, Copy, CopyPlus, Download, ExternalLink, FileText, Link2, Send, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/controls";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Label, Textarea } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/data/confirm-dialog";
import { useServerAction } from "@/hooks/use-server-action";
import {
  createInvoiceAction,
  deleteQuoteAction,
  duplicateQuoteAction,
  regenerateQuoteLinkAction,
  sendQuoteAction,
  setQuoteStatusAction,
} from "../actions";
import type { QuoteStatus } from "../status";

export type QuoteActionsProps = {
  quote: { id: string; number: number; status: QuoteStatus };
  contactEmail: string | null;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canInvoice: boolean;
  invoicingLabel: string | null;
};

/** Header actions on the quote page; which ones show depends on status and permissions. */
export function QuoteActions({ quote, contactEmail, canCreate, canUpdate, canDelete, canInvoice, invoicingLabel }: QuoteActionsProps) {
  const t = useTranslations("quotes");
  const tc = useTranslations("common");
  const router = useRouter();
  // Lives here, not in the send dialog: sending re-renders the page without that dialog.
  const [issued, setIssued] = useState<IssuedLink | null>(null);
  const duplicate = useServerAction(duplicateQuoteAction, { successMessage: t("actions.duplicated") });
  const invoice = useServerAction(createInvoiceAction);
  const awaiting = quote.status === "sent" || quote.status === "viewed";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button asChild variant="secondary" size="sm">
        <a href={`/api/quotes/${quote.id}/pdf`} download data-testid="quote-pdf">
          <Download /> {t("actions.downloadPdf")}
        </a>
      </Button>

      {quote.status === "draft" && canUpdate && <SendDialog quoteId={quote.id} defaultEmail={contactEmail} onSent={setIssued} />}

      {awaiting && canUpdate && (
        <>
          <DecisionDialog quoteId={quote.id} status="accepted" />
          <DecisionDialog quoteId={quote.id} status="rejected" />
          <ConfirmDialog
            tone="primary"
            trigger={
              <Button variant="ghost" size="sm">
                <Link2 /> {t("actions.newLink")}
              </Button>
            }
            title={t("actions.newLink")}
            description={t("actions.newLinkBody")}
            confirmLabel={t("actions.newLink")}
            onConfirm={async () => {
              const res = await regenerateQuoteLinkAction({ id: quote.id });
              if (!res.ok) return void toast.error(res.error.message);
              setIssued({ url: res.data.publicUrl, emailedTo: null, kind: "regenerated" });
            }}
          />
        </>
      )}

      {quote.status === "accepted" && canUpdate && canInvoice && (
        <Button
          variant="soft"
          size="sm"
          loading={invoice.pending}
          onClick={async () => {
            const res = await invoice.run({ id: quote.id });
            if (!res.ok) return;
            toast.success(t("actions.invoiceCreated", { id: res.data.externalId }));
            router.refresh();
          }}
          title={invoicingLabel ?? undefined}
        >
          <FileText /> {t("actions.createInvoice")}
        </Button>
      )}

      {canCreate && (
        <Button
          variant="ghost"
          size="sm"
          loading={duplicate.pending}
          onClick={async () => {
            const res = await duplicate.run({ id: quote.id });
            if (res.ok) router.push(`/quotes/${res.data.id}`);
          }}
        >
          <CopyPlus /> {t("actions.duplicate")}
        </Button>
      )}

      {(awaiting || (quote.status === "draft" && !canDelete)) && canUpdate && (
        <ConfirmDialog
          trigger={
            <Button variant="danger-ghost" size="sm">
              <Ban /> {t("actions.cancel")}
            </Button>
          }
          title={t("actions.cancel")}
          description={t("actions.cancelConfirm")}
          confirmLabel={t("actions.cancel")}
          onConfirm={async () => {
            const res = await setQuoteStatusAction({ id: quote.id, status: "canceled" });
            if (!res.ok) return void toast.error(res.error.message);
            router.refresh();
          }}
        />
      )}

      {quote.status === "draft" && canDelete && (
        <ConfirmDialog
          trigger={
            <Button variant="danger-ghost" size="icon-sm" aria-label={tc("delete")}>
              <Trash2 />
            </Button>
          }
          description={t("actions.deleteConfirm", { number: quote.number })}
          onConfirm={async () => {
            const res = await deleteQuoteAction({ id: quote.id });
            if (!res.ok) return void toast.error(res.error.message);
            toast.success(tc("deleted"));
            router.push("/quotes");
          }}
        />
      )}

      <Dialog open={Boolean(issued)} onOpenChange={(o) => !o && setIssued(null)}>
        <DialogContent closeLabel={tc("close")} data-testid="quote-link-dialog">
          <DialogHeader>
            <DialogTitle>{issued?.kind === "sent" ? t("actions.sentTitle") : t("actions.newLink")}</DialogTitle>
            <DialogDescription>{t("actions.sentBody")}</DialogDescription>
          </DialogHeader>
          {issued?.emailedTo && (
            <p className="mb-3 text-sm text-success-foreground">
              <Check className="me-1 inline size-4" />
              {t("actions.emailed", { email: issued.emailedTo })}
            </p>
          )}
          {issued && <PublicLink url={issued.url} />}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setIssued(null)}>
              {tc("close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type IssuedLink = { url: string; emailedTo: string | null; kind: "sent" | "regenerated" };

function SendDialog({ quoteId, defaultEmail, onSent }: { quoteId: string; defaultEmail: string | null; onSent: (link: IssuedLink) => void }) {
  const t = useTranslations("quotes");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [withEmail, setWithEmail] = useState(Boolean(defaultEmail));
  const [email, setEmail] = useState(defaultEmail ?? "");
  const send = useServerAction(sendQuoteAction);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" data-testid="quote-send">
          <Send /> {t("actions.send")}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={tc("close")}>
        <form
          noValidate
          onSubmit={async (e) => {
            e.preventDefault();
            const emailTo = withEmail ? email.trim() : null;
            const res = await send.run({ id: quoteId, emailTo });
            if (!res.ok) return;
            setOpen(false);
            onSent({ url: res.data.publicUrl, emailedTo: res.data.emailed ? emailTo : null, kind: "sent" });
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("actions.sendTitle")}</DialogTitle>
            <DialogDescription>{t("actions.sendBody")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Checkbox id="send-email" checked={withEmail} onCheckedChange={(v) => setWithEmail(v === true)} />
              <Label htmlFor="send-email">{t("actions.sendEmail")}</Label>
            </div>
            {withEmail && (
              <Field label={t("actions.emailTo")} htmlFor="emailTo" error={send.fieldErrors.emailTo}>
                <Input id="emailTo" type="email" value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" autoComplete="off" />
              </Field>
            )}
            <p className="text-xs text-muted-foreground">{t("disclaimer")}</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={send.pending}>
              {tc("cancel")}
            </Button>
            <Button type="submit" loading={send.pending} data-testid="quote-send-confirm">
              <Send /> {t("actions.confirmSend")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DecisionDialog({ quoteId, status }: { quoteId: string; status: "accepted" | "rejected" }) {
  const t = useTranslations("quotes");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const action = useServerAction(setQuoteStatusAction);
  const label = status === "accepted" ? t("actions.markAccepted") : t("actions.markRejected");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={status === "accepted" ? "soft" : "ghost"} size="sm">
          {status === "accepted" ? <Check /> : <X />} {label}
        </Button>
      </DialogTrigger>
      <DialogContent size="sm" closeLabel={tc("close")}>
        <form
          noValidate
          onSubmit={async (e) => {
            e.preventDefault();
            const res = await action.run({ id: quoteId, status, note: note.trim() || null });
            if (!res.ok) return;
            setOpen(false);
            setNote("");
            router.refresh();
          }}
        >
          <DialogHeader>
            <DialogTitle>{label}</DialogTitle>
          </DialogHeader>
          <Field label={t("actions.decisionNote")} htmlFor={`note-${status}`}>
            <Textarea id={`note-${status}`} value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={1000} dir="auto" />
          </Field>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={action.pending}>
              {tc("cancel")}
            </Button>
            <Button type="submit" variant={status === "accepted" ? "primary" : "danger"} loading={action.pending}>
              {label}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The raw customer link — shown once right after it's issued (only its hash is stored). */
function PublicLink({ url }: { url: string }) {
  const t = useTranslations("quotes");
  const tc = useTranslations("common");
  return (
    <div className="flex items-center gap-2">
      <Input readOnly value={url} dir="ltr" onFocus={(e) => e.currentTarget.select()} aria-label={t("actions.copyLink")} data-testid="quote-public-link" />
      <Button
        type="button"
        variant="secondary"
        size="icon"
        aria-label={t("actions.copyLink")}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            toast.success(tc("copied"));
          } catch {
            toast.error(url);
          }
        }}
      >
        <Copy />
      </Button>
      <Button asChild variant="ghost" size="icon" aria-label={tc("open")}>
        <a href={url} target="_blank" rel="noopener noreferrer">
          <ExternalLink />
        </a>
      </Button>
    </div>
  );
}

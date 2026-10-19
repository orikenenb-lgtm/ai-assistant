"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { ShieldCheck, ShieldOff, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@/components/ui/primitives";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/controls";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/data/confirm-dialog";
import { AttachmentsPanel, LogActivityDialog, NotesPanel, TimelinePanel } from "@/components/data/entity-panels";
import { TagPicker, type TagOption } from "@/components/data/tag-picker";
import { formatDateTime } from "@/lib/format";
import { deleteContactAction, setConsentAction, setContactTagsAction } from "../contacts/actions";

export function ContactHeaderActions({ contactId, name, canDelete }: { contactId: string; name: string; canDelete: boolean }) {
  const t = useTranslations("contacts");
  const tc = useTranslations("common");
  const router = useRouter();
  if (!canDelete) return null;
  return (
    <ConfirmDialog
      trigger={
        <Button variant="danger-ghost" size="icon-sm" aria-label={tc("delete")}>
          <Trash2 />
        </Button>
      }
      description={t("deleteConfirm", { name })}
      onConfirm={async () => {
        const res = await deleteContactAction({ id: contactId });
        if (!res.ok) return void toast.error(res.error.message);
        toast.success(tc("deleted"));
        router.push("/contacts");
      }}
    />
  );
}

export function ContactTagsEditor({ contactId, allTags, initial, canEdit }: { contactId: string; allTags: TagOption[]; initial: string[]; canEdit: boolean }) {
  const [tags, setTags] = useState(allTags);
  const [value, setValue] = useState(initial);
  if (!canEdit) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {allTags.filter((t) => initial.includes(t.id)).map((t) => (
          <Badge key={t.id} tone="outline">
            {t.name}
          </Badge>
        ))}
      </div>
    );
  }
  return (
    <TagPicker
      allTags={tags}
      value={value}
      onChange={async (ids, created) => {
        if (created) setTags((p) => [...p, created]);
        const prev = value;
        setValue(ids);
        const res = await setContactTagsAction({ contactId, tagIds: ids });
        if (!res.ok) {
          setValue(prev);
          toast.error(res.error.message);
        }
      }}
    />
  );
}

type ConsentRow = { id: string; status: string; source: string; evidence: string | null; by: string | null; at: Date };

export function ConsentCard({ contactId, status, canEdit, history }: { contactId: string; status: "unknown" | "opted_in" | "opted_out"; canEdit: boolean; history: ConsentRow[] }) {
  const t = useTranslations("contacts");
  const tc = useTranslations("common");
  const locale = useLocale() as "he" | "en";
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [evidence, setEvidence] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async (next: "opted_in" | "opted_out") => {
    setBusy(true);
    const res = await setConsentAction({ contactId, status: next, evidence: evidence || undefined });
    setBusy(false);
    if (!res.ok) return void toast.error(res.error.message);
    toast.success(tc("saved"));
    setOpen(false);
    router.refresh();
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("consentTitle")}</CardTitle>
        <Badge tone={status === "opted_in" ? "success" : status === "opted_out" ? "danger" : "neutral"}>{t(`consentStatus.${status}`)}</Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">{t("consentHelp")}</p>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            {status !== "opted_in" && (
              <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="secondary">
                    <ShieldCheck /> {t("markOptedIn")}
                  </Button>
                </DialogTrigger>
                <DialogContent size="sm" closeLabel={tc("close")}>
                  <DialogHeader>
                    <DialogTitle>{t("markOptedIn")}</DialogTitle>
                    <DialogDescription>{t("optInEvidenceHelp")}</DialogDescription>
                  </DialogHeader>
                  <Field label={t("evidence")} htmlFor="evidence" required>
                    <Textarea id="evidence" value={evidence} onChange={(e) => setEvidence(e.target.value)} rows={3} maxLength={1000} dir="auto" />
                  </Field>
                  <DialogFooter>
                    <Button variant="secondary" onClick={() => setOpen(false)}>
                      {tc("cancel")}
                    </Button>
                    <Button loading={busy} disabled={evidence.trim().length < 3} onClick={() => save("opted_in")}>
                      {tc("save")}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
            {status !== "opted_out" && (
              <Button size="sm" variant="danger-ghost" loading={busy} onClick={() => save("opted_out")}>
                <ShieldOff /> {t("markOptedOut")}
              </Button>
            )}
          </div>
        )}
        {history.length > 0 && (
          <ul className="space-y-2 border-t border-border pt-3 text-xs text-muted-foreground">
            {history.slice(0, 5).map((h) => (
              <li key={h.id}>
                <span className="font-medium text-foreground">{t(`consentStatus.${h.status}` as "consentStatus.opted_in")}</span> · {t(`consentSource.${h.source}` as "consentSource.manual")} ·{" "}
                {h.by ?? "—"} · {formatDateTime(h.at, locale)}
                {h.evidence && <p className="mt-0.5 italic" dir="auto">“{h.evidence}”</p>}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

type DealRow = { id: string; title: string; value: string; status: string; stage: string };
type TaskRow = { id: string; title: string; status: string; priority: string; due: string | null };

export function ContactDetailTabs({
  contactId,
  currentUserId,
  canEdit,
  canModerate,
  counts,
  deals,
  tasks,
}: {
  contactId: string;
  currentUserId: string;
  canEdit: boolean;
  canModerate: boolean;
  counts: { deals: number; tasks: number };
  deals: DealRow[];
  tasks: TaskRow[];
}) {
  const t = useTranslations("crm");
  const [refresh, setRefresh] = useState(0);
  const bump = () => setRefresh((n) => n + 1);
  return (
    <Card className="p-4 sm:p-5">
      <Tabs defaultValue="timeline">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList className="max-w-full overflow-x-auto">
            <TabsTrigger value="timeline">{t("tabs.timeline")}</TabsTrigger>
            <TabsTrigger value="notes">{t("tabs.notes")}</TabsTrigger>
            <TabsTrigger value="deals">
              {t("tabs.deals")} {counts.deals > 0 && <span className="text-xs text-muted-foreground">({counts.deals})</span>}
            </TabsTrigger>
            <TabsTrigger value="tasks">
              {t("tabs.tasks")} {counts.tasks > 0 && <span className="text-xs text-muted-foreground">({counts.tasks})</span>}
            </TabsTrigger>
            <TabsTrigger value="files">{t("tabs.files")}</TabsTrigger>
          </TabsList>
          {canEdit && <LogActivityDialog kind="contact" entityId={contactId} onLogged={bump} />}
        </div>
        <TabsContent value="timeline">
          <TimelinePanel kind="contact" entityId={contactId} refreshKey={refresh} />
        </TabsContent>
        <TabsContent value="notes">
          <NotesPanel kind="contact" entityId={contactId} currentUserId={currentUserId} canModerate={canModerate} onChange={bump} />
        </TabsContent>
        <TabsContent value="deals">
          {deals.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("noDeals")}</p>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {deals.map((d) => (
                <li key={d.id}>
                  <Link href={`/deals/${d.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-accent">
                    <span className="font-medium">{d.title}</span>
                    <span className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Badge tone={d.status === "won" ? "success" : d.status === "lost" ? "danger" : "primary"}>{d.stage}</Badge>
                      <span className="tabular">{d.value}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Button asChild variant="link" className="mt-3">
            <Link href={`/deals?new=1&contact=${contactId}`}>{t("newDeal")}</Link>
          </Button>
        </TabsContent>
        <TabsContent value="tasks">
          {tasks.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("noTasks")}</p>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {tasks.map((x) => (
                <li key={x.id}>
                  <Link href={`/tasks?task=${x.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-accent">
                    <span className={x.status === "done" ? "text-muted-foreground line-through" : "font-medium"}>{x.title}</span>
                    <span className="text-sm text-muted-foreground">{x.due ?? ""}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Button asChild variant="link" className="mt-3">
            <Link href={`/tasks?new=1&contact=${contactId}`}>{t("newTask")}</Link>
          </Button>
        </TabsContent>
        <TabsContent value="files">
          <AttachmentsPanel kind="contact" entityId={contactId} canEdit={canEdit} onChange={bump} />
        </TabsContent>
      </Tabs>
    </Card>
  );
}

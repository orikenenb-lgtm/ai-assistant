"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { useRemoteData } from "@/hooks/use-remote-data";
import {
  Bot,
  CalendarCheck,
  CheckCircle2,
  FileText,
  Handshake,
  Mail,
  MessageCircle,
  Paperclip,
  Phone,
  Pin,
  PinOff,
  Sparkles,
  StickyNote,
  Trash2,
  Trophy,
  Upload,
  UserPlus,
  Users,
  Workflow,
  XCircle,
  ShieldCheck,
  GitMerge,
  Download,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Avatar, EmptyState, Skeleton } from "@/components/ui/primitives";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ConfirmDialog } from "./confirm-dialog";
import { formatDateTime, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { formToObject, useServerAction } from "@/hooks/use-server-action";
import {
  addNoteAction,
  deleteAttachmentAction,
  deleteNoteAction,
  listAttachmentsAction,
  listNotesAction,
  listTimelineAction,
  logActivityAction,
  updateNoteAction,
} from "@/modules/crm/entity-actions";
import type { TimelineItem } from "@/modules/crm/activities";

export type EntityKind = "contact" | "company" | "deal" | "lead";

const ACTIVITY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  note: StickyNote,
  call: Phone,
  meeting: Users,
  email: Mail,
  whatsapp_in: MessageCircle,
  whatsapp_out: MessageCircle,
  task_created: CalendarCheck,
  task_completed: CheckCircle2,
  deal_created: Handshake,
  deal_stage_changed: Handshake,
  deal_won: Trophy,
  deal_lost: XCircle,
  lead_created: Sparkles,
  lead_converted: Sparkles,
  contact_created: UserPlus,
  company_created: UserPlus,
  file_uploaded: Paperclip,
  quote_created: FileText,
  quote_sent: FileText,
  quote_status: FileText,
  automation: Workflow,
  ai: Bot,
  consent_changed: ShieldCheck,
  merged: GitMerge,
};

const TONES: Record<string, string> = {
  deal_won: "bg-success-soft text-success-foreground",
  deal_lost: "bg-danger-soft text-danger-foreground",
  whatsapp_in: "bg-success-soft text-success-foreground",
  whatsapp_out: "bg-success-soft text-success-foreground",
  ai: "bg-ai-soft text-ai-foreground",
  automation: "bg-ai-soft text-ai-foreground",
};

export function TimelinePanel({ kind, entityId, refreshKey = 0 }: { kind: EntityKind; entityId: string; refreshKey?: number }) {
  const t = useTranslations("crm");
  const locale = useLocale() as "he" | "en";
  const [extra, setExtra] = useState<{ key: string; items: TimelineItem[]; hasMore: boolean } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const key = `${kind}:${entityId}:${refreshKey}`;
  const { data: first } = useRemoteData(async () => {
    const res = await listTimelineAction({ kind, entityId });
    if (!res.ok) {
      toast.error(res.error.message);
      return null;
    }
    return res.data;
  }, key);
  const more = extra?.key === key ? extra : null;
  const items = first ? [...first.items, ...(more?.items ?? [])] : null;
  const hasMore = more ? more.hasMore : (first?.hasMore ?? false);

  const loadMore = async () => {
    if (!items?.length) return;
    setLoadingMore(true);
    const res = await listTimelineAction({ kind, entityId, before: items[items.length - 1].occurredAt });
    setLoadingMore(false);
    if (!res.ok) return void toast.error(res.error.message);
    setExtra({ key, items: [...(more?.items ?? []), ...res.data.items], hasMore: res.data.hasMore });
  };

  if (items === null) return <PanelSkeleton />;
  if (items.length === 0) return <EmptyState title={t("timelineEmpty")} className="py-10" />;

  return (
    <div>
      <ol className="relative space-y-5 border-s border-border ps-6">
        {items.map((a) => {
          const Icon = ACTIVITY_ICONS[a.type] ?? StickyNote;
          return (
            <li key={a.id} className="relative">
              <span
                className={cn(
                  "absolute -start-[37px] flex size-7 items-center justify-center rounded-full border-4 border-background bg-muted text-muted-foreground",
                  TONES[a.type],
                )}
              >
                <Icon className="size-3.5" />
              </span>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <p className="text-sm font-medium">
                  {t(`activity.${a.type}` as "activity.note")}
                  {a.subject && <span className="font-normal text-muted-foreground"> · {a.subject}</span>}
                </p>
                <time className="text-xs text-muted-foreground" dateTime={new Date(a.occurredAt).toISOString()} title={formatDateTime(a.occurredAt, locale)}>
                  {formatRelative(a.occurredAt, locale)}
                </time>
              </div>
              {a.body && <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground" dir="auto">{a.body}</p>}
              <p className="mt-1 text-xs text-muted-foreground">
                {a.actorName ?? t(`actor.${a.actorType}` as "actor.system")}
                {a.durationMinutes ? ` · ${t("minutes", { n: a.durationMinutes })}` : ""}
                {a.outcome ? ` · ${a.outcome}` : ""}
              </p>
            </li>
          );
        })}
      </ol>
      {hasMore && (
        <Button
          variant="secondary"
          size="sm"
          className="mt-4"
          loading={loadingMore}
          onClick={loadMore}
        >
          {t("loadMore")}
        </Button>
      )}
    </div>
  );
}

export function NotesPanel({ kind, entityId, currentUserId, canModerate, onChange }: { kind: EntityKind; entityId: string; currentUserId: string; canModerate: boolean; onChange?: () => void }) {
  const t = useTranslations("crm");
  const tc = useTranslations("common");
  const locale = useLocale() as "he" | "en";
  const formRef = useRef<HTMLFormElement>(null);
  const add = useServerAction(addNoteAction);
  const { data: notes, reload: load } = useRemoteData(async () => {
    const res = await listNotesAction({ kind, entityId });
    return res.ok ? res.data : null;
  }, `${kind}:${entityId}`);

  return (
    <div className="space-y-4">
      <form
        ref={formRef}
        className="space-y-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const res = await add.run({ kind, entityId, ...formToObject(e.currentTarget) });
          if (res.ok) {
            formRef.current?.reset();
            load();
            onChange?.();
          }
        }}
      >
        <Textarea name="body" placeholder={t("notePlaceholder")} aria-label={t("addNote")} rows={3} required maxLength={10000} dir="auto" />
        <div className="flex justify-end">
          <Button type="submit" size="sm" loading={add.pending}>
            {t("addNote")}
          </Button>
        </div>
      </form>
      {notes === null ? (
        <PanelSkeleton />
      ) : notes.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t("notesEmpty")}</p>
      ) : (
        <ul className="space-y-3">
          {notes.map((n) => {
            const editable = n.authorId === currentUserId || canModerate;
            return (
              <li key={n.id} className={cn("rounded-xl border border-border bg-surface p-4", n.pinned && "border-warning/50 bg-warning-soft/40")}>
                <div className="flex items-start gap-3">
                  <Avatar name={n.authorName} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {n.authorName ?? "—"} <span className="font-normal text-muted-foreground">· {formatRelative(n.createdAt, locale)}</span>
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm" dir="auto">
                      {n.body}
                    </p>
                  </div>
                  {editable && (
                    <div className="flex shrink-0 gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={n.pinned ? t("unpin") : t("pin")}
                        onClick={async () => {
                          await updateNoteAction({ id: n.id, pinned: !n.pinned });
                          load();
                        }}
                      >
                        {n.pinned ? <PinOff /> : <Pin />}
                      </Button>
                      <ConfirmDialog
                        trigger={
                          <Button variant="danger-ghost" size="icon-sm" aria-label={tc("delete")}>
                            <Trash2 />
                          </Button>
                        }
                        onConfirm={async () => {
                          const res = await deleteNoteAction({ id: n.id });
                          if (!res.ok) toast.error(res.error.message);
                          load();
                        }}
                      />
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function AttachmentsPanel({ kind, entityId, canEdit, onChange }: { kind: EntityKind; entityId: string; canEdit: boolean; onChange?: () => void }) {
  const t = useTranslations("crm");
  const tc = useTranslations("common");
  const locale = useLocale() as "he" | "en";
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { data: files, reload: load } = useRemoteData(async () => {
    const res = await listAttachmentsAction({ kind, entityId });
    return res.ok ? res.data : null;
  }, `${kind}:${entityId}`);

  const upload = async (file: File) => {
    setUploading(true);
    const body = new FormData();
    body.set("file", file);
    body.set("entityType", kind);
    body.set("entityId", entityId);
    const res = await fetch("/api/attachments", { method: "POST", body });
    setUploading(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      toast.error(data.error && data.error.startsWith("files.") ? t(data.error.replace("files.", "fileErrors.") as "fileErrors.tooLarge") : t("uploadFailed"));
      return;
    }
    toast.success(t("uploaded"));
    load();
    onChange?.();
  };

  return (
    <div className="space-y-4">
      {canEdit && (
        <div
          className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files[0];
            if (f) void upload(f);
          }}
        >
          <Upload className="size-5" />
          <p>{t("dropFiles")}</p>
          <input ref={inputRef} type="file" className="sr-only" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} aria-label={t("chooseFile")} />
          <Button size="sm" variant="secondary" loading={uploading} onClick={() => inputRef.current?.click()}>
            {t("chooseFile")}
          </Button>
          <p className="text-xs">{t("fileLimits")}</p>
        </div>
      )}
      {files === null ? (
        <PanelSkeleton />
      ) : files.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">{t("filesEmpty")}</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-3 px-4 py-3">
              <Paperclip className="size-4 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium" dir="auto">
                  {f.fileName}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatBytes(f.sizeBytes)} · {f.uploadedByName ?? "—"} · {formatRelative(f.createdAt, locale)}
                </p>
              </div>
              <Button asChild variant="ghost" size="icon-sm" aria-label={t("download")}>
                <a href={`/api/files/${f.id}`}>
                  <Download />
                </a>
              </Button>
              {canEdit && (
                <ConfirmDialog
                  trigger={
                    <Button variant="danger-ghost" size="icon-sm" aria-label={tc("delete")}>
                      <Trash2 />
                    </Button>
                  }
                  onConfirm={async () => {
                    const res = await deleteAttachmentAction({ id: f.id });
                    if (!res.ok) toast.error(res.error.message);
                    load();
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function LogActivityDialog({ kind, entityId, onLogged }: { kind: EntityKind; entityId: string; onLogged?: () => void }) {
  const t = useTranslations("crm");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const { run, pending, fieldErrors } = useServerAction(logActivityAction, { successMessage: t("activityLogged") });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <Phone /> {t("logActivity")}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={tc("close")}>
        <DialogHeader>
          <DialogTitle>{t("logActivity")}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const data = formToObject(e.currentTarget);
            const res = await run({ kind, entityId, ...data, occurredAt: data.occurredAt ? new Date(data.occurredAt).toISOString() : undefined });
            if (res.ok) {
              setOpen(false);
              onLogged?.();
            }
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("activityType")} htmlFor="type">
              <NativeSelect id="type" name="type" defaultValue="call">
                <option value="call">{t("activity.call")}</option>
                <option value="meeting">{t("activity.meeting")}</option>
                <option value="email">{t("activity.email")}</option>
              </NativeSelect>
            </Field>
            <Field label={t("when")} htmlFor="occurredAt">
              <Input id="occurredAt" name="occurredAt" type="datetime-local" />
            </Field>
          </div>
          <Field label={t("subject")} htmlFor="subject" error={fieldErrors.subject} required>
            <Input id="subject" name="subject" required maxLength={300} />
          </Field>
          <Field label={tc("description")} htmlFor="body">
            <Textarea id="body" name="body" rows={3} maxLength={5000} dir="auto" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("durationMinutes")} htmlFor="durationMinutes" error={fieldErrors.durationMinutes}>
              <Input id="durationMinutes" name="durationMinutes" type="number" min={0} max={1440} />
            </Field>
            <Field label={t("outcome")} htmlFor="outcome">
              <Input id="outcome" name="outcome" maxLength={100} />
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" loading={pending}>
              {tc("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PanelSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-14 w-3/4" />
    </div>
  );
}

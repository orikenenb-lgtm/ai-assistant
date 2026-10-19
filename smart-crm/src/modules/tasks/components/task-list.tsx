"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Bell, Building2, CalendarClock, Handshake, MoreHorizontal, Play, RotateCcw, Sparkles, Trash2, User, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/controls";
import { Avatar, Badge } from "@/components/ui/primitives";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/menu";
import { ConfirmDialog } from "@/components/data/confirm-dialog";
import { cn } from "@/lib/utils";
import { formatDateTime, formatTime } from "@/lib/format";
import { dateKey, toLocalInput } from "@/modules/calendar/tz";
import type { TaskListItem } from "../service";
import { deleteTaskAction, setTaskStatusAction } from "../actions";
import { TaskFormDialog, reminderFromInstants, type TaskFormValues } from "./task-form-dialog";

const PRIORITY_TONE = { low: "neutral", medium: "info", high: "warning", urgent: "danger" } as const;
const LINK_ICON = { contact: User, company: Building2, deal: Handshake, lead: Sparkles } as const;
const LINK_HREF = { contact: "/contacts/", company: "/companies/", deal: "/deals/", lead: "/leads/" } as const;

type Common = {
  members: { userId: string; fullName: string }[];
  currentUserId: string;
  canAssignOthers: boolean;
  timezone: string;
};

export function toFormValues(task: TaskListItem, tz: string): TaskFormValues {
  const rem = reminderFromInstants(task.dueAt ? new Date(task.dueAt) : null, task.remindAt ? new Date(task.remindAt) : null, tz);
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    priority: task.priority,
    status: task.status,
    dueAt: task.dueAt ? toLocalInput(new Date(task.dueAt), tz) : null,
    reminder: rem.reminder,
    remindAt: rem.remindAt,
    assigneeId: task.assigneeId,
    isTeamTask: task.isTeamTask,
    link: task.link ? { kind: task.link.kind, option: { id: task.link.id, name: task.link.name } } : null,
  };
}

function DueLabel({ task, tz, now }: { task: TaskListItem; tz: string; now: number }) {
  const t = useTranslations("tasks");
  const locale = useLocale() as "he" | "en";
  if (!task.dueAt) return <span className="text-muted-foreground">{t("noDue")}</span>;
  const due = new Date(task.dueAt);
  const open = task.status === "open" || task.status === "in_progress";
  const overdue = open && due.getTime() < now;
  const today = dateKey(due, tz) === dateKey(new Date(now), tz);
  return (
    <span className={cn("inline-flex items-center gap-1", overdue ? "font-medium text-danger-foreground" : today && open ? "font-medium text-warning-foreground" : "text-muted-foreground")}>
      <CalendarClock className="size-3.5" />
      {today ? `${t("dueToday")} ${formatTime(due, locale, tz)}` : formatDateTime(due, locale, tz)}
      {overdue && <span className="sr-only"> ({t("overdueBy")})</span>}
    </span>
  );
}

function TaskRow({
  task,
  common,
  canDelete,
  readOnly,
  onEdit,
  now,
}: {
  task: TaskListItem;
  common: Common;
  canDelete: boolean;
  readOnly: boolean;
  onEdit: () => void;
  now: number;
}) {
  const t = useTranslations("tasks");
  const tc = useTranslations("common");
  const router = useRouter();
  const [status, setStatus] = useState(task.status);
  const [busy, setBusy] = useState(false);
  const done = status === "done";
  const LinkIcon = task.link ? LINK_ICON[task.link.kind] : null;

  const changeStatus = async (next: TaskListItem["status"]) => {
    const prev = status;
    setStatus(next); // optimistic
    setBusy(true);
    const res = await setTaskStatusAction({ id: task.id, status: next });
    setBusy(false);
    if (!res.ok) {
      setStatus(prev); // rollback
      toast.error(res.error.message);
      return;
    }
    toast.success(next === "done" ? t("markedDone") : t("reopened"));
    router.refresh();
  };

  return (
    <li className={cn("flex items-start gap-3 px-4 py-3 transition-colors hover:bg-accent/40", done && "opacity-70")} data-testid="task-row">
      <Checkbox
        className="mt-0.5 size-5 rounded-full"
        checked={done}
        disabled={readOnly || busy}
        onCheckedChange={(v) => changeStatus(v === true ? "done" : "open")}
        aria-label={done ? t("reopen") : t("complete")}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={onEdit} className={cn("text-start font-medium hover:underline", done && "line-through")} dir="auto">
            {task.title}
          </button>
          <Badge tone={PRIORITY_TONE[task.priority]}>{t(`priorities.${task.priority}`)}</Badge>
          {status === "in_progress" && <Badge tone="primary">{t("statuses.in_progress")}</Badge>}
          {task.isTeamTask && (
            <Badge tone="outline">
              <Users /> {t("teamBadge")}
            </Badge>
          )}
          {task.source !== "manual" && <Badge tone="ai">{t(`source.${task.source as "ai"}`)}</Badge>}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <DueLabel task={{ ...task, status }} tz={common.timezone} now={now} />
          {task.remindAt && !done && (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Bell className="size-3.5" />
              <span className="sr-only">{t("fields.reminder")}</span>
            </span>
          )}
          {task.link && LinkIcon && (
            <Link href={`${LINK_HREF[task.link.kind]}${task.link.id}`} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
              <LinkIcon className="size-3.5" /> <span dir="auto">{task.link.name}</span>
            </Link>
          )}
          {task.description && <span className="line-clamp-1 max-w-md text-muted-foreground" dir="auto">{task.description}</span>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:inline-flex">
          {task.assigneeName ? (
            <>
              <Avatar name={task.assigneeName} size="xs" /> {task.assigneeName}
            </>
          ) : (
            t("unassigned")
          )}
        </span>
        {!readOnly && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={tc("actions")}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {status === "open" && (
                <DropdownMenuItem onSelect={() => changeStatus("in_progress")}>
                  <Play /> {t("start")}
                </DropdownMenuItem>
              )}
              {done && (
                <DropdownMenuItem onSelect={() => changeStatus("open")}>
                  <RotateCcw /> {t("reopen")}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={onEdit}>{tc("edit")}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {canDelete && !readOnly && (
          <ConfirmDialog
            trigger={
              <Button variant="danger-ghost" size="icon-sm" aria-label={tc("delete")}>
                <Trash2 />
              </Button>
            }
            description={t("deleteConfirm", { title: task.title })}
            onConfirm={async () => {
              const res = await deleteTaskAction({ id: task.id });
              if (!res.ok) return void toast.error(res.error.message);
              toast.success(t("deleted"));
              router.refresh();
            }}
          />
        )}
      </div>
    </li>
  );
}

export function TaskList({
  rows,
  common,
  canDelete,
  readOnly,
  openTask,
}: {
  rows: TaskListItem[];
  common: Common;
  canDelete: boolean;
  readOnly: boolean;
  /** Task to open in the edit dialog (deep link `?task=<id>`). */
  openTask: TaskListItem | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [editing, setEditing] = useState<TaskListItem | null>(openTask);
  // Captured once per mount so render stays pure; the page re-renders on navigation.
  const [now] = useState(() => Date.now());

  const close = () => {
    setEditing(null);
    if (params.get("task")) {
      const next = new URLSearchParams(params.toString());
      next.delete("task");
      router.replace(next.size ? `${pathname}?${next}` : pathname, { scroll: false });
    }
  };

  return (
    <>
      {rows.length > 0 && (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
          {rows.map((task) => (
            <TaskRow key={`${task.id}:${task.status}`} task={task} common={common} canDelete={canDelete} readOnly={readOnly} onEdit={() => setEditing(task)} now={now} />
          ))}
        </ul>
      )}
      {editing && !readOnly && (
        <TaskFormDialog
          key={editing.id}
          open
          onOpenChange={(o) => !o && close()}
          initial={toFormValues(editing, common.timezone)}
          members={common.members}
          currentUserId={common.currentUserId}
          canAssignOthers={common.canAssignOthers}
        />
      )}
    </>
  );
}

export function NewTaskButton({ common, prefill, openInitially }: { common: Common; prefill?: Partial<TaskFormValues>; openInitially: boolean }) {
  const t = useTranslations("tasks");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(openInitially);
  return (
    <>
      <Button onClick={() => setOpen(true)}>{t("new")}</Button>
      {open && (
        <TaskFormDialog
          open
          onOpenChange={(o) => {
            setOpen(o);
            if (!o && params.get("new")) {
              const next = new URLSearchParams(params.toString());
              for (const k of ["new", "contact", "company", "deal", "lead"]) next.delete(k);
              router.replace(next.size ? `${pathname}?${next}` : pathname, { scroll: false });
            }
          }}
          initial={prefill}
          members={common.members}
          currentUserId={common.currentUserId}
          canAssignOthers={common.canAssignOthers}
        />
      )}
    </>
  );
}

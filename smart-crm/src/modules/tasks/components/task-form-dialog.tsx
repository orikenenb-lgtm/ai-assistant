"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/controls";
import { formToObject, useServerAction } from "@/hooks/use-server-action";
import { toLocalInput } from "@/modules/calendar/tz";
import { REMINDER_OFFSET_MINUTES, REMINDER_OPTIONS, TASK_PRIORITIES, type ReminderOption } from "../schemas";
import { createTaskAction, updateTaskAction } from "../actions";
import { LinkPicker, type LinkValue } from "./link-picker";

export type TaskFormValues = {
  id?: string;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  dueAt: string | null;
  reminder: ReminderOption;
  remindAt: string | null;
  assigneeId: string | null;
  isTeamTask: boolean;
  link: LinkValue;
};

/** Derives the reminder option shown in the form from stored instants. */
export function reminderFromInstants(dueAt: Date | null, remindAt: Date | null, tz: string): { reminder: ReminderOption; remindAt: string | null } {
  if (!remindAt) return { reminder: "none", remindAt: null };
  if (dueAt) {
    const minutes = Math.round((dueAt.getTime() - remindAt.getTime()) / 60_000);
    const match = (Object.entries(REMINDER_OFFSET_MINUTES) as [ReminderOption, number][]).find(([, m]) => m === minutes);
    if (match) return { reminder: match[0], remindAt: null };
  }
  return { reminder: "custom", remindAt: toLocalInput(remindAt, tz) };
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: Partial<TaskFormValues>;
  members: { userId: string; fullName: string }[];
  currentUserId: string;
  canAssignOthers: boolean;
  onSaved?: (id: string) => void;
};

export function TaskFormDialog({ open, onOpenChange, initial, members, currentUserId, canAssignOthers, onSaved }: Props) {
  const t = useTranslations("tasks");
  const tc = useTranslations("common");
  const router = useRouter();
  const editing = Boolean(initial?.id);
  const [reminder, setReminder] = useState<ReminderOption>(initial?.reminder ?? "none");
  const [link, setLink] = useState<LinkValue>(initial?.link ?? null);
  const [teamTask, setTeamTask] = useState(initial?.isTeamTask ?? false);
  const create = useServerAction(createTaskAction, { successMessage: t("created") });
  const update = useServerAction(updateTaskAction, { successMessage: t("saved") });
  const action = editing ? update : create;
  const assignable = canAssignOthers ? members : members.filter((m) => m.userId === currentUserId || m.userId === initial?.assigneeId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" closeLabel={tc("close")}>
        <DialogHeader>
          <DialogTitle>{editing ? t("edit") : t("new")}</DialogTitle>
        </DialogHeader>
        <form
          noValidate
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const data = formToObject(e.currentTarget);
            const payload = {
              title: data.title,
              description: data.description,
              priority: data.priority,
              status: data.status ?? "open",
              dueAt: data.dueAt || null,
              reminder,
              remindAt: reminder === "custom" ? data.remindAt || null : null,
              assigneeId: data.assigneeId || null,
              isTeamTask: teamTask,
              contactId: link?.kind === "contact" ? link.option.id : null,
              companyId: link?.kind === "company" ? link.option.id : null,
              dealId: link?.kind === "deal" ? link.option.id : null,
              leadId: link?.kind === "lead" ? link.option.id : null,
            };
            const res = editing ? await update.run({ id: initial!.id, data: payload }) : await create.run(payload);
            if (res.ok) {
              onOpenChange(false);
              onSaved?.(res.data.id);
              router.refresh();
            }
          }}
        >
          <Field label={t("fields.title")} htmlFor="task-title" error={action.fieldErrors.title} required>
            <Input id="task-title" name="title" defaultValue={initial?.title ?? ""} maxLength={300} autoFocus dir="auto" />
          </Field>
          <Field label={t("fields.description")} htmlFor="task-description" error={action.fieldErrors.description}>
            <Textarea id="task-description" name="description" defaultValue={initial?.description ?? ""} rows={3} maxLength={5000} dir="auto" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("fields.dueAt")} htmlFor="task-due" error={action.fieldErrors.dueAt}>
              <Input id="task-due" name="dueAt" type="datetime-local" defaultValue={initial?.dueAt ?? ""} />
            </Field>
            <Field label={t("fields.reminder")} htmlFor="task-reminder" error={action.fieldErrors.reminder}>
              <NativeSelect id="task-reminder" value={reminder} onChange={(e) => setReminder(e.target.value as ReminderOption)}>
                {REMINDER_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {t(`reminders.${r}`)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {reminder === "custom" && (
              <Field label={t("fields.remindAt")} htmlFor="task-remind-at" error={action.fieldErrors.remindAt} required>
                <Input id="task-remind-at" name="remindAt" type="datetime-local" defaultValue={initial?.remindAt ?? ""} />
              </Field>
            )}
            <Field label={t("fields.priority")} htmlFor="task-priority">
              <NativeSelect id="task-priority" name="priority" defaultValue={initial?.priority ?? "medium"}>
                {TASK_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {t(`priorities.${p}`)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label={t("fields.status")} htmlFor="task-status">
              <NativeSelect id="task-status" name="status" defaultValue={initial?.status === "in_progress" ? "in_progress" : "open"} disabled={initial?.status === "done"}>
                <option value="open">{t("statuses.open")}</option>
                <option value="in_progress">{t("statuses.in_progress")}</option>
              </NativeSelect>
            </Field>
            <Field label={t("fields.assignee")} htmlFor="task-assignee" error={action.fieldErrors.assigneeId}>
              <NativeSelect id="task-assignee" name="assigneeId" defaultValue={initial?.id ? (initial.assigneeId ?? "") : (initial?.assigneeId ?? currentUserId)}>
                {(teamTask || canAssignOthers || initial?.assigneeId === null) && <option value="">{t("unassigned")}</option>}
                {assignable.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.userId === currentUserId ? `${m.fullName} (${t("assignToMe")})` : m.fullName}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={teamTask} onCheckedChange={(v) => setTeamTask(v === true)} aria-label={t("fields.teamTask")} />
            {t("fields.teamTask")}
          </label>
          <Field label={t("fields.link")} htmlFor="task-link" error={action.fieldErrors.contactId ?? action.fieldErrors.dealId ?? action.fieldErrors.companyId ?? action.fieldErrors.leadId}>
            <LinkPicker id="task-link" value={link} onChange={setLink} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" loading={action.pending}>
              {editing ? tc("save") : tc("create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/controls";
import { ConfirmDialog } from "@/components/data/confirm-dialog";
import { formToObject, useServerAction } from "@/hooks/use-server-action";
import { LinkPicker, type LinkValue } from "@/modules/tasks/components/link-picker";
import { createEventAction, deleteEventAction, updateEventAction } from "../actions";

export type EventFormValues = {
  id?: string;
  title: string;
  description: string | null;
  location: string | null;
  allDay: boolean;
  /** "YYYY-MM-DDTHH:mm" for timed events, "YYYY-MM-DD" for all-day. */
  start: string;
  end: string;
  ownerId: string | null;
  link: LinkValue;
  canEdit: boolean;
  external?: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: EventFormValues;
  members: { userId: string; fullName: string }[];
  currentUserId: string;
  canChooseOwner: boolean;
};

export function EventFormDialog({ open, onOpenChange, initial, members, currentUserId, canChooseOwner }: Props) {
  const t = useTranslations("calendar");
  const tc = useTranslations("common");
  const router = useRouter();
  const editing = Boolean(initial.id);
  const [allDay, setAllDay] = useState(initial.allDay);
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [link, setLink] = useState<LinkValue>(initial.link);
  const create = useServerAction(createEventAction, { successMessage: t("eventCreated") });
  const update = useServerAction(updateEventAction, { successMessage: t("eventSaved") });
  const action = editing ? update : create;
  const readOnly = !initial.canEdit;

  const toggleAllDay = (on: boolean) => {
    setAllDay(on);
    // Convert the current values between "date" and "datetime-local" formats.
    if (on) {
      setStart(start.slice(0, 10));
      setEnd(end.slice(0, 10));
    } else {
      setStart(`${start.slice(0, 10)}T09:00`);
      setEnd(`${end.slice(0, 10)}T10:00`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" closeLabel={tc("close")}>
        <DialogHeader>
          <DialogTitle>{editing ? (readOnly ? initial.title : t("editEvent")) : t("newEvent")}</DialogTitle>
        </DialogHeader>
        <form
          noValidate
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (readOnly) return;
            const data = formToObject(e.currentTarget);
            const payload = {
              title: data.title,
              description: data.description,
              location: data.location,
              allDay,
              start,
              end,
              ownerId: data.ownerId || null,
              contactId: link?.kind === "contact" ? link.option.id : null,
              companyId: link?.kind === "company" ? link.option.id : null,
              dealId: link?.kind === "deal" ? link.option.id : null,
            };
            const res = editing ? await update.run({ id: initial.id, data: payload }) : await create.run(payload);
            if (res.ok) {
              onOpenChange(false);
              router.refresh();
            }
          }}
        >
          <fieldset disabled={readOnly} className="space-y-4">
            <Field label={t("fields.title")} htmlFor="ev-title" error={action.fieldErrors.title} required>
              <Input id="ev-title" name="title" defaultValue={initial.title} maxLength={300} autoFocus dir="auto" />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={allDay} onCheckedChange={(v) => toggleAllDay(v === true)} aria-label={t("allDay")} />
              {t("allDay")}
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={allDay ? t("fields.startDate") : t("fields.start")} htmlFor="ev-start" error={action.fieldErrors.start}>
                <Input id="ev-start" type={allDay ? "date" : "datetime-local"} value={start} onChange={(e) => setStart(e.target.value)} required />
              </Field>
              <Field label={allDay ? t("fields.endDate") : t("fields.end")} htmlFor="ev-end" error={action.fieldErrors.end}>
                <Input id="ev-end" type={allDay ? "date" : "datetime-local"} value={end} onChange={(e) => setEnd(e.target.value)} required />
              </Field>
            </div>
            <Field label={t("fields.location")} htmlFor="ev-location">
              <Input id="ev-location" name="location" defaultValue={initial.location ?? ""} maxLength={300} dir="auto" />
            </Field>
            <Field label={t("fields.description")} htmlFor="ev-description">
              <Textarea id="ev-description" name="description" defaultValue={initial.description ?? ""} rows={3} maxLength={5000} dir="auto" />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              {canChooseOwner && (
                <Field label={t("fields.owner")} htmlFor="ev-owner" error={action.fieldErrors.ownerId}>
                  <NativeSelect id="ev-owner" name="ownerId" defaultValue={initial.ownerId ?? currentUserId}>
                    {members.map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {m.fullName}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              )}
            </div>
            <Field label={`${t("fields.contact")} / ${t("fields.company")} / ${t("fields.deal")}`} htmlFor="ev-link">
              <LinkPicker id="ev-link" value={link} onChange={setLink} kinds={["contact", "company", "deal"]} />
            </Field>
          </fieldset>
          {initial.external && <p className="text-xs text-muted-foreground">{t("external", { provider: initial.external })}</p>}
          <DialogFooter className="sm:justify-between">
            <div>
              {editing && !readOnly && (
                <ConfirmDialog
                  trigger={
                    <Button type="button" variant="danger-ghost">
                      <Trash2 /> {tc("delete")}
                    </Button>
                  }
                  description={t("deleteConfirm", { title: initial.title })}
                  onConfirm={async () => {
                    const res = await deleteEventAction({ id: initial.id });
                    if (!res.ok) return void toast.error(res.error.message);
                    toast.success(t("eventDeleted"));
                    onOpenChange(false);
                    router.refresh();
                  }}
                />
              )}
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
                {readOnly ? tc("close") : tc("cancel")}
              </Button>
              {!readOnly && (
                <Button type="submit" loading={action.pending}>
                  {editing ? tc("save") : tc("create")}
                </Button>
              )}
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

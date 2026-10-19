"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, NativeSelect, Textarea } from "@/components/ui/input";
import { CustomFieldInputs, collectCustomFields } from "@/components/data/custom-field-inputs";
import { TagPicker, type TagOption } from "@/components/data/tag-picker";
import { formToObject, useServerAction } from "@/hooks/use-server-action";
import { formatPhone } from "@/lib/phone";
import type { CustomFieldDef } from "@/modules/crm/custom-fields";
import { LEAD_SOURCES } from "../schemas";
import { createLeadAction, updateLeadAction } from "../lead-actions";

export type LeadFormValues = {
  id?: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  companyName: string | null;
  source: string;
  score: number | null;
  estimatedValueCents: number | null;
  message: string | null;
  ownerId: string | null;
  customFields: Record<string, unknown>;
  tagIds: string[];
};

export function LeadFormDialog({
  members,
  tags: initialTags,
  customFieldDefs,
  initial,
  trigger,
  openFromQuery,
}: {
  members: { userId: string; fullName: string }[];
  tags: TagOption[];
  customFieldDefs: CustomFieldDef[];
  initial?: LeadFormValues;
  trigger?: React.ReactNode;
  openFromQuery?: boolean;
}) {
  const t = useTranslations("leads");
  const tc = useTranslations("common");
  const router = useRouter();
  const params = useSearchParams();
  const [open, setOpen] = useState(() => Boolean(openFromQuery) && params.get("new") === "1");
  const [tags, setTags] = useState(initialTags);
  const [tagIds, setTagIds] = useState<string[]>(initial?.tagIds ?? []);
  const editing = Boolean(initial?.id);
  const create = useServerAction(createLeadAction, { successMessage: t("created") });
  const update = useServerAction(updateLeadAction, { successMessage: tc("saved") });
  const action = editing ? update : create;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o && params.get("new")) router.replace("/leads");
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus /> {t("new")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent size="lg" closeLabel={tc("close")}>
        <DialogHeader>
          <DialogTitle>{editing ? t("edit") : t("new")}</DialogTitle>
        </DialogHeader>
        <form
          noValidate
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const d = formToObject(form);
            const payload = {
              fullName: d.fullName,
              email: d.email,
              phone: d.phone,
              companyName: d.companyName,
              source: d.source,
              score: d.score,
              estimatedValue: d.estimatedValue,
              message: d.message,
              ownerId: d.ownerId,
              customFields: collectCustomFields(form),
              tagIds,
            };
            const res = editing ? await update.run({ id: initial!.id, data: payload }) : await create.run(payload);
            if (res.ok) {
              setOpen(false);
              if (!editing) router.push(`/leads/${res.data.id}`);
              else router.refresh();
            }
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("fullName")} htmlFor="fullName" error={action.fieldErrors.fullName}>
              <Input id="fullName" name="fullName" defaultValue={initial?.fullName} autoFocus dir="auto" />
            </Field>
            <Field label={t("companyName")} htmlFor="companyName">
              <Input id="companyName" name="companyName" defaultValue={initial?.companyName ?? ""} dir="auto" />
            </Field>
            <Field label={tc("phone")} htmlFor="phone" error={action.fieldErrors.phone}>
              <Input id="phone" name="phone" type="tel" dir="ltr" defaultValue={initial?.phone ? formatPhone(initial.phone) : ""} />
            </Field>
            <Field label={tc("email")} htmlFor="email" error={action.fieldErrors.email}>
              <Input id="email" name="email" type="email" dir="ltr" defaultValue={initial?.email ?? ""} />
            </Field>
            <Field label={t("source")} htmlFor="source">
              <NativeSelect id="source" name="source" defaultValue={initial?.source ?? "manual"}>
                {LEAD_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {t(`sources.${s}`)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label={tc("owner")} htmlFor="ownerId">
              <NativeSelect id="ownerId" name="ownerId" defaultValue={initial?.ownerId ?? ""}>
                <option value="">{tc("unassigned")}</option>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.fullName}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label={t("estimatedValue")} htmlFor="estimatedValue" error={action.fieldErrors.estimatedValue}>
              <Input
                id="estimatedValue"
                name="estimatedValue"
                inputMode="decimal"
                dir="ltr"
                defaultValue={initial?.estimatedValueCents != null ? String(initial.estimatedValueCents / 100) : ""}
              />
            </Field>
            <Field label={t("score")} htmlFor="score" error={action.fieldErrors.score}>
              <Input id="score" name="score" type="number" min={0} max={100} defaultValue={initial?.score ?? ""} />
            </Field>
          </div>
          <Field label={t("message")} htmlFor="message">
            <Textarea id="message" name="message" rows={3} maxLength={5000} defaultValue={initial?.message ?? ""} dir="auto" />
          </Field>
          <Field label={tc("tags")}>
            <TagPicker
              allTags={tags}
              value={tagIds}
              onChange={(ids, created) => {
                if (created) setTags((prev) => [...prev, created]);
                setTagIds(ids);
              }}
            />
          </Field>
          <CustomFieldInputs defs={customFieldDefs} values={initial?.customFields ?? {}} errors={action.fieldErrors} />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
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

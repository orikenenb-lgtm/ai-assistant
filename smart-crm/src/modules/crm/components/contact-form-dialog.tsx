"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { AlertTriangle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, NativeSelect } from "@/components/ui/input";
import { Alert } from "@/components/ui/primitives";
import { AsyncCombobox, type ComboOption } from "@/components/data/async-combobox";
import { CustomFieldInputs, collectCustomFields } from "@/components/data/custom-field-inputs";
import { TagPicker, type TagOption } from "@/components/data/tag-picker";
import { formToObject, useServerAction } from "@/hooks/use-server-action";
import { formatPhone } from "@/lib/phone";
import type { CustomFieldDef } from "../custom-fields";
import { LIFECYCLE_STAGES } from "../schemas";
import { checkDuplicatesAction, createContactAction, updateContactAction } from "../contacts/actions";
import { searchCompaniesAction } from "../lookup-actions";

export type ContactFormValues = {
  id?: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  source: string | null;
  lifecycleStage: string;
  ownerId: string | null;
  company: ComboOption | null;
  customFields: Record<string, unknown>;
  tagIds: string[];
};

type Props = {
  members: { userId: string; fullName: string }[];
  tags: TagOption[];
  customFieldDefs: CustomFieldDef[];
  initial?: ContactFormValues;
  trigger?: React.ReactNode;
  /** Open automatically when `?new=1` is in the URL (command palette shortcut). */
  openFromQuery?: boolean;
};

export function ContactFormDialog({ members, tags: initialTags, customFieldDefs, initial, trigger, openFromQuery }: Props) {
  const t = useTranslations("contacts");
  const tc = useTranslations("common");
  const router = useRouter();
  const params = useSearchParams();
  // `?new=1` (command palette shortcut) opens the dialog on first render.
  const [open, setOpen] = useState(() => Boolean(openFromQuery) && params.get("new") === "1");
  const [company, setCompany] = useState<ComboOption | null>(initial?.company ?? null);
  const [tagIds, setTagIds] = useState<string[]>(initial?.tagIds ?? []);
  const [tags, setTags] = useState(initialTags);
  const [dupes, setDupes] = useState<{ id: string; name: string }[]>([]);
  const editing = Boolean(initial?.id);
  const create = useServerAction(createContactAction, { successMessage: t("created") });
  const update = useServerAction(updateContactAction, { successMessage: tc("saved") });
  const action = editing ? update : create;

  const checkDupes = async (form: HTMLFormElement) => {
    const data = formToObject(form);
    if (!data.email && !data.phone) return setDupes([]);
    const res = await checkDuplicatesAction({ email: data.email || null, phone: data.phone || null, excludeId: initial?.id });
    setDupes(res.ok ? res.data : []);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o && params.get("new")) router.replace("/contacts");
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
            const data = formToObject(form);
            const payload = {
              firstName: data.firstName,
              lastName: data.lastName,
              email: data.email,
              phone: data.phone,
              title: data.title,
              source: data.source,
              lifecycleStage: data.lifecycleStage,
              ownerId: data.ownerId,
              companyId: company?.id ?? null,
              customFields: collectCustomFields(form),
              tagIds,
            };
            const res = editing ? await update.run({ id: initial!.id, data: payload }) : await create.run(payload);
            if (res.ok) {
              setOpen(false);
              if (!editing) router.push(`/contacts/${res.data.id}`);
              else router.refresh();
            }
          }}
          onBlur={(e) => {
            if (e.target instanceof HTMLInputElement && (e.target.name === "email" || e.target.name === "phone")) void checkDupes(e.currentTarget);
          }}
        >
          {action.error?.fieldErrors?._form && <Alert tone="danger">{action.error.fieldErrors._form[0]}</Alert>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("firstName")} htmlFor="firstName" error={action.fieldErrors.firstName}>
              <Input id="firstName" name="firstName" defaultValue={initial?.firstName} autoFocus dir="auto" />
            </Field>
            <Field label={t("lastName")} htmlFor="lastName" error={action.fieldErrors.lastName}>
              <Input id="lastName" name="lastName" defaultValue={initial?.lastName} dir="auto" />
            </Field>
            <Field label={tc("phone")} htmlFor="phone" error={action.fieldErrors.phone} hint={t("phoneHint")}>
              <Input id="phone" name="phone" type="tel" dir="ltr" defaultValue={initial?.phone ? formatPhone(initial.phone) : ""} />
            </Field>
            <Field label={tc("email")} htmlFor="email" error={action.fieldErrors.email}>
              <Input id="email" name="email" type="email" dir="ltr" defaultValue={initial?.email ?? ""} />
            </Field>
          </div>
          {dupes.length > 0 && (
            <Alert tone="warning">
              <span className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>
                  {t("possibleDuplicate")}{" "}
                  {dupes.map((d, i) => (
                    <span key={d.id}>
                      {i > 0 && ", "}
                      <Link href={`/contacts/${d.id}`} className="font-medium underline" target="_blank">
                        {d.name}
                      </Link>
                    </span>
                  ))}
                </span>
              </span>
            </Alert>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("company")} htmlFor="company">
              <AsyncCombobox id="company" value={company} onChange={setCompany} search={searchCompaniesAction} placeholder={t("selectCompany")} />
            </Field>
            <Field label={t("jobTitle")} htmlFor="title">
              <Input id="title" name="title" defaultValue={initial?.title ?? ""} dir="auto" />
            </Field>
            <Field label={t("stage")} htmlFor="lifecycleStage">
              <NativeSelect id="lifecycleStage" name="lifecycleStage" defaultValue={initial?.lifecycleStage ?? "lead"}>
                {LIFECYCLE_STAGES.map((s) => (
                  <option key={s} value={s}>
                    {t(`stages.${s}`)}
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
            <Field label={t("source")} htmlFor="source">
              <Input id="source" name="source" defaultValue={initial?.source ?? ""} placeholder={t("sourcePlaceholder")} dir="auto" />
            </Field>
          </div>
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

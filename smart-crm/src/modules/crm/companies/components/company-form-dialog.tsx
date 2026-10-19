"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, NativeSelect } from "@/components/ui/input";
import { CustomFieldInputs, collectCustomFields } from "@/components/data/custom-field-inputs";
import { TagPicker, type TagOption } from "@/components/data/tag-picker";
import { formToObject, useServerAction } from "@/hooks/use-server-action";
import { formatPhone } from "@/lib/phone";
import type { CustomFieldDef } from "../../custom-fields";
import { createCompanyAction, updateCompanyAction } from "../actions";

const SIZES = ["1-10", "11-50", "51-200", "201-1000", "1000+"] as const;

export type CompanyFormValues = {
  id?: string;
  name: string;
  domain: string | null;
  industry: string | null;
  sizeRange: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  ownerId: string | null;
  customFields: Record<string, unknown>;
  tagIds: string[];
};

export function CompanyFormDialog({
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
  initial?: CompanyFormValues;
  trigger?: React.ReactNode;
  openFromQuery?: boolean;
}) {
  const t = useTranslations("companies");
  const tc = useTranslations("common");
  const router = useRouter();
  const params = useSearchParams();
  const [open, setOpen] = useState(() => Boolean(openFromQuery) && params.get("new") === "1");
  const [tags, setTags] = useState(initialTags);
  const [tagIds, setTagIds] = useState<string[]>(initial?.tagIds ?? []);
  const editing = Boolean(initial?.id);
  const create = useServerAction(createCompanyAction, { successMessage: t("created") });
  const update = useServerAction(updateCompanyAction, { successMessage: tc("saved") });
  const action = editing ? update : create;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o && params.get("new")) router.replace("/companies");
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
              name: d.name,
              domain: d.domain,
              industry: d.industry,
              sizeRange: d.sizeRange,
              phone: d.phone,
              email: d.email,
              website: d.website,
              address: d.address,
              city: d.city,
              country: d.country,
              ownerId: d.ownerId,
              customFields: collectCustomFields(form),
              tagIds,
            };
            const res = editing ? await update.run({ id: initial!.id, data: payload }) : await create.run(payload);
            if (res.ok) {
              setOpen(false);
              if (!editing) router.push(`/companies/${res.data.id}`);
              else router.refresh();
            }
          }}
        >
          <Field label={t("name")} htmlFor="name" error={action.fieldErrors.name} required>
            <Input id="name" name="name" defaultValue={initial?.name} required autoFocus dir="auto" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={tc("phone")} htmlFor="phone" error={action.fieldErrors.phone}>
              <Input id="phone" name="phone" type="tel" dir="ltr" defaultValue={initial?.phone ? formatPhone(initial.phone) : ""} />
            </Field>
            <Field label={tc("email")} htmlFor="email" error={action.fieldErrors.email}>
              <Input id="email" name="email" type="email" dir="ltr" defaultValue={initial?.email ?? ""} />
            </Field>
            <Field label={t("website")} htmlFor="website" error={action.fieldErrors.website}>
              <Input id="website" name="website" dir="ltr" placeholder="https://" defaultValue={initial?.website ?? ""} />
            </Field>
            <Field label={t("domain")} htmlFor="domain" error={action.fieldErrors.domain}>
              <Input id="domain" name="domain" dir="ltr" placeholder="example.co.il" defaultValue={initial?.domain ?? ""} />
            </Field>
            <Field label={t("industry")} htmlFor="industry">
              <Input id="industry" name="industry" defaultValue={initial?.industry ?? ""} dir="auto" />
            </Field>
            <Field label={t("size")} htmlFor="sizeRange">
              <NativeSelect id="sizeRange" name="sizeRange" defaultValue={initial?.sizeRange ?? ""}>
                <option value="">—</option>
                {SIZES.map((s) => (
                  <option key={s} value={s}>
                    {t(`sizes.${s}`)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label={t("address")} htmlFor="address">
              <Input id="address" name="address" defaultValue={initial?.address ?? ""} dir="auto" />
            </Field>
            <Field label={t("city")} htmlFor="city">
              <Input id="city" name="city" defaultValue={initial?.city ?? ""} dir="auto" />
            </Field>
            <Field label={t("country")} htmlFor="country" error={action.fieldErrors.country}>
              <Input id="country" name="country" dir="ltr" maxLength={2} placeholder="IL" defaultValue={initial?.country ?? ""} />
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

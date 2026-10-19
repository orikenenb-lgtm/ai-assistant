"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, NativeSelect } from "@/components/ui/input";
import { AsyncCombobox, type ComboOption } from "@/components/data/async-combobox";
import { CustomFieldInputs, collectCustomFields } from "@/components/data/custom-field-inputs";
import { TagPicker, type TagOption } from "@/components/data/tag-picker";
import { formToObject, useServerAction } from "@/hooks/use-server-action";
import type { CustomFieldDef } from "@/modules/crm/custom-fields";
import { searchCompaniesAction, searchContactsAction } from "@/modules/crm/lookup-actions";
import { CURRENCIES } from "../schemas";
import { createDealAction, updateDealAction } from "../deal-actions";

export type PipelineOption = { id: string; name: string; isDefault: boolean; stages: { id: string; name: string; kind: string; probability: number }[] };

export type DealFormValues = {
  id?: string;
  title: string;
  valueCents: number;
  currency: string;
  pipelineId: string;
  stageId: string;
  probability: number | null;
  expectedCloseDate: string | null;
  contact: ComboOption | null;
  company: ComboOption | null;
  ownerId: string | null;
  customFields: Record<string, unknown>;
  tagIds: string[];
};

export function DealFormDialog({
  members,
  tags: initialTags,
  customFieldDefs,
  pipelines,
  defaultCurrency,
  initial,
  prefill,
  trigger,
  openFromQuery,
}: {
  members: { userId: string; fullName: string }[];
  tags: TagOption[];
  customFieldDefs: CustomFieldDef[];
  pipelines: PipelineOption[];
  defaultCurrency: string;
  initial?: DealFormValues;
  /** Values from `?new=1&contact=…&company=…&pipeline=…` */
  prefill?: { contact?: ComboOption | null; company?: ComboOption | null; pipelineId?: string };
  trigger?: React.ReactNode;
  openFromQuery?: boolean;
}) {
  const t = useTranslations("deals");
  const tc = useTranslations("common");
  const router = useRouter();
  const params = useSearchParams();
  const [open, setOpen] = useState(() => Boolean(openFromQuery) && params.get("new") === "1");
  const startPipeline = initial?.pipelineId ?? pipelines.find((p) => p.id === prefill?.pipelineId)?.id ?? pipelines.find((p) => p.isDefault)?.id ?? pipelines[0]?.id ?? "";
  const [pipelineId, setPipelineId] = useState(startPipeline);
  const stages = pipelines.find((p) => p.id === pipelineId)?.stages ?? [];
  const [stageId, setStageId] = useState(initial?.stageId ?? stages.find((s) => s.kind === "open")?.id ?? "");
  const [contact, setContact] = useState<ComboOption | null>(initial?.contact ?? prefill?.contact ?? null);
  const [company, setCompany] = useState<ComboOption | null>(initial?.company ?? prefill?.company ?? null);
  const [tags, setTags] = useState(initialTags);
  const [tagIds, setTagIds] = useState<string[]>(initial?.tagIds ?? []);
  const editing = Boolean(initial?.id);
  const create = useServerAction(createDealAction, { successMessage: t("created") });
  const update = useServerAction(updateDealAction, { successMessage: tc("saved") });
  const action = editing ? update : create;
  const stage = stages.find((s) => s.id === stageId);
  // Closed stages are reachable through win/lose actions, not the form (except to keep the current one).
  const selectableStages = stages.filter((s) => s.kind === "open" || s.id === initial?.stageId);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o && params.get("new")) router.replace("/deals");
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button disabled={pipelines.length === 0}>
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
              title: d.title,
              value: d.value,
              currency: d.currency,
              pipelineId,
              stageId,
              probability: d.probability,
              expectedCloseDate: d.expectedCloseDate,
              contactId: contact?.id ?? null,
              companyId: company?.id ?? null,
              ownerId: d.ownerId,
              customFields: collectCustomFields(form),
              tagIds,
            };
            const res = editing ? await update.run({ id: initial!.id, data: payload }) : await create.run(payload);
            if (res.ok) {
              setOpen(false);
              if (!editing) router.push(`/deals/${res.data.id}`);
              else router.refresh();
            }
          }}
        >
          <Field label={t("dealTitle")} htmlFor="title" error={action.fieldErrors.title} required>
            <Input id="title" name="title" defaultValue={initial?.title} required autoFocus dir="auto" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t("value")} htmlFor="value" error={action.fieldErrors.value} className="sm:col-span-2">
              <Input id="value" name="value" inputMode="decimal" dir="ltr" defaultValue={initial ? String(initial.valueCents / 100) : ""} placeholder="0" />
            </Field>
            <Field label={t("currency")} htmlFor="currency">
              <NativeSelect id="currency" name="currency" defaultValue={initial?.currency ?? defaultCurrency}>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("pipeline")} htmlFor="pipelineId">
              <NativeSelect
                id="pipelineId"
                value={pipelineId}
                onChange={(e) => {
                  setPipelineId(e.target.value);
                  setStageId(pipelines.find((p) => p.id === e.target.value)?.stages.find((s) => s.kind === "open")?.id ?? "");
                }}
              >
                {pipelines.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label={t("stage")} htmlFor="stageId" error={action.fieldErrors.stageId}>
              <NativeSelect id="stageId" value={stageId} onChange={(e) => setStageId(e.target.value)}>
                {selectableStages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label={t("contact")} htmlFor="contact">
              <AsyncCombobox id="contact" value={contact} onChange={setContact} search={searchContactsAction} placeholder={t("selectContact")} />
            </Field>
            <Field label={t("company")} htmlFor="company">
              <AsyncCombobox id="company" value={company} onChange={setCompany} search={searchCompaniesAction} placeholder={t("selectCompany")} />
            </Field>
            <Field
              label={t("probability")}
              htmlFor="probability"
              error={action.fieldErrors.probability}
              hint={t("probabilityHint", { stage: stage?.probability ?? 0 })}
            >
              <Input id="probability" name="probability" type="number" min={0} max={100} defaultValue={initial?.probability ?? ""} />
            </Field>
            <Field label={t("expectedClose")} htmlFor="expectedCloseDate" error={action.fieldErrors.expectedCloseDate}>
              <Input id="expectedCloseDate" name="expectedCloseDate" type="date" defaultValue={initial?.expectedCloseDate ?? ""} />
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

"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ArrowLeftRight, CheckCircle2, PhoneCall, RotateCcw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/controls";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Alert } from "@/components/ui/primitives";
import type { TagOption } from "@/components/data/tag-picker";
import { useServerAction } from "@/hooks/use-server-action";
import { LEAD_TRANSITIONS, type LeadStatus } from "../schemas";
import { convertLeadAction, deleteLeadAction, setLeadStatusAction, setLeadTagsAction } from "../lead-actions";
import { DeleteEntityButton, TagsEditor } from "./shared";

export function LeadStatusActions({ leadId, status }: { leadId: string; status: LeadStatus }) {
  const t = useTranslations("leads");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const { run, pending, fieldErrors } = useServerAction(setLeadStatusAction, { successMessage: t("statusUpdated") });
  const allowed = LEAD_TRANSITIONS[status];
  const go = async (next: Exclude<LeadStatus, "converted">, why?: string) => {
    const res = await run({ id: leadId, status: next, reason: why });
    if (res.ok) {
      setOpen(false);
      router.refresh();
    }
  };
  return (
    <div className="flex flex-wrap gap-2">
      {allowed.includes("contacted") && (
        <Button size="sm" variant="secondary" loading={pending} onClick={() => go("contacted")}>
          <PhoneCall /> {t("markContacted")}
        </Button>
      )}
      {allowed.includes("qualified") && (
        <Button size="sm" variant="secondary" loading={pending} onClick={() => go("qualified")}>
          <CheckCircle2 /> {t("markQualified")}
        </Button>
      )}
      {allowed.includes("new") && (
        <Button size="sm" variant="ghost" loading={pending} onClick={() => go("new")}>
          <RotateCcw /> {t("reopen")}
        </Button>
      )}
      {allowed.includes("unqualified") && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="danger-ghost">
              <XCircle /> {t("markUnqualified")}
            </Button>
          </DialogTrigger>
          <DialogContent size="sm" closeLabel={tc("close")}>
            <DialogHeader>
              <DialogTitle>{t("markUnqualified")}</DialogTitle>
            </DialogHeader>
            <Field label={t("unqualifiedReason")} htmlFor="reason" error={fieldErrors.reason} required>
              <Textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("reasonPlaceholder")} rows={3} maxLength={500} dir="auto" />
            </Field>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setOpen(false)}>
                {tc("cancel")}
              </Button>
              <Button variant="danger" loading={pending} onClick={() => go("unqualified", reason)}>
                {tc("save")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

type PipelineOption = { id: string; name: string; isDefault: boolean; stages: { id: string; name: string; kind: string }[] };

export function ConvertLeadDialog({
  leadId,
  companyName,
  defaultTitle,
  defaultValue,
  pipelines,
  canCreateDeal,
}: {
  leadId: string;
  companyName: string | null;
  defaultTitle: string;
  defaultValue: number | null;
  pipelines: PipelineOption[];
  canCreateDeal: boolean;
}) {
  const t = useTranslations("leads");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const defaultPipeline = pipelines.find((p) => p.isDefault) ?? pipelines[0];
  const [pipelineId, setPipelineId] = useState(defaultPipeline?.id ?? "");
  const openStages = pipelines.find((p) => p.id === pipelineId)?.stages.filter((s) => s.kind === "open") ?? [];
  const [stageId, setStageId] = useState(openStages[0]?.id ?? "");
  const [createCompany, setCreateCompany] = useState(Boolean(companyName));
  const [createDeal, setCreateDeal] = useState(canCreateDeal && pipelines.length > 0);
  const [title, setTitle] = useState(defaultTitle);
  const [value, setValue] = useState(defaultValue != null ? String(defaultValue / 100) : "");
  const { run, pending, error, fieldErrors } = useServerAction(convertLeadAction, { successMessage: t("converted"), toastErrors: false });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <ArrowLeftRight /> {t("convert")}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={tc("close")}>
        <DialogHeader>
          <DialogTitle>{t("convertTitle")}</DialogTitle>
          <DialogDescription>{t("convertBody")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {error && !error.fieldErrors && <Alert tone="danger">{error.message}</Alert>}
          {companyName && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={createCompany} onCheckedChange={(v) => setCreateCompany(v === true)} />
              {t("createCompany", { name: companyName })}
            </label>
          )}
          {canCreateDeal && pipelines.length > 0 && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={createDeal} onCheckedChange={(v) => setCreateDeal(v === true)} />
              {t("createDeal")}
            </label>
          )}
          {createDeal && (
            <div className="grid gap-4 rounded-xl border border-border p-4 sm:grid-cols-2">
              <Field label={t("dealTitle")} htmlFor="dealTitle" className="sm:col-span-2">
                <Input id="dealTitle" value={title} onChange={(e) => setTitle(e.target.value)} dir="auto" />
              </Field>
              <Field label={t("dealValue")} htmlFor="dealValue" error={fieldErrors.dealValue}>
                <Input id="dealValue" value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" dir="ltr" />
              </Field>
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
              <Field label={t("stage")} htmlFor="stageId" error={fieldErrors.stageId} className="sm:col-span-2">
                <NativeSelect id="stageId" value={stageId} onChange={(e) => setStageId(e.target.value)}>
                  {openStages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            {tc("cancel")}
          </Button>
          <Button
            loading={pending}
            onClick={async () => {
              const res = await run({
                leadId,
                createCompany,
                createDeal,
                dealTitle: title,
                dealValue: value,
                pipelineId: createDeal ? pipelineId : null,
                stageId: createDeal ? stageId : null,
              });
              if (res.ok) {
                setOpen(false);
                router.push(res.data.dealId ? `/deals/${res.data.dealId}` : `/contacts/${res.data.contactId}`);
              }
            }}
          >
            {t("convert")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function LeadDeleteButton({ leadId, name }: { leadId: string; name: string }) {
  const t = useTranslations("leads");
  return <DeleteEntityButton description={t("deleteConfirm", { name })} action={() => deleteLeadAction({ id: leadId })} redirectTo="/leads" />;
}

export function LeadTagsEditor({ leadId, allTags, initial, canEdit }: { leadId: string; allTags: TagOption[]; initial: string[]; canEdit: boolean }) {
  return <TagsEditor allTags={allTags} initial={initial} canEdit={canEdit} save={(tagIds) => setLeadTagsAction({ leadId, tagIds })} />;
}

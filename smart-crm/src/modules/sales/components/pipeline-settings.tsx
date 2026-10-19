"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Archive, ArrowDown, ArrowUp, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, NativeSelect } from "@/components/ui/input";
import { Switch } from "@/components/ui/controls";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/data/confirm-dialog";
import { formToObject, useServerAction } from "@/hooks/use-server-action";
import {
  addStageAction,
  archivePipelineAction,
  createLostReasonAction,
  createPipelineAction,
  deleteLostReasonAction,
  deleteStageAction,
  renamePipelineAction,
  reorderStagesAction,
  setDefaultPipelineAction,
  updateLostReasonAction,
  updateStageAction,
} from "../settings-actions";

export type StageItem = { id: string; name: string; probability: number; kind: "open" | "won" | "lost"; color: string; dealCount: number };
export type PipelineItem = { id: string; name: string; isDefault: boolean; stages: StageItem[] };
export type LostReasonItem = { id: string; label: string; active: boolean };

const STAGE_COLORS = ["#64748b", "#6366f1", "#0ea5e9", "#14b8a6", "#f59e0b", "#ec4899", "#16a34a", "#dc2626"];

/* ------------------------------------------------------------ pipelines */

export function NewPipelineDialog({ disabled }: { disabled?: boolean }) {
  const t = useTranslations("pipelines");
  const tc = useTranslations("common");
  const locale = useLocale() as "he" | "en";
  const [open, setOpen] = useState(false);
  const { run, pending, fieldErrors } = useServerAction(createPipelineAction, { successMessage: t("created") });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button disabled={disabled}>
          <Plus /> {t("newPipeline")}
        </Button>
      </DialogTrigger>
      <DialogContent size="sm" closeLabel={tc("close")}>
        <DialogHeader>
          <DialogTitle>{t("newPipeline")}</DialogTitle>
          <DialogDescription>{t("newPipelineHint")}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const d = formToObject(e.currentTarget);
            const res = await run({ name: d.name, locale });
            if (res.ok) setOpen(false);
          }}
        >
          <Field label={t("pipelineName")} htmlFor="new-pipeline-name" error={fieldErrors.name} required>
            <Input id="new-pipeline-name" name="name" required maxLength={80} autoFocus dir="auto" />
          </Field>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" loading={pending}>
              {tc("create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RenamePipelineDialog({ pipeline }: { pipeline: PipelineItem }) {
  const t = useTranslations("pipelines");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const { run, pending, fieldErrors } = useServerAction(renamePipelineAction, { successMessage: t("saved") });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Pencil /> {t("rename")}
        </Button>
      </DialogTrigger>
      <DialogContent size="sm" closeLabel={tc("close")}>
        <DialogHeader>
          <DialogTitle>{t("rename")}</DialogTitle>
        </DialogHeader>
        <form
          noValidate
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const d = formToObject(e.currentTarget);
            const res = await run({ id: pipeline.id, name: d.name });
            if (res.ok) setOpen(false);
          }}
        >
          <Field label={t("pipelineName")} htmlFor={`rename-${pipeline.id}`} error={fieldErrors.name} required>
            <Input id={`rename-${pipeline.id}`} name="name" defaultValue={pipeline.name} required maxLength={80} autoFocus dir="auto" />
          </Field>
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

export function PipelineCard({ pipeline }: { pipeline: PipelineItem }) {
  const t = useTranslations("pipelines");
  const router = useRouter();
  const setDefault = useServerAction(setDefaultPipelineAction, { successMessage: t("saved") });
  const reorder = useServerAction(reorderStagesAction);
  const open = pipeline.stages.filter((s) => s.kind === "open");
  const closed = pipeline.stages.filter((s) => s.kind !== "open");

  const move = async (index: number, delta: -1 | 1) => {
    const ids = open.map((s) => s.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    const res = await reorder.run({ pipelineId: pipeline.id, orderedIds: ids });
    if (res.ok) router.refresh();
  };

  return (
    <Card data-testid="pipeline-card">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <CardTitle className="truncate" dir="auto">
            {pipeline.name}
          </CardTitle>
          {pipeline.isDefault && (
            <Badge tone="primary">
              <Star /> {t("default")}
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <RenamePipelineDialog pipeline={pipeline} />
          {!pipeline.isDefault && (
            <Button variant="ghost" size="sm" loading={setDefault.pending} onClick={() => setDefault.run({ id: pipeline.id })}>
              <Star /> {t("setDefault")}
            </Button>
          )}
          {!pipeline.isDefault && (
            <ConfirmDialog
              trigger={
                <Button variant="danger-ghost" size="sm">
                  <Archive /> {t("archive")}
                </Button>
              }
              title={t("archive")}
              description={t("archiveConfirm", { name: pipeline.name })}
              confirmLabel={t("archive")}
              onConfirm={async () => {
                const res = await archivePipelineAction({ id: pipeline.id });
                if (!res.ok) return void toast.error(res.error.message);
                toast.success(t("saved"));
                router.refresh();
              }}
            />
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <h3 className="mb-2 text-sm font-medium">{t("stages")}</h3>
          <ol className="divide-y divide-border rounded-lg border border-border" aria-label={t("stages")}>
            {open.map((s, i) => (
              <StageRow
                key={s.id}
                stage={s}
                pipeline={pipeline}
                canMoveUp={i > 0}
                canMoveDown={i < open.length - 1}
                busy={reorder.pending}
                onMove={(delta) => move(i, delta)}
              />
            ))}
            {closed.map((s) => (
              <StageRow key={s.id} stage={s} pipeline={pipeline} canMoveUp={false} canMoveDown={false} busy={false} />
            ))}
          </ol>
          <p className="mt-2 text-xs text-muted-foreground">{t("closedStagesNote")}</p>
        </div>
        <StageDialog pipelineId={pipeline.id} />
      </CardContent>
    </Card>
  );
}

function StageRow({
  stage,
  pipeline,
  canMoveUp,
  canMoveDown,
  busy,
  onMove,
}: {
  stage: StageItem;
  pipeline: PipelineItem;
  canMoveUp: boolean;
  canMoveDown: boolean;
  busy: boolean;
  onMove?: (delta: -1 | 1) => void;
}) {
  const t = useTranslations("pipelines");
  const isOpen = stage.kind === "open";
  return (
    <li className="flex flex-wrap items-center gap-3 px-3 py-2.5" data-testid="stage-row">
      <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: stage.color }} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium" dir="auto">
          {stage.name}
        </p>
        <p className="text-xs text-muted-foreground">
          {stage.probability}% · {t("dealsInStage", { count: stage.dealCount })}
        </p>
      </div>
      {!isOpen && <Badge tone={stage.kind === "won" ? "success" : "danger"}>{t(`kinds.${stage.kind}`)}</Badge>}
      <div className="flex items-center gap-0.5">
        {isOpen && (
          <>
            <Button variant="ghost" size="icon-sm" aria-label={t("moveUp", { name: stage.name })} disabled={!canMoveUp || busy} onClick={() => onMove?.(-1)}>
              <ArrowUp />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label={t("moveDown", { name: stage.name })} disabled={!canMoveDown || busy} onClick={() => onMove?.(1)}>
              <ArrowDown />
            </Button>
          </>
        )}
        <StageDialog pipelineId={pipeline.id} stage={stage} />
        {isOpen && <DeleteStageDialog stage={stage} pipeline={pipeline} />}
      </div>
    </li>
  );
}

/** Add (no `stage`) or edit a stage. */
function StageDialog({ pipelineId, stage }: { pipelineId: string; stage?: StageItem }) {
  const t = useTranslations("pipelines");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [color, setColor] = useState(stage?.color ?? STAGE_COLORS[1]);
  const add = useServerAction(addStageAction, { successMessage: t("saved") });
  const update = useServerAction(updateStageAction, { successMessage: t("saved") });
  const action = stage ? update : add;
  const idp = stage ? `stage-${stage.id}` : `new-stage-${pipelineId}`;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {stage ? (
          <Button variant="ghost" size="icon-sm" aria-label={t("editStage", { name: stage.name })}>
            <Pencil />
          </Button>
        ) : (
          <Button variant="secondary" size="sm">
            <Plus /> {t("addStage")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent size="sm" closeLabel={tc("close")}>
        <DialogHeader>
          <DialogTitle>{stage ? t("editStage", { name: stage.name }) : t("addStage")}</DialogTitle>
        </DialogHeader>
        <form
          noValidate
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const d = formToObject(e.currentTarget);
            const data = { name: d.name, probability: d.probability, kind: stage ? d.kind : "open", color };
            const res = stage ? await update.run({ id: stage.id, ...data }) : await add.run({ pipelineId, ...data });
            if (res.ok) {
              setOpen(false);
              router.refresh();
            }
          }}
        >
          <Field label={t("stageName")} htmlFor={`${idp}-name`} error={action.fieldErrors.name} required>
            <Input id={`${idp}-name`} name="name" defaultValue={stage?.name} required maxLength={60} autoFocus dir="auto" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("probability")} htmlFor={`${idp}-probability`} error={action.fieldErrors.probability}>
              <Input id={`${idp}-probability`} name="probability" type="number" min={0} max={100} defaultValue={stage?.probability ?? 20} />
            </Field>
            {stage && (
              <Field label={t("kind")} htmlFor={`${idp}-kind`} error={action.fieldErrors.kind}>
                <NativeSelect id={`${idp}-kind`} name="kind" defaultValue={stage.kind}>
                  {(["open", "won", "lost"] as const).map((k) => (
                    <option key={k} value={k}>
                      {t(`kinds.${k}`)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
          </div>
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">{t("color")}</legend>
            <div className="flex flex-wrap items-center gap-2">
              {STAGE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="size-7 rounded-full border-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  style={{ backgroundColor: c, borderColor: color === c ? "var(--color-foreground)" : "transparent" }}
                  aria-label={c}
                  aria-pressed={color === c}
                  onClick={() => setColor(c)}
                />
              ))}
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                aria-label={t("customColor")}
                className="size-7 cursor-pointer rounded border border-border bg-transparent"
              />
            </div>
          </fieldset>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" loading={action.pending}>
              {stage ? tc("save") : tc("add")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteStageDialog({ stage, pipeline }: { stage: StageItem; pipeline: PipelineItem }) {
  const t = useTranslations("pipelines");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const targets = pipeline.stages.filter((s) => s.id !== stage.id);
  const [target, setTarget] = useState(targets.find((s) => s.kind === "open")?.id ?? "");
  const { run, pending, fieldErrors } = useServerAction(deleteStageAction, { successMessage: tc("deleted") });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="danger-ghost" size="icon-sm" aria-label={t("deleteStage", { name: stage.name })}>
          <Trash2 />
        </Button>
      </DialogTrigger>
      <DialogContent size="sm" closeLabel={tc("close")}>
        <DialogHeader>
          <DialogTitle>{t("deleteStageTitle", { name: stage.name })}</DialogTitle>
          {stage.dealCount > 0 && <DialogDescription>{t("deleteStageBody")}</DialogDescription>}
        </DialogHeader>
        {stage.dealCount > 0 && (
          <Field label={t("moveDealsTo")} htmlFor={`move-${stage.id}`} error={fieldErrors.moveToStageId}>
            <NativeSelect id={`move-${stage.id}`} value={target} onChange={(e) => setTarget(e.target.value)}>
              {targets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        )}
        <DialogFooter>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            {tc("cancel")}
          </Button>
          <Button
            variant="danger"
            loading={pending}
            onClick={async () => {
              const res = await run({ id: stage.id, moveToStageId: stage.dealCount > 0 ? target || null : null });
              if (res.ok) {
                setOpen(false);
                router.refresh();
              }
            }}
          >
            {tc("delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* --------------------------------------------------------- lost reasons */

export function LostReasonsManager({ reasons }: { reasons: LostReasonItem[] }) {
  const t = useTranslations("pipelines");
  const router = useRouter();
  const create = useServerAction(createLostReasonAction, { successMessage: t("saved") });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("lostReasons")}</CardTitle>
        <p className="text-sm text-muted-foreground">{t("lostReasonsHint")}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {reasons.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noReasons")}</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {reasons.map((r) => (
              <LostReasonRow key={r.id} reason={r} />
            ))}
          </ul>
        )}
        <form
          noValidate
          className="flex flex-col gap-2 sm:flex-row sm:items-start"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const d = formToObject(form);
            const res = await create.run({ label: d.label });
            if (res.ok) {
              form.reset();
              router.refresh();
            }
          }}
        >
          <Field label={t("reasonLabel")} htmlFor="new-reason" error={create.fieldErrors.label} className="flex-1">
            <Input id="new-reason" name="label" maxLength={80} dir="auto" placeholder={t("reasonPlaceholder")} />
          </Field>
          <Button type="submit" variant="secondary" loading={create.pending} className="sm:mt-6">
            <Plus /> {t("addReason")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function LostReasonRow({ reason }: { reason: LostReasonItem }) {
  const t = useTranslations("pipelines");
  const tc = useTranslations("common");
  const router = useRouter();
  const [label, setLabel] = useState(reason.label);
  const update = useServerAction(updateLostReasonAction, { successMessage: t("saved") });
  const dirty = label.trim() !== reason.label && label.trim().length > 0;
  return (
    <li className="flex flex-wrap items-center gap-3 px-3 py-2" data-testid="lost-reason-row">
      <Input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        aria-label={t("reasonLabel")}
        maxLength={80}
        dir="auto"
        className="h-8 min-w-40 flex-1"
      />
      {dirty && (
        <Button size="sm" loading={update.pending} onClick={() => update.run({ id: reason.id, label: label.trim(), active: reason.active })}>
          {tc("save")}
        </Button>
      )}
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <Switch
          checked={reason.active}
          disabled={update.pending}
          onCheckedChange={async (active) => {
            const res = await update.run({ id: reason.id, label: reason.label, active });
            if (res.ok) router.refresh();
          }}
        />
        {reason.active ? t("active") : t("inactive")}
      </label>
      <ConfirmDialog
        trigger={
          <Button variant="danger-ghost" size="icon-sm" aria-label={t("deleteReason", { name: reason.label })}>
            <Trash2 />
          </Button>
        }
        onConfirm={async () => {
          const res = await deleteLostReasonAction({ id: reason.id });
          if (!res.ok) return void toast.error(res.error.message);
          toast.success(tc("deleted"));
          router.refresh();
        }}
      />
    </li>
  );
}

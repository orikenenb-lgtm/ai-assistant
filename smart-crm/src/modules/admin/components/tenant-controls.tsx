"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Eye, PauseCircle, PlayCircle, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Alert } from "@/components/ui/primitives";
import { Checkbox } from "@/components/ui/controls";
import { useServerAction } from "@/hooks/use-server-action";
import {
  adminChangePlanAction,
  cancelTenantDeletionAction,
  scheduleTenantDeletionAction,
  setTenantFeatureFlagAction,
  setTenantOverrideAction,
  setTenantStatusAction,
  startSupportSessionAction,
} from "../actions";

const LIMIT_KEYS = ["max_contacts", "ai_tokens_monthly", "whatsapp_messages_monthly", "max_workflows", "storage_mb", "seats"] as const;
const FEATURES = ["crm", "tasks", "documents", "whatsapp", "ai", "automation", "analytics", "api", "custom_fields", "webhooks", "audit_export", "priority_support"] as const;
const DURATIONS = [15, 30, 60, 120, 240];

export function AdminPlanForm({
  tenantId,
  plans,
  currentPlanId,
  currentInterval,
  stripeManaged,
}: {
  tenantId: string;
  plans: { id: string; name: string }[];
  currentPlanId: string | null;
  currentInterval: "month" | "year";
  stripeManaged: boolean;
}) {
  const t = useTranslations("admin.tenant");
  const router = useRouter();
  const [planId, setPlanId] = useState(currentPlanId ?? "free");
  const [interval, setInterval] = useState<"month" | "year">(currentInterval);
  const [force, setForce] = useState(false);
  const { run, pending } = useServerAction(adminChangePlanAction, { successMessage: t("planSaved") });
  if (stripeManaged) return <Alert tone="info">{t("stripeManaged")}</Alert>;
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const res = await run({ tenantId, planId, interval, force });
        if (res.ok) router.refresh();
      }}
    >
      <Field label={t("plan")} htmlFor="admin-plan">
        <NativeSelect id="admin-plan" value={planId} onChange={(e) => setPlanId(e.target.value)} className="min-w-40">
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label={t("interval")} htmlFor="admin-interval">
        <NativeSelect id="admin-interval" value={interval} onChange={(e) => setInterval(e.target.value as "month" | "year")}>
          <option value="month">{t("monthly")}</option>
          <option value="year">{t("yearly")}</option>
        </NativeSelect>
      </Field>
      <label className="flex h-9 items-center gap-2 text-sm">
        <Checkbox checked={force} onCheckedChange={(v) => setForce(v === true)} /> {t("forceLimits")}
      </label>
      <Button type="submit" loading={pending}>
        {t("applyPlan")}
      </Button>
    </form>
  );
}

type OverrideState = { limits: Partial<Record<(typeof LIMIT_KEYS)[number], number>>; featuresAdd: string[]; featuresRemove: string[]; note: string | null };

export function OverrideEditor({ tenantId, initial, planFeatures }: { tenantId: string; initial: OverrideState; planFeatures: string[] }) {
  const t = useTranslations("admin.tenant");
  const tf = useTranslations("billing.features");
  const tl = useTranslations("admin.limits");
  const router = useRouter();
  const [limits, setLimits] = useState<Record<string, string>>(Object.fromEntries(LIMIT_KEYS.map((k) => [k, initial.limits[k] !== undefined ? String(initial.limits[k]) : ""])));
  const [mode, setMode] = useState<Record<string, "plan" | "add" | "remove">>(
    Object.fromEntries(FEATURES.map((f) => [f, initial.featuresAdd.includes(f) ? "add" : initial.featuresRemove.includes(f) ? "remove" : "plan"])),
  );
  const [note, setNote] = useState(initial.note ?? "");
  const { run, pending, fieldErrors } = useServerAction(setTenantOverrideAction, { successMessage: t("overrideSaved") });
  return (
    <form
      className="space-y-5"
      data-testid="override-editor"
      onSubmit={async (e) => {
        e.preventDefault();
        const parsedLimits = Object.fromEntries(Object.entries(limits).map(([k, v]) => [k, v.trim() === "" ? null : Number(v)]));
        const res = await run({
          tenantId,
          override: {
            limits: parsedLimits,
            featuresAdd: FEATURES.filter((f) => mode[f] === "add"),
            featuresRemove: FEATURES.filter((f) => mode[f] === "remove"),
            note: note || undefined,
          },
        });
        if (res.ok) router.refresh();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {LIMIT_KEYS.map((k) => (
          <Field key={k} label={tl(k)} htmlFor={`limit-${k}`} hint={t("limitHint")} error={fieldErrors[`override.limits.${k}`]}>
            <Input id={`limit-${k}`} type="number" min={0} value={limits[k]} onChange={(e) => setLimits((s) => ({ ...s, [k]: e.target.value }))} dir="ltr" />
          </Field>
        ))}
      </div>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">{t("features")}</legend>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <label key={f} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm">
              <span>
                {tf(f)} {planFeatures.includes(f) && <span className="text-xs text-muted-foreground">({t("inPlan")})</span>}
              </span>
              <NativeSelect
                aria-label={tf(f)}
                value={mode[f]}
                onChange={(e) => setMode((m) => ({ ...m, [f]: e.target.value as "plan" | "add" | "remove" }))}
                className="h-8 w-28"
                data-testid={`feature-${f}`}
              >
                <option value="plan">{t("modePlan")}</option>
                <option value="add">{t("modeAdd")}</option>
                <option value="remove">{t("modeRemove")}</option>
              </NativeSelect>
            </label>
          ))}
        </div>
      </fieldset>
      <Field label={t("note")} htmlFor="override-note">
        <Input id="override-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} dir="auto" />
      </Field>
      <Button type="submit" loading={pending}>
        {t("saveOverride")}
      </Button>
    </form>
  );
}

function ReasonDialog({
  trigger,
  title,
  description,
  confirmLabel,
  tone = "danger",
  extra,
  onConfirm,
}: {
  trigger: React.ReactNode;
  title: string;
  description: string;
  confirmLabel: string;
  tone?: "danger" | "primary";
  extra?: (set: (v: string) => void) => React.ReactNode;
  onConfirm: (reason: string, extraValue: string) => Promise<boolean>;
}) {
  const t = useTranslations("admin.tenant");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [extraValue, setExtraValue] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent size="sm" closeLabel={tc("close")}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label={t("reason")} htmlFor="reason" required>
            <Textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} dir="auto" />
          </Field>
          {extra?.(setExtraValue)}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            {tc("cancel")}
          </Button>
          <Button
            variant={tone === "danger" ? "danger" : "primary"}
            loading={busy}
            disabled={reason.trim().length < 5}
            onClick={async () => {
              setBusy(true);
              const ok = await onConfirm(reason, extraValue);
              setBusy(false);
              if (ok) setOpen(false);
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function StatusControls({ tenantId, status }: { tenantId: string; status: string }) {
  const t = useTranslations("admin.tenant");
  const router = useRouter();
  const suspend = status === "active";
  return (
    <ReasonDialog
      trigger={
        <Button variant={suspend ? "danger-ghost" : "soft"} size="sm">
          {suspend ? <PauseCircle /> : <PlayCircle />} {suspend ? t("suspend") : t("reactivate")}
        </Button>
      }
      title={suspend ? t("suspendTitle") : t("reactivateTitle")}
      description={suspend ? t("suspendBody") : t("reactivateBody")}
      confirmLabel={suspend ? t("suspend") : t("reactivate")}
      tone={suspend ? "danger" : "primary"}
      onConfirm={async (reason) => {
        const res = await setTenantStatusAction({ tenantId, status: suspend ? "suspended" : "active", reason });
        if (!res.ok) {
          toast.error(res.error.message);
          return false;
        }
        router.refresh();
        return true;
      }}
    />
  );
}

export function DeletionControls({ tenantId, slug, deleted }: { tenantId: string; slug: string; deleted: boolean }) {
  const t = useTranslations("admin.tenant");
  const router = useRouter();
  if (deleted) {
    return (
      <Button
        variant="soft"
        size="sm"
        onClick={async () => {
          const res = await cancelTenantDeletionAction({ tenantId });
          if (!res.ok) return void toast.error(res.error.message);
          toast.success(t("deletionCanceled"));
          router.refresh();
        }}
      >
        <Undo2 /> {t("cancelDeletion")}
      </Button>
    );
  }
  return (
    <ReasonDialog
      trigger={
        <Button variant="danger-ghost" size="sm">
          <Trash2 /> {t("scheduleDeletion")}
        </Button>
      }
      title={t("deleteTitle")}
      description={t("deleteBody", { slug })}
      confirmLabel={t("scheduleDeletion")}
      extra={(set) => (
        <Field label={t("typeSlug", { slug })} htmlFor="confirm-slug" required>
          <Input id="confirm-slug" onChange={(e) => set(e.target.value)} dir="ltr" />
        </Field>
      )}
      onConfirm={async (reason, confirmSlug) => {
        const res = await scheduleTenantDeletionAction({ tenantId, reason, confirmSlug });
        if (!res.ok) {
          toast.error(res.error.message);
          return false;
        }
        router.refresh();
        return true;
      }}
    />
  );
}

export function StartSupportButton({ tenantId, tenantName, disabled }: { tenantId: string; tenantName: string; disabled?: boolean }) {
  const t = useTranslations("admin.support");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [minutes, setMinutes] = useState("30");
  const { run, pending, fieldErrors } = useServerAction(startSupportSessionAction);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary" disabled={disabled}>
          <Eye /> {t("start")}
        </Button>
      </DialogTrigger>
      <DialogContent size="sm" closeLabel={tc("close")}>
        <DialogHeader>
          <DialogTitle>{t("startTitle", { org: tenantName })}</DialogTitle>
          <DialogDescription>{t("startBody")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label={t("reason")} htmlFor="support-reason" hint={t("reasonHint")} error={fieldErrors.reason} required>
            <Textarea id="support-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} dir="auto" />
          </Field>
          <Field label={t("duration")} htmlFor="support-minutes">
            <NativeSelect id="support-minutes" value={minutes} onChange={(e) => setMinutes(e.target.value)}>
              {DURATIONS.map((m) => (
                <option key={m} value={m}>
                  {t("minutes", { n: m })}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            {tc("cancel")}
          </Button>
          <Button
            loading={pending}
            disabled={reason.trim().length < 10}
            onClick={async () => {
              const res = await run({ tenantId, reason, minutes: Number(minutes) });
              if (res.ok) {
                setOpen(false);
                router.push(res.data.redirectTo);
                router.refresh();
              }
            }}
          >
            {t("enter")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TenantFlagOverrides({ tenantId, flags }: { tenantId: string; flags: { key: string; globalEnabled: boolean; override: boolean | null }[] }) {
  const t = useTranslations("admin.flags");
  const router = useRouter();
  const set = async (key: string, enabled: boolean | null) => {
    const res = await setTenantFeatureFlagAction({ tenantId, key, enabled });
    if (!res.ok) return void toast.error(res.error.message);
    router.refresh();
  };
  return (
    <ul className="divide-y divide-border text-sm">
      {flags.map((f) => (
        <li key={f.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
          <span className="font-mono text-xs" dir="ltr">
            {f.key}
          </span>
          <NativeSelect
            aria-label={f.key}
            value={f.override === null ? "inherit" : f.override ? "on" : "off"}
            onChange={(e) => set(f.key, e.target.value === "inherit" ? null : e.target.value === "on")}
            className="h-8 w-44"
          >
            <option value="inherit">{t("inherit", { state: f.globalEnabled ? t("on") : t("off") })}</option>
            <option value="on">{t("forceOn")}</option>
            <option value="off">{t("forceOff")}</option>
          </NativeSelect>
        </li>
      ))}
    </ul>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { LogOut, Plus, RotateCcw, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/controls";
import { ConfirmDialog } from "@/components/data/confirm-dialog";
import { AsyncCombobox, type ComboOption } from "@/components/data/async-combobox";
import { useServerAction } from "@/hooks/use-server-action";
import {
  cancelDeadJobAction,
  createFeatureFlagAction,
  endSupportSessionAction,
  retryDeadJobAction,
  searchTenantsAction,
  setFeatureFlagAction,
  setTenantFeatureFlagAction,
  startSupportSessionAction,
} from "../actions";

export function FlagToggle({ flagKey, enabled }: { flagKey: string; enabled: boolean }) {
  const t = useTranslations("admin.flags");
  const router = useRouter();
  const [value, setValue] = useState(enabled);
  return (
    <Switch
      checked={value}
      aria-label={t("toggle", { key: flagKey })}
      onCheckedChange={async (v) => {
        setValue(v);
        const res = await setFeatureFlagAction({ key: flagKey, enabled: v });
        if (!res.ok) {
          setValue(!v);
          toast.error(res.error.message);
          return;
        }
        router.refresh();
      }}
    />
  );
}

export function RemoveTenantFlagOverride({ tenantId, flagKey }: { tenantId: string; flagKey: string }) {
  const t = useTranslations("admin.flags");
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={async () => {
        const res = await setTenantFeatureFlagAction({ tenantId, key: flagKey, enabled: null });
        if (!res.ok) return void toast.error(res.error.message);
        router.refresh();
      }}
    >
      {t("removeOverride")}
    </Button>
  );
}

export function CreateFlagForm() {
  const t = useTranslations("admin.flags");
  const router = useRouter();
  const { run, pending, fieldErrors } = useServerAction(createFeatureFlagAction, { successMessage: t("created") });
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = new FormData(form);
        const res = await run({ key: String(f.get("key") ?? ""), description: String(f.get("description") ?? "") });
        if (res.ok) {
          form.reset();
          router.refresh();
        }
      }}
    >
      <Field label={t("key")} htmlFor="flag-key" error={fieldErrors.key}>
        <Input id="flag-key" name="key" placeholder="module.feature" dir="ltr" className="w-56" required />
      </Field>
      <Field label={t("description")} htmlFor="flag-description" className="min-w-64 flex-1">
        <Input id="flag-description" name="description" dir="auto" />
      </Field>
      <Button type="submit" loading={pending}>
        <Plus /> {t("create")}
      </Button>
    </form>
  );
}

export function DeadJobActions({ jobId }: { jobId: number }) {
  const t = useTranslations("admin.jobs");
  const router = useRouter();
  return (
    <div className="flex justify-end gap-1">
      <Button
        variant="soft"
        size="sm"
        onClick={async () => {
          const res = await retryDeadJobAction({ jobId });
          if (!res.ok) return void toast.error(res.error.message);
          toast.success(t("retried"));
          router.refresh();
        }}
      >
        <RotateCcw /> {t("retry")}
      </Button>
      <ConfirmDialog
        title={t("cancelTitle")}
        description={t("cancelBody")}
        confirmLabel={t("cancel")}
        trigger={
          <Button variant="danger-ghost" size="sm">
            <XCircle /> {t("cancel")}
          </Button>
        }
        onConfirm={async () => {
          const res = await cancelDeadJobAction({ jobId });
          if (!res.ok) return void toast.error(res.error.message);
          router.refresh();
        }}
      />
    </div>
  );
}

const DURATIONS = [15, 30, 60, 120, 240];

export function StartSupportForm() {
  const t = useTranslations("admin.support");
  const router = useRouter();
  const [tenant, setTenant] = useState<ComboOption | null>(null);
  const [reason, setReason] = useState("");
  const [minutes, setMinutes] = useState("30");
  const search = useCallback((input: { q: string }) => searchTenantsAction(input), []);
  const { run, pending, fieldErrors } = useServerAction(startSupportSessionAction);
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!tenant) return;
        const res = await run({ tenantId: tenant.id, reason, minutes: Number(minutes) });
        if (res.ok) {
          router.push(res.data.redirectTo);
          router.refresh();
        }
      }}
    >
      <Field label={t("tenant")} htmlFor="support-tenant" error={fieldErrors.tenantId}>
        <AsyncCombobox id="support-tenant" value={tenant} onChange={setTenant} search={search} placeholder={t("chooseTenant")} />
      </Field>
      <Field label={t("reason")} htmlFor="support-form-reason" hint={t("reasonHint")} error={fieldErrors.reason} required>
        <Textarea id="support-form-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} dir="auto" />
      </Field>
      <Field label={t("duration")} htmlFor="support-form-minutes">
        <NativeSelect id="support-form-minutes" value={minutes} onChange={(e) => setMinutes(e.target.value)} className="w-48">
          {DURATIONS.map((m) => (
            <option key={m} value={m}>
              {t("minutes", { n: m })}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Button type="submit" loading={pending} disabled={!tenant || reason.trim().length < 10}>
        {t("enter")}
      </Button>
    </form>
  );
}

export function EndSupportButton({ sessionId }: { sessionId: string }) {
  const t = useTranslations("admin.support");
  const router = useRouter();
  return (
    <Button
      variant="danger-ghost"
      size="sm"
      onClick={async () => {
        const res = await endSupportSessionAction({ sessionId });
        if (!res.ok) return void toast.error(res.error.message);
        toast.success(t("endedToast"));
        router.refresh();
      }}
    >
      <LogOut /> {t("end")}
    </Button>
  );
}

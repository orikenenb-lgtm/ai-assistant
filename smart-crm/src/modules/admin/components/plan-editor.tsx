"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Checkbox, Switch } from "@/components/ui/controls";
import { useServerAction } from "@/hooks/use-server-action";
import { updatePlanAction } from "../actions";

const LIMIT_KEYS = ["max_contacts", "ai_tokens_monthly", "whatsapp_messages_monthly", "max_workflows", "storage_mb"] as const;
const FEATURES = ["crm", "tasks", "documents", "whatsapp", "ai", "automation", "analytics", "api", "custom_fields", "webhooks", "audit_export", "priority_support"] as const;

export type EditablePlan = {
  id: string;
  name: { he: string; en: string };
  description: { he: string; en: string };
  priceMonthlyCents: number;
  priceYearlyCents: number;
  trialDays: number;
  seatLimit: number | null;
  limits: Partial<Record<(typeof LIMIT_KEYS)[number], number>>;
  features: string[];
  isPublic: boolean;
  active: boolean;
  stripePriceMonth: string;
  stripePriceYear: string;
};

const toAgorot = (v: string) => Math.round(Number(v || 0) * 100);

export function PlanEditor({ plan }: { plan: EditablePlan }) {
  const t = useTranslations("admin.plans");
  const tc = useTranslations("common");
  const tf = useTranslations("billing.features");
  const tl = useTranslations("admin.limits");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [features, setFeatures] = useState<string[]>(plan.features);
  const [isPublic, setIsPublic] = useState(plan.isPublic);
  const [active, setActive] = useState(plan.active);
  const { run, pending, fieldErrors } = useServerAction(updatePlanAction, { successMessage: t("saved") });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm" aria-label={`${tc("edit")} ${plan.name.en}`}>
          <Pencil /> {tc("edit")}
        </Button>
      </DialogTrigger>
      <DialogContent size="xl" closeLabel={tc("close")}>
        <DialogHeader>
          <DialogTitle>{t("editTitle", { plan: plan.name.en })}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-5"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const get = (k: string) => String(f.get(k) ?? "");
            const limits = Object.fromEntries(LIMIT_KEYS.filter((k) => get(`limit_${k}`) !== "").map((k) => [k, Number(get(`limit_${k}`))]));
            const res = await run({
              planId: plan.id,
              data: {
                nameHe: get("nameHe"),
                nameEn: get("nameEn"),
                descriptionHe: get("descriptionHe"),
                descriptionEn: get("descriptionEn"),
                priceMonthlyCents: toAgorot(get("priceMonthly")),
                priceYearlyCents: toAgorot(get("priceYearly")),
                trialDays: Number(get("trialDays") || 0),
                seatLimit: get("seatLimit") === "" ? null : Number(get("seatLimit")),
                limits,
                features,
                isPublic,
                active,
                stripePriceMonth: get("stripePriceMonth"),
                stripePriceYear: get("stripePriceYear"),
              },
            });
            if (res.ok) {
              setOpen(false);
              router.refresh();
            }
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("nameHe")} htmlFor="nameHe" error={fieldErrors["data.nameHe"]}>
              <Input id="nameHe" name="nameHe" defaultValue={plan.name.he} dir="rtl" />
            </Field>
            <Field label={t("nameEn")} htmlFor="nameEn" error={fieldErrors["data.nameEn"]}>
              <Input id="nameEn" name="nameEn" defaultValue={plan.name.en} dir="ltr" />
            </Field>
            <Field label={t("descriptionHe")} htmlFor="descriptionHe">
              <Textarea id="descriptionHe" name="descriptionHe" defaultValue={plan.description.he} rows={2} dir="rtl" />
            </Field>
            <Field label={t("descriptionEn")} htmlFor="descriptionEn">
              <Textarea id="descriptionEn" name="descriptionEn" defaultValue={plan.description.en} rows={2} dir="ltr" />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-4">
            <Field label={t("priceMonthly")} htmlFor="priceMonthly" error={fieldErrors["data.priceMonthlyCents"]}>
              <Input id="priceMonthly" name="priceMonthly" type="number" min={0} step="0.01" defaultValue={plan.priceMonthlyCents / 100} dir="ltr" />
            </Field>
            <Field label={t("priceYearly")} htmlFor="priceYearly" error={fieldErrors["data.priceYearlyCents"]}>
              <Input id="priceYearly" name="priceYearly" type="number" min={0} step="0.01" defaultValue={plan.priceYearlyCents / 100} dir="ltr" />
            </Field>
            <Field label={t("trialDays")} htmlFor="trialDays" error={fieldErrors["data.trialDays"]}>
              <Input id="trialDays" name="trialDays" type="number" min={0} max={90} defaultValue={plan.trialDays} dir="ltr" />
            </Field>
            <Field label={t("seatLimit")} htmlFor="seatLimit" hint={t("emptyUnlimited")}>
              <Input id="seatLimit" name="seatLimit" type="number" min={1} defaultValue={plan.seatLimit ?? ""} dir="ltr" />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {LIMIT_KEYS.map((k) => (
              <Field key={k} label={tl(k)} htmlFor={`limit_${k}`} hint={t("emptyUnlimited")}>
                <Input id={`limit_${k}`} name={`limit_${k}`} type="number" min={0} defaultValue={plan.limits[k] ?? ""} dir="ltr" />
              </Field>
            ))}
          </div>
          <fieldset>
            <legend className="mb-2 text-sm font-medium">{t("features")}</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {FEATURES.map((f) => (
                <label key={f} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={features.includes(f)}
                    onCheckedChange={(v) => setFeatures((cur) => (v === true ? [...new Set([...cur, f])] : cur.filter((x) => x !== f)))}
                  />
                  {tf(f)}
                </label>
              ))}
            </div>
            {fieldErrors["data.features"] && <p className="mt-1 text-xs text-danger-foreground">{fieldErrors["data.features"][0]}</p>}
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("stripePriceMonth")} htmlFor="stripePriceMonth" error={fieldErrors["data.stripePriceMonth"]}>
              <Input id="stripePriceMonth" name="stripePriceMonth" defaultValue={plan.stripePriceMonth} placeholder="price_…" dir="ltr" />
            </Field>
            <Field label={t("stripePriceYear")} htmlFor="stripePriceYear" error={fieldErrors["data.stripePriceYear"]}>
              <Input id="stripePriceYear" name="stripePriceYear" defaultValue={plan.stripePriceYear} placeholder="price_…" dir="ltr" />
            </Field>
          </div>
          <div className="flex flex-wrap gap-6 text-sm">
            <label className="flex items-center gap-2">
              <Switch checked={isPublic} onCheckedChange={setIsPublic} /> {t("public")}
            </label>
            <label className="flex items-center gap-2">
              <Switch checked={active} onCheckedChange={setActive} /> {t("active")}
            </label>
          </div>
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

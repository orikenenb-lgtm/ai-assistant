"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Check, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, Card } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/data/confirm-dialog";
import { formatMoney, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { changePlanAction } from "../actions";
import type { PlanView } from "../plans";

type Interval = "month" | "year";

export function PlanPicker({
  plans,
  current,
  canManage,
}: {
  plans: PlanView[];
  current: { planId: string; interval: Interval; status: string; cancelAtPeriodEnd: boolean };
  canManage: boolean;
}) {
  const t = useTranslations("billing");
  const locale = useLocale() as "he" | "en";
  const router = useRouter();
  const [interval, setInterval] = useState<Interval>(current.interval);

  const choose = async (plan: PlanView) => {
    const res = await changePlanAction({ planId: plan.id, interval });
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    if (res.data.type === "redirect") {
      window.location.assign(res.data.url);
      return;
    }
    toast.success(t("planChanged", { plan: plan.name[locale] }));
    router.refresh();
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{t("plansTitle")}</h2>
        <div role="radiogroup" aria-label={t("interval")} className="inline-flex rounded-lg bg-muted p-1">
          {(["month", "year"] as const).map((i) => (
            <button
              key={i}
              role="radio"
              aria-checked={interval === i}
              onClick={() => setInterval(i)}
              className={cn(
                "rounded-md px-3 py-1 text-sm font-medium transition-colors",
                interval === i ? "bg-surface text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`intervals.${i}`)}
              {i === "year" && <span className="ms-1 text-xs text-success-foreground">{t("yearlySave")}</span>}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {plans.map((plan) => {
          const isCurrent = plan.id === current.planId && (plan.priceMonthlyCents === 0 || interval === current.interval) && current.status !== "trialing";
          const isTrialPlan = plan.id === current.planId && current.status === "trialing";
          const price = interval === "year" ? plan.priceYearlyCents : plan.priceMonthlyCents;
          return (
            <Card key={plan.id} className={cn("flex flex-col p-5", (isCurrent || isTrialPlan) && "border-primary ring-1 ring-primary")} data-testid={`plan-${plan.id}`}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold">{plan.name[locale]}</h3>
                {isCurrent && <Badge tone="primary">{t("currentPlan")}</Badge>}
                {isTrialPlan && (
                  <Badge tone="ai">
                    <Sparkles /> {t("inTrial")}
                  </Badge>
                )}
              </div>
              <p className="mt-1 min-h-10 text-sm text-muted-foreground">{plan.description[locale]}</p>
              <p className="mt-3">
                <span className="tabular text-2xl font-semibold">{price === 0 ? t("free") : formatMoney(price, plan.currency, locale)}</span>
                {price > 0 && <span className="text-sm text-muted-foreground"> {t(interval === "year" ? "perSeatYear" : "perSeatMonth")}</span>}
              </p>
              <ul className="mt-4 flex-1 space-y-1.5 text-sm">
                <li className="flex items-center gap-2">
                  <Check className="size-4 shrink-0 text-success" />
                  {plan.seatLimit === null ? t("unlimitedSeats") : t("seatsUpTo", { n: plan.seatLimit })}
                </li>
                {plan.limits.max_contacts !== undefined && (
                  <li className="flex items-center gap-2">
                    <Check className="size-4 shrink-0 text-success" />
                    {t("contactsUpTo", { n: formatNumber(plan.limits.max_contacts, locale) })}
                  </li>
                )}
                {plan.features
                  .filter((f) => f !== "crm")
                  .map((f) => (
                    <li key={f} className="flex items-center gap-2">
                      <Check className="size-4 shrink-0 text-success" />
                      {t(`features.${f}`)}
                    </li>
                  ))}
              </ul>
              {canManage && !isCurrent && (
                <ConfirmDialog
                  tone="primary"
                  title={t("confirmChangeTitle", { plan: plan.name[locale] })}
                  description={price === 0 ? t("confirmDowngradeBody") : t("confirmChangeBody")}
                  confirmLabel={t("confirm")}
                  trigger={
                    <Button className="mt-5 w-full" variant={plan.id === current.planId ? "soft" : "secondary"}>
                      {isTrialPlan ? t("subscribeNow") : t("choose")}
                    </Button>
                  }
                  onConfirm={() => choose(plan)}
                />
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

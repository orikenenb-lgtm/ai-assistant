"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { CreditCard, RotateCcw, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/data/confirm-dialog";
import { cancelSubscriptionAction, openBillingPortalAction, resumeSubscriptionAction } from "../actions";

export function SubscriptionActions({ canCancel, canResume }: { canCancel: boolean; canResume: boolean }) {
  const t = useTranslations("billing");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="secondary"
        size="sm"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          const res = await openBillingPortalAction();
          setBusy(false);
          if (!res.ok) return void toast.error(res.error.message);
          window.location.assign(res.data.url);
        }}
      >
        <CreditCard /> {t("managePayment")}
      </Button>
      {canResume && (
        <Button
          variant="soft"
          size="sm"
          onClick={async () => {
            const res = await resumeSubscriptionAction();
            if (!res.ok) return void toast.error(res.error.message);
            toast.success(t("resumed"));
            router.refresh();
          }}
        >
          <RotateCcw /> {t("resume")}
        </Button>
      )}
      {canCancel && (
        <ConfirmDialog
          title={t("cancelTitle")}
          description={t("cancelBody")}
          confirmLabel={t("cancelConfirm")}
          trigger={
            <Button variant="danger-ghost" size="sm">
              <XCircle /> {t("cancel")}
            </Button>
          }
          onConfirm={async () => {
            const res = await cancelSubscriptionAction();
            if (!res.ok) return void toast.error(res.error.message);
            toast.success(t("cancelScheduled"));
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

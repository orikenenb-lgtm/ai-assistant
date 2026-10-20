"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { classifyLeadAction } from "../actions";

/** Scores the lead with AI and stores the class + reason on the lead (audit-logged, no other side effects). */
export function LeadAiButton({ leadId }: { leadId: string }) {
  const t = useTranslations("ai");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="ai"
      loading={busy}
      onClick={async () => {
        setBusy(true);
        const res = await classifyLeadAction({ leadId });
        setBusy(false);
        if (!res.ok) return void toast.error(res.error.message);
        toast.success(`${t(`leadClasses.${res.data.classification}`)} · ${t("leadScore", { score: res.data.score })}`);
        router.refresh();
      }}
    >
      {!busy && <Sparkles />} {t("classifyLead")}
    </Button>
  );
}

"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Check, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { approveProposalAction, rejectProposalAction } from "../actions";
import type { ProposalView } from "../proposals";

export function ProposalsPanel({ initial, canApprove }: { initial: ProposalView[]; canApprove: boolean }) {
  const t = useTranslations("ai");
  const [items, setItems] = useState(initial);
  const decide = async (id: string, approve: boolean) => {
    const res = approve ? await approveProposalAction({ id }) : await rejectProposalAction({ id });
    if (!res.ok) return void toast.error(res.error.message);
    toast.success(approve ? t("approved") : t("rejected"));
    setItems((prev) => prev.filter((p) => p.id !== id));
  };
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-ai" /> {t("proposalsTitle")}
          </CardTitle>
          <CardDescription>{t("proposalsHelp")}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noProposals")}</p>
        ) : (
          <ul className="space-y-3">
            {items.map((p) => (
              <li key={p.id} className="rounded-lg border border-border p-3 text-sm">
                <p className="font-medium">{t(`proposalTypes.${p.actionType}` as "proposalTypes.add_note")}</p>
                {p.rationale && (
                  <p className="mt-1 text-muted-foreground" dir="auto">
                    {p.rationale}
                  </p>
                )}
                <p className="mt-1 text-xs text-muted-foreground">{p.requestedByName ?? "—"}</p>
                {canApprove && (
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" onClick={() => decide(p.id, true)}>
                      <Check /> {t("approve")}
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => decide(p.id, false)}>
                      <X /> {t("reject")}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

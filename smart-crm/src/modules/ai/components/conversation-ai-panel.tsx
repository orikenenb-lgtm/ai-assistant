"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Compass, NotebookPen, Sparkles, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/primitives";
import { detectIntentAction, summarizeConversationAction } from "../actions";
import type { ConversationSummary, Intent } from "../features";

type IntentResult = { intent: Intent; confidence: number; needsHuman: boolean; reason: string };

/** Summary + intent for the open WhatsApp conversation. Read-only: nothing is sent or changed. */
export function ConversationAiPanel({ conversationId, mock }: { conversationId: string; mock: boolean }) {
  const t = useTranslations("ai");
  const [summary, setSummary] = useState<{ id: string; data: ConversationSummary } | null>(null);
  const [intent, setIntent] = useState<{ id: string; data: IntentResult } | null>(null);
  const [loading, setLoading] = useState<"summary" | "intent" | null>(null);

  // Results belong to one conversation; switching threads hides stale output.
  const s = summary?.id === conversationId ? summary.data : null;
  const i = intent?.id === conversationId ? intent.data : null;

  const run = async (kind: "summary" | "intent") => {
    setLoading(kind);
    if (kind === "summary") {
      const res = await summarizeConversationAction({ conversationId });
      if (res.ok) setSummary({ id: conversationId, data: res.data });
      else toast.error(res.error.message);
    } else {
      const res = await detectIntentAction({ conversationId });
      if (res.ok) setIntent({ id: conversationId, data: res.data });
      else toast.error(res.error.message);
    }
    setLoading(null);
  };

  return (
    <section className="space-y-3 rounded-xl border border-ai/30 p-3" aria-label={t("conversationTitle")}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <Sparkles className="size-4 text-ai" aria-hidden /> {t("conversationTitle")}
        </h3>
        {mock && <Badge tone="warning">{t("mockBadge")}</Badge>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="ai" loading={loading === "summary"} onClick={() => run("summary")}>
          <NotebookPen /> {t("summarizeConversation")}
        </Button>
        <Button size="sm" variant="secondary" loading={loading === "intent"} onClick={() => run("intent")}>
          <Compass /> {t("detectIntent")}
        </Button>
      </div>
      <div aria-live="polite" className="space-y-3 text-sm">
        {i && (
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="ai">{t(`intents.${i.intent}`)}</Badge>
            <span className="text-xs text-muted-foreground">{t("confidence", { value: Math.round(i.confidence * 100) })}</span>
            {i.needsHuman && (
              <Badge tone="warning">
                <UserRound /> {t("needsHuman")}
              </Badge>
            )}
            <p className="w-full text-xs text-muted-foreground" dir="auto">
              {i.reason}
            </p>
          </div>
        )}
        {s && (
          <div className="space-y-2">
            {s.suspicious && (
              <p className="flex gap-1.5 rounded-lg bg-warning-soft p-2 text-xs text-warning-foreground">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {t("suspicious")}
              </p>
            )}
            <div className="flex items-center gap-2">
              <Badge tone={s.sentiment === "positive" ? "success" : s.sentiment === "negative" ? "danger" : "neutral"}>{t(`sentiments.${s.sentiment}`)}</Badge>
            </div>
            <p dir="auto">{s.summary}</p>
            {s.keyPoints.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground">{t("keyPoints")}</p>
                <ul className="mt-1 list-disc space-y-0.5 ps-4">
                  {s.keyPoints.map((k, n) => (
                    <li key={n} dir="auto">
                      {k}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {s.openQuestions.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground">{t("openQuestions")}</p>
                <ul className="mt-1 list-disc space-y-0.5 ps-4">
                  {s.openQuestions.map((k, n) => (
                    <li key={n} dir="auto">
                      {k}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">{t("disclaimer")}</p>
          </div>
        )}
      </div>
    </section>
  );
}

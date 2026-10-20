"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { AlertTriangle, CheckCircle2, Lightbulb, NotebookPen, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@/components/ui/primitives";
import { createProposalAction, nextActionsAction, summarizeContactAction } from "../actions";
import type { RecommendedAction } from "../features";

type Brief = { summary: string; highlights: string[]; risks: string[]; suggestedNextStep: string };

/** AI brief + next best actions on a contact. Suggestions become proposals; nothing changes without approval. */
export function ContactAiPanel({ contactId, mock }: { contactId: string; mock: boolean }) {
  const t = useTranslations("ai");
  const [brief, setBrief] = useState<Brief | null>(null);
  const [actions, setActions] = useState<RecommendedAction[] | null>(null);
  const [loading, setLoading] = useState<"brief" | "actions" | null>(null);
  const [proposed, setProposed] = useState<Set<number>>(new Set());

  const run = async (kind: "brief" | "actions") => {
    setLoading(kind);
    if (kind === "brief") {
      const res = await summarizeContactAction({ contactId });
      if (res.ok) setBrief(res.data);
      else toast.error(res.error.message);
    } else {
      const res = await nextActionsAction({ entityType: "contact", entityId: contactId });
      if (res.ok) setActions(res.data);
      else toast.error(res.error.message);
    }
    setLoading(null);
  };

  const proposeNote = async (i: number, a: RecommendedAction) => {
    const res = await createProposalAction({
      actionType: "add_note",
      payload: { entityType: "contact", entityId: contactId, body: `${t("aiSuggestion")}: ${a.title}\n${a.rationale}` },
      rationale: a.rationale,
    });
    if (!res.ok) return void toast.error(res.error.message);
    setProposed((s) => new Set(s).add(i));
    toast.success(t("proposalCreated"));
  };

  return (
    <Card className="border-ai/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-4 text-ai" /> AI Copilot
        </CardTitle>
        {mock && <Badge tone="warning">{t("mockBadge")}</Badge>}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ai" loading={loading === "brief"} onClick={() => run("brief")}>
            <NotebookPen /> {t("summarize")}
          </Button>
          <Button size="sm" variant="secondary" loading={loading === "actions"} onClick={() => run("actions")}>
            <Lightbulb /> {t("nextActions")}
          </Button>
        </div>
        {brief && (
          <div className="space-y-2 text-sm" aria-live="polite">
            <p dir="auto">{brief.summary}</p>
            {brief.highlights.length > 0 && (
              <ul className="space-y-1">
                {brief.highlights.map((h, i) => (
                  <li key={i} className="flex gap-2" dir="auto">
                    <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" /> {h}
                  </li>
                ))}
              </ul>
            )}
            {brief.risks.length > 0 && (
              <ul className="space-y-1">
                {brief.risks.map((r, i) => (
                  <li key={i} className="flex gap-2 text-warning-foreground" dir="auto">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {r}
                  </li>
                ))}
              </ul>
            )}
            <p className="rounded-lg bg-ai-soft px-3 py-2 text-ai-foreground" dir="auto">
              <strong>{t("nextStep")}:</strong> {brief.suggestedNextStep}
            </p>
          </div>
        )}
        {actions && (
          <ul className="space-y-2" aria-live="polite">
            {actions.map((a, i) => (
              <li key={i} className="rounded-lg border border-border p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium" dir="auto">
                    {a.title}
                  </p>
                  <Badge tone={a.priority === "high" || a.priority === "urgent" ? "danger" : "neutral"}>{t(`priority.${a.priority}`)}</Badge>
                </div>
                <p className="mt-1 text-muted-foreground" dir="auto">
                  {a.rationale}
                </p>
                <Button size="sm" variant="ghost" className="mt-1 px-2" disabled={proposed.has(i)} onClick={() => proposeNote(i, a)}>
                  {proposed.has(i) ? t("proposalCreated") : t("proposeAsNote")}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">{t("disclaimer")}</p>
      </CardContent>
    </Card>
  );
}

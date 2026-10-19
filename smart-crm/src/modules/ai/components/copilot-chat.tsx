"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { Bot, Check, Loader2, Send, Sparkles, User, Wrench, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, Card } from "@/components/ui/primitives";
import { Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { approveProposalAction, copilotChatAction, rejectProposalAction } from "../actions";

type Turn = { role: "user" | "assistant"; content: string; toolsUsed?: string[]; proposals?: { id: string; actionType: string; rationale: string | null; state?: "approved" | "rejected" }[] };

/** Renders plain text with /internal/links turned into Next links (no HTML injection). */
function RichText({ text }: { text: string }) {
  const parts = text.split(/(\/(?:contacts|companies|deals|leads|tasks|quotes|inbox)\/[0-9a-f-]{36})/g);
  return (
    <p className="whitespace-pre-wrap text-sm leading-relaxed" dir="auto">
      {parts.map((p, i) =>
        /^\/(contacts|companies|deals|leads|tasks|quotes|inbox)\//.test(p) ? (
          <Link key={i} href={p} className="font-medium text-primary underline underline-offset-2" dir="ltr">
            {p}
          </Link>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </p>
  );
}

export function CopilotChat({ mock, canApprove }: { mock: boolean; canApprove: boolean }) {
  const t = useTranslations("ai");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const suggestions = [t("suggestions.search"), t("suggestions.tasks"), t("suggestions.pipeline"), t("suggestions.trends")];

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || busy) return;
    const next: Turn[] = [...turns, { role: "user", content }];
    setTurns(next);
    setInput("");
    setBusy(true);
    const res = await copilotChatAction({ history: next.map(({ role, content }) => ({ role, content })) });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error.message);
      setTurns(next);
      return;
    }
    setTurns([...next, { role: "assistant", content: res.data.answer, toolsUsed: res.data.toolsUsed, proposals: res.data.proposals }]);
    requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: "smooth" }));
  };

  const decide = async (turnIndex: number, proposalId: string, approve: boolean) => {
    const res = approve ? await approveProposalAction({ id: proposalId }) : await rejectProposalAction({ id: proposalId });
    if (!res.ok) return void toast.error(res.error.message);
    toast.success(approve ? t("approved") : t("rejected"));
    setTurns((prev) =>
      prev.map((turn, i) =>
        i === turnIndex ? { ...turn, proposals: turn.proposals?.map((p) => (p.id === proposalId ? { ...p, state: approve ? "approved" : "rejected" } : p)) } : turn,
      ),
    );
  };

  return (
    <Card className="flex h-[calc(100dvh-12rem)] min-h-[480px] flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-ai-soft text-ai-foreground">
            <Sparkles className="size-4" />
          </span>
          <div>
            <p className="text-sm font-semibold">AI Copilot</p>
            <p className="text-xs text-muted-foreground">{t("chatHint")}</p>
          </div>
        </div>
        {mock && <Badge tone="warning">{t("mockBadge")}</Badge>}
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-5" aria-live="polite">
        {turns.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <Bot className="size-10 text-ai" />
            <p className="max-w-sm text-sm text-muted-foreground">{t("emptyChat")}</p>
            <div className="flex flex-wrap justify-center gap-2">
              {suggestions.map((s) => (
                <button key={s} onClick={() => send(s)} className="rounded-full border border-border px-3 py-1.5 text-sm hover:bg-accent">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((turn, i) => (
          <div key={i} className={cn("flex gap-3", turn.role === "user" && "flex-row-reverse")}>
            <span
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-full",
                turn.role === "user" ? "bg-primary-soft text-primary-soft-foreground" : "bg-ai-soft text-ai-foreground",
              )}
              aria-hidden
            >
              {turn.role === "user" ? <User className="size-4" /> : <Bot className="size-4" />}
            </span>
            <div className={cn("max-w-[80%] space-y-2 rounded-2xl px-4 py-3", turn.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted")}>
              {turn.toolsUsed && turn.toolsUsed.length > 0 && (
                <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                  <Wrench className="size-3" /> {turn.toolsUsed.map((x) => t(`tools.${x}` as "tools.search_crm")).join(" · ")}
                </p>
              )}
              <RichText text={turn.content} />
              {turn.proposals?.map((p) => (
                <div key={p.id} className="rounded-xl border border-ai/30 bg-surface p-3 text-foreground">
                  <p className="text-xs font-semibold text-ai-foreground">{t(`proposalTypes.${p.actionType}` as "proposalTypes.add_note")}</p>
                  {p.rationale && <p className="mt-1 text-sm" dir="auto">{p.rationale}</p>}
                  {p.state ? (
                    <Badge tone={p.state === "approved" ? "success" : "neutral"} className="mt-2">
                      {p.state === "approved" ? t("approved") : t("rejected")}
                    </Badge>
                  ) : canApprove ? (
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" onClick={() => decide(i, p.id, true)}>
                        <Check /> {t("approve")}
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => decide(i, p.id, false)}>
                        <X /> {t("reject")}
                      </Button>
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-muted-foreground">{t("awaitingApproval")}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
        {busy && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> {t("thinking")}
          </p>
        )}
        <div ref={endRef} />
      </div>

      <form
        className="flex items-end gap-2 border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
          rows={1}
          maxLength={4000}
          placeholder={t("placeholder")}
          aria-label={t("placeholder")}
          className="min-h-10 resize-none"
          dir="auto"
          data-testid="copilot-input"
        />
        <Button type="submit" size="icon" variant="ai" disabled={busy || !input.trim()} aria-label={t("send")}>
          {busy ? <Loader2 className="animate-spin" /> : <Send className="rtl:-scale-x-100" />}
        </Button>
      </form>
    </Card>
  );
}

"use client";

import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { Clock, Paperclip, Send, ShieldOff, StickyNote } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { addConversationNoteAction, sendMessageAction } from "../actions";
import { TemplateDialog, type TemplateOption } from "./template-dialog";

type Props = {
  conversationId: string;
  window: { open: boolean; msLeft: number };
  consent: "unknown" | "opted_in" | "opted_out";
  accountActive: boolean;
  canReply: boolean;
  templates: TemplateOption[];
  onSent: () => void;
};

export function Composer({ conversationId, window, consent, accountActive, canReply, templates, onSent }: Props) {
  const t = useTranslations("inbox.composer");
  const tErr = useTranslations("inbox");
  const [mode, setMode] = useState<"reply" | "note">("reply");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const blocked = !canReply ? t("readOnly") : consent === "opted_out" ? t("optedOut") : !accountActive ? t("accountInactive") : null;
  const replyDisabled = Boolean(blocked) || !window.open;

  const send = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    const res =
      mode === "note"
        ? await addConversationNoteAction({ conversationId, body })
        : await sendMessageAction({ conversationId, message: { kind: "text", text: body }, clientKey: crypto.randomUUID() });
    setBusy(false);
    if (!res.ok) return void toast.error(res.error.message);
    setText("");
    onSent();
  };

  const sendTemplate = async (input: { templateId: string; headerParams: string[]; bodyParams: string[] }) => {
    const res = await sendMessageAction({ conversationId, message: { kind: "template", ...input }, clientKey: crypto.randomUUID() });
    if (!res.ok) {
      toast.error(res.error.message);
      return false;
    }
    onSent();
    return true;
  };

  const upload = async (file: File) => {
    setBusy(true);
    const form = new FormData();
    form.set("file", file);
    form.set("conversationId", conversationId);
    if (text.trim()) form.set("caption", text.trim());
    const res = await fetch("/inbox/attachments", { method: "POST", body: form });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      const key = data.error?.startsWith("inbox.") ? data.error.slice(6) : null;
      return void toast.error(key ? tErr(key as "fileTooLarge") : (data.error ?? "upload failed"));
    }
    setText("");
    onSent();
  };

  return (
    <div className="border-t border-border bg-surface p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="inline-flex rounded-lg bg-muted p-0.5 text-xs" role="tablist">
          {(["reply", "note"] as const).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={cn("flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition-colors", mode === m ? "bg-surface shadow-xs" : "text-muted-foreground")}
            >
              {m === "note" && <StickyNote className="size-3" />}
              {t(m)}
            </button>
          ))}
        </div>
        {mode === "reply" && !blocked && (
          <span className={cn("flex items-center gap-1 text-[11px]", window.open ? "text-muted-foreground" : "text-warning-foreground")} data-testid="window-indicator">
            <Clock className="size-3" />
            {window.open ? t("windowOpen", { hours: Math.max(1, Math.round(window.msLeft / 3600_000)) }) : t("windowClosed")}
          </span>
        )}
      </div>

      {(mode === "reply" && blocked) || !canReply ? (
        <p className="flex items-center gap-2 rounded-lg bg-muted px-3 py-3 text-sm text-muted-foreground" role="status">
          <ShieldOff className="size-4 shrink-0" /> {blocked}
        </p>
      ) : (
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          {mode === "reply" && (
            <div className="flex shrink-0 gap-1 pb-0.5">
              <TemplateDialog templates={templates} onSend={sendTemplate} prominent={!window.open} />
              {window.open && (
                <>
                  <input
                    ref={fileRef}
                    type="file"
                    className="sr-only"
                    accept="image/jpeg,image/png,application/pdf,audio/ogg,audio/mpeg,video/mp4,.doc,.docx,.xls,.xlsx,.txt"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f) void upload(f);
                    }}
                    aria-label={t("attach")}
                  />
                  <Button type="button" variant="ghost" size="icon-sm" onClick={() => fileRef.current?.click()} disabled={busy} aria-label={t("attach")}>
                    <Paperclip />
                  </Button>
                </>
              )}
            </div>
          )}
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={mode === "note" ? t("notePlaceholder") : t("placeholder")}
            aria-label={mode === "note" ? t("note") : t("reply")}
            disabled={mode === "reply" && replyDisabled}
            rows={2}
            maxLength={4096}
            dir="auto"
            className={cn("min-h-11 resize-none", mode === "note" && "border-warning/50 bg-warning-soft/40")}
          />
          <Button type="submit" size="icon" loading={busy} disabled={!text.trim() || (mode === "reply" && replyDisabled)} aria-label={mode === "note" ? t("addNote") : t("send")}>
            {!busy && (mode === "note" ? <StickyNote /> : <Send className="rtl:-scale-x-100" />)}
          </Button>
        </form>
      )}
    </div>
  );
}

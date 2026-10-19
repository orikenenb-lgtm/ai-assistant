"use client";

import { useLocale, useTranslations } from "next-intl";
import { AlertCircle, Bot, Check, CheckCheck, Clock, FileText, StickyNote, Workflow } from "lucide-react";
import { Tooltip } from "@/components/ui/menu";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ThreadMessage, ThreadNote } from "../service";

function StatusIcon({ m }: { m: ThreadMessage }) {
  const t = useTranslations("inbox.message.status");
  const label = t(m.status as "sent");
  const icon =
    m.status === "read" ? (
      <CheckCheck className="size-3.5 text-info" />
    ) : m.status === "delivered" ? (
      <CheckCheck className="size-3.5" />
    ) : m.status === "sent" ? (
      <Check className="size-3.5" />
    ) : m.status === "failed" ? (
      <AlertCircle className="size-3.5 text-danger" />
    ) : (
      <Clock className="size-3.5" />
    );
  return (
    <span role="img" aria-label={label} title={m.status === "failed" ? `${label}: ${m.errorMessage ?? ""}` : label} data-status={m.status} data-testid="message-status">
      {icon}
    </span>
  );
}

function Media({ m }: { m: ThreadMessage }) {
  const t = useTranslations("inbox.message");
  if (!m.media) return null;
  if (m.media.tooLarge) return <p className="text-xs italic text-muted-foreground">{t("mediaTooLarge")}</p>;
  if (!m.media.available) return <p className="text-xs italic text-muted-foreground">{t("mediaPending")}</p>;
  const src = `/inbox/media/${m.id}`;
  if (m.type === "image" || m.type === "sticker") {
    // eslint-disable-next-line @next/next/no-img-element -- authorized private media, not optimizable
    return <img src={src} alt={m.body ?? m.media.fileName ?? ""} loading="lazy" className="max-h-72 max-w-full rounded-lg object-contain" />;
  }
  if (m.type === "audio") return <audio controls src={src} className="max-w-full" />;
  if (m.type === "video") return <video controls src={src} className="max-h-72 max-w-full rounded-lg" />;
  return (
    <a href={`${src}?download=1`} className="flex items-center gap-2 rounded-lg bg-background/60 px-3 py-2 text-sm hover:underline" dir="auto">
      <FileText className="size-4 shrink-0" />
      <span className="truncate">{m.media.fileName ?? t("download")}</span>
    </a>
  );
}

export function MessageBubble({ m }: { m: ThreadMessage }) {
  const t = useTranslations("inbox.message");
  const locale = useLocale() as "he" | "en";
  const outbound = m.direction === "outbound";
  return (
    <div className={cn("flex", outbound ? "justify-end" : "justify-start")} data-testid="message" data-direction={m.direction}>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm shadow-xs sm:max-w-[70%]",
          outbound ? "rounded-ee-md bg-primary-soft text-foreground" : "rounded-es-md border border-border bg-surface",
          m.status === "failed" && "border border-danger/40",
        )}
      >
        {m.type === "template" && m.templateName && (
          <p className="mb-1 flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
            <FileText className="size-3" /> {t("template", { name: m.templateName })}
          </p>
        )}
        <Media m={m} />
        {m.body ? (
          <p className={cn("whitespace-pre-wrap break-words", m.media && "mt-1.5")} dir="auto">
            {m.body}
          </p>
        ) : m.type === "unsupported" ? (
          <p className="italic text-muted-foreground">{t("unsupported")}</p>
        ) : null}
        <div className="mt-1 flex items-center justify-end gap-1.5 text-[11px] text-muted-foreground">
          {outbound && m.senderType === "ai" && <Bot className="size-3" aria-label={t("byAi")} />}
          {outbound && m.senderType === "automation" && <Workflow className="size-3" aria-label={t("byAutomation")} />}
          {outbound && m.senderName && <span className="truncate">{m.senderName}</span>}
          <time dateTime={new Date(m.createdAt).toISOString()}>{formatTime(m.createdAt, locale)}</time>
          {outbound && <StatusIcon m={m} />}
        </div>
        {m.status === "failed" && (
          <Tooltip content={m.errorMessage ?? ""}>
            <p className="mt-1 text-[11px] font-medium text-danger-foreground">
              {t("failed")}
              {m.errorCode ? ` (${m.errorCode})` : ""}
            </p>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

export function NoteBubble({ n }: { n: ThreadNote }) {
  const t = useTranslations("inbox.message");
  const locale = useLocale() as "he" | "en";
  return (
    <div className="mx-auto w-full max-w-[90%] rounded-xl border border-warning/50 bg-warning-soft px-3.5 py-2 text-sm" data-testid="internal-note">
      <p className="mb-0.5 flex items-center gap-1 text-[11px] font-semibold text-warning-foreground">
        <StickyNote className="size-3" /> {t("internalNote")} · {n.authorName ?? "—"} · {formatTime(n.createdAt, locale)}
      </p>
      <p className="whitespace-pre-wrap" dir="auto">
        {n.body}
      </p>
    </div>
  );
}

"use client";

import { Pause, Play } from "lucide-react";
import { clsx } from "clsx";
import { brand } from "@/config/site";
import type { Line } from "@/content/industries";
import { formatMinutes } from "@/lib/format";
import { conversationDurationSeconds } from "@/components/demo/useConversationPlayer";

export function PlayButton({
  playing,
  elapsed,
  lines,
  onPlay,
  onStop,
  label = "האזינו לשיחה",
}: {
  playing: boolean;
  elapsed: number;
  lines: Line[];
  onPlay: () => void;
  onStop: () => void;
  label?: string;
}) {
  const total = conversationDurationSeconds(lines);
  return (
    <button
      type="button"
      onClick={playing ? onStop : onPlay}
      aria-pressed={playing}
      className="inline-flex items-center gap-3 rounded-full border border-line bg-surface py-1.5 ps-1.5 pe-4 text-sm font-bold text-ink shadow-soft transition hover:shadow-card"
    >
      <span className="grid size-9 place-items-center rounded-full bg-forest text-white dark:bg-brand dark:text-brand-ink">
        {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
      </span>
      {playing ? "עצירה" : label}
      <span className="tabular ltr text-ink-3">{formatMinutes(playing ? Math.min(elapsed, total) : total)}</span>
    </button>
  );
}

export function TranscriptLines({
  lines,
  visible,
  customerLabel = "לקוח/ה",
  className,
}: {
  lines: Line[];
  visible: number;
  customerLabel?: string;
  className?: string;
}) {
  return (
    <ol className={clsx("space-y-3", className)} aria-live="polite">
      {lines.slice(0, visible).map((line, i) => (
        <li key={i} className={clsx("flex animate-in", line.who === "customer" ? "justify-start" : "justify-end")}>
          <div
            className={clsx(
              "max-w-[88%] rounded-2xl px-4 py-2.5 sm:max-w-[80%]",
              line.who === "customer"
                ? "rounded-ss-md border border-line bg-surface text-ink"
                : "rounded-se-md bg-forest text-on-forest dark:bg-forest-3",
            )}
          >
            <p className={clsx("text-xs font-semibold", line.who === "customer" ? "text-ink-3" : "text-accent")}>
              {line.who === "customer" ? customerLabel : `${brand.agentName}, הנציגה`}
            </p>
            <p className="mt-0.5 leading-relaxed">{line.text}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

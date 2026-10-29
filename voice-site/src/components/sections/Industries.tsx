"use client";

import { Building2, Car, Check, PhoneIncoming, PhoneOutgoing, Scale, Stethoscope, UtensilsCrossed, Wrench } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";
import { clsx } from "clsx";
import { industries, type Industry } from "@/content/industries";
import { SectionHeading } from "@/components/ui/Section";
import { PlayButton, TranscriptLines } from "@/components/demo/Transcript";
import { useConversationPlayer } from "@/components/demo/useConversationPlayer";

const ICONS: Record<Industry["icon"], typeof Car> = {
  stethoscope: Stethoscope,
  car: Car,
  scale: Scale,
  building: Building2,
  utensils: UtensilsCrossed,
  wrench: Wrench,
};

function Panel({ industry }: { industry: Industry }) {
  const player = useConversationPlayer(industry.dialog);
  const outbound = industry.direction.includes("יוצאת");
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
      <div className="rounded-[1.75rem] border border-line bg-surface-2/70 p-5 sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-2">
            {outbound ? <PhoneOutgoing className="size-4 text-brand" /> : <PhoneIncoming className="size-4 text-brand" />}
            {industry.direction}
          </p>
          <PlayButton playing={player.playing} elapsed={player.elapsed} lines={industry.dialog} onPlay={player.play} onStop={player.stop} />
        </div>
        <div className="mt-5 min-h-[17rem]">
          <TranscriptLines lines={industry.dialog} visible={player.visible} />
        </div>
      </div>
      <div className="flex flex-col rounded-[1.75rem] border border-line bg-surface p-5 sm:p-7">
        <h3 className="text-xl font-bold leading-snug">{industry.headline}</h3>
        <p className="mt-5 text-sm font-semibold text-ink-3">מה הנציגה עושה כאן</p>
        <ul className="mt-3 space-y-2.5">
          {industry.does.map((d) => (
            <li key={d} className="flex items-start gap-2.5">
              <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-brand-soft text-brand">
                <Check className="size-3.5" aria-hidden="true" />
              </span>
              <span className="leading-relaxed text-ink-2">{d}</span>
            </li>
          ))}
        </ul>
        <div className="mt-auto pt-6">
          <p className="text-xs font-semibold text-ink-3">מתחברת ל:</p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {industry.tools.map((t) => (
              <li key={t} className="rounded-full border border-line bg-surface-2 px-3 py-1 text-sm">
                {t}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

export function Industries() {
  const [active, setActive] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    // RTL: ArrowLeft moves forward, ArrowRight moves back.
    const delta = e.key === "ArrowLeft" ? 1 : e.key === "ArrowRight" ? -1 : 0;
    let next = index;
    if (delta) next = (index + delta + industries.length) % industries.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = industries.length - 1;
    else return;
    e.preventDefault();
    setActive(next);
    tabs.current[next]?.focus();
  };

  const industry = industries[active];

  return (
    <section id="industries" aria-labelledby="industries-title" className="container-page scroll-mt-24 py-20 sm:py-28">
      <SectionHeading
        id="industries-title"
        eyebrow="למי זה מתאים"
        title="ככה זה נשמע בעסק כמו שלכם."
        lead="אותה נציגה, עם הידע, התסריטים והחיבורים של התחום שלכם. בחרו תחום ולחצו להאזנה."
      />

      <div data-reveal className="mt-10">
        <div role="tablist" aria-label="תחומים" className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
          {industries.map((ind, i) => {
            const Icon = ICONS[ind.icon];
            const selected = i === active;
            return (
              <button
                key={ind.id}
                ref={(el) => {
                  tabs.current[i] = el;
                }}
                role="tab"
                id={`tab-${ind.id}`}
                aria-selected={selected}
                aria-controls={`panel-${ind.id}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setActive(i)}
                onKeyDown={(e) => onKeyDown(e, i)}
                className={clsx(
                  "inline-flex shrink-0 items-center gap-2 rounded-full border px-4 py-2.5 text-[0.95rem] font-semibold transition-colors",
                  selected ? "border-forest bg-forest text-on-forest dark:border-brand dark:bg-brand dark:text-brand-ink" : "border-line bg-surface text-ink-2 hover:bg-surface-2 hover:text-ink",
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
                {ind.label}
              </button>
            );
          })}
        </div>

        <div role="tabpanel" id={`panel-${industry.id}`} aria-labelledby={`tab-${industry.id}`} className="mt-5" tabIndex={0}>
          <Panel key={industry.id} industry={industry} />
        </div>
      </div>
    </section>
  );
}

import { cn } from "@/lib/utils";

interface SectionHeadingProps {
  eyebrow?: string;
  title: string;
  description?: string;
  /** id for the <h2>, used by `aria-labelledby` on the section. */
  id: string;
  align?: "start" | "center";
  tone?: "dark" | "light";
  className?: string;
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  id,
  align = "center",
  tone = "dark",
  className,
}: SectionHeadingProps) {
  const light = tone === "light";
  return (
    <div
      className={cn(
        "flex max-w-2xl flex-col gap-4",
        align === "center" ? "mx-auto items-center text-center" : "items-start text-start",
        className,
      )}
    >
      {eyebrow && (
        <p
          className={cn(
            "flex items-center gap-3 text-sm font-medium tracking-[0.06em]",
            light ? "text-rose-200" : "text-rose-600",
          )}
        >
          <span aria-hidden className={cn("h-px w-8", light ? "bg-rose-200/60" : "bg-rose-400/70")} />
          {eyebrow}
        </p>
      )}
      <h2
        id={id}
        className={cn(
          "font-display text-4xl leading-[1.1] font-medium text-balance sm:text-5xl",
          light ? "text-ivory" : "text-ink",
        )}
      >
        {title}
      </h2>
      {description && (
        <p className={cn("text-base leading-relaxed text-pretty sm:text-lg", light ? "text-ivory/80" : "text-muted")}>
          {description}
        </p>
      )}
    </div>
  );
}

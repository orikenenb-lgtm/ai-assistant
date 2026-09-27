import { cn } from "@/lib/utils";

interface SectionHeadingProps {
  eyebrow?: string;
  title: string;
  /** A word or phrase inside `title` to paint in cherry. */
  highlight?: string;
  description?: string;
  /** id for the <h2>, used by `aria-labelledby` on the section. */
  id: string;
  align?: "start" | "center";
  className?: string;
}

function renderTitle(title: string, highlight?: string) {
  if (!highlight || !title.includes(highlight)) return title;
  const [before, after] = title.split(highlight);
  return (
    <>
      {before}
      <span className="text-cherry">{highlight}</span>
      {after}
    </>
  );
}

export function SectionHeading({ eyebrow, title, highlight, description, id, align = "start", className }: SectionHeadingProps) {
  return (
    <div
      className={cn(
        "flex max-w-3xl flex-col gap-4",
        align === "center" ? "mx-auto items-center text-center" : "items-start text-start",
        className,
      )}
    >
      {eyebrow && (
        <p className="flex items-center gap-3 text-sm font-bold tracking-[0.04em] text-gold">
          <span aria-hidden className="h-2 w-2 rotate-45 bg-gold" />
          {eyebrow}
        </p>
      )}
      <h2 id={id} className="font-display text-6xl leading-[0.9] font-bold text-balance text-cream sm:text-7xl lg:text-8xl">
        {renderTitle(title, highlight)}
      </h2>
      {description && <p className="max-w-xl text-lg leading-relaxed text-pretty text-mist">{description}</p>}
    </div>
  );
}

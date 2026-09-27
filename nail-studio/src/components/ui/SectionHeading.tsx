import { cn } from "@/lib/utils";

interface SectionHeadingProps {
  eyebrow?: string;
  title: string;
  /** A word or phrase inside `title` rendered with the iridescent gradient. */
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
      <span className="text-iridescent">{highlight}</span>
      {after}
    </>
  );
}

export function SectionHeading({ eyebrow, title, highlight, description, id, align = "start", className }: SectionHeadingProps) {
  return (
    <div
      className={cn(
        "flex max-w-3xl flex-col gap-5",
        align === "center" ? "mx-auto items-center text-center" : "items-start text-start",
        className,
      )}
    >
      {eyebrow && (
        <p className="flex items-center gap-4 text-sm tracking-wide text-mist">
          <span aria-hidden className="bg-iridescent h-px w-10" />
          {eyebrow}
        </p>
      )}
      <h2 id={id} className="font-display text-5xl leading-[1.05] font-extralight text-balance text-cream sm:text-6xl lg:text-7xl">
        {renderTitle(title, highlight)}
      </h2>
      {description && <p className="max-w-xl text-lg leading-relaxed text-pretty text-mist">{description}</p>}
    </div>
  );
}

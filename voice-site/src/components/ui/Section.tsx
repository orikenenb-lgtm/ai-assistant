import { clsx } from "clsx";
import type { ReactNode } from "react";

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={clsx("inline-flex items-center gap-2 text-sm font-semibold text-brand", className)}>
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {children}
    </p>
  );
}

/**
 * Section heading in the site's split layout: title on the start side, lead
 * paragraph on the end side (stacked on mobile).
 */
export function SectionHeading({
  eyebrow,
  title,
  lead,
  id,
  align = "split",
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  lead?: ReactNode;
  id?: string;
  align?: "split" | "center";
  className?: string;
}) {
  if (align === "center") {
    return (
      <div className={clsx("mx-auto max-w-2xl text-center", className)} data-reveal>
        {eyebrow ? <Eyebrow className="justify-center">{eyebrow}</Eyebrow> : null}
        <h2 id={id} className="mt-3 text-balance text-3xl font-extrabold tracking-tight sm:text-4xl lg:text-[2.75rem] lg:leading-[1.1]">
          {title}
        </h2>
        {lead ? <p className="mt-4 text-pretty text-lg leading-relaxed text-ink-2">{lead}</p> : null}
      </div>
    );
  }
  return (
    <div className={clsx("grid grid-cols-1 gap-4 lg:grid-cols-[1.15fr_1fr] lg:items-end lg:gap-16", className)} data-reveal>
      <div>
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        <h2 id={id} className="mt-3 text-balance text-3xl font-extrabold tracking-tight sm:text-4xl lg:text-[2.75rem] lg:leading-[1.1]">
          {title}
        </h2>
      </div>
      {lead ? <p className="text-pretty text-lg leading-relaxed text-ink-2 lg:pb-1">{lead}</p> : null}
    </div>
  );
}

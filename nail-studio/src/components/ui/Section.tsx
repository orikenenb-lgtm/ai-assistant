import type { ComponentPropsWithoutRef } from "react";
import type { SectionId } from "@/lib/links";
import { cn } from "@/lib/utils";

type SectionProps = Omit<ComponentPropsWithoutRef<"section">, "id"> & {
  id: SectionId;
  tone?: "ivory" | "cream";
};

/** Page section with consistent vertical rhythm and an anchor id. */
export function Section({ id, tone = "ivory", className, ...rest }: SectionProps) {
  return (
    <section
      id={id}
      className={cn(
        "relative py-20 sm:py-24 lg:py-32",
        tone === "cream" ? "bg-cream" : "bg-ivory",
        className,
      )}
      {...rest}
    />
  );
}

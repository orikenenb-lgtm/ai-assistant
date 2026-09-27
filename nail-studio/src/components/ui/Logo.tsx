import Link from "next/link";
import { brandName } from "@/config/site";
import { cn } from "@/lib/utils";

/** Brand wordmark placeholder — swap for an SVG logo when one exists. */
export function Logo({ className }: { className?: string }) {
  return (
    <Link
      href="/#home"
      className={cn("inline-flex min-h-11 items-center gap-3 rounded-md text-cream", className)}
      aria-label={`${brandName} — לעמוד הבית`}
    >
      <span aria-hidden className="bg-iridescent h-2 w-2 rotate-45" />
      <span dir="auto" className="font-display text-xl font-light tracking-[0.12em] uppercase">
        {brandName}
      </span>
    </Link>
  );
}

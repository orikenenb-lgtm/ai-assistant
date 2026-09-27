import Link from "next/link";
import { brandName } from "@/config/site";
import { cn } from "@/lib/utils";

/** Brand wordmark placeholder — swap for an SVG logo when one exists. */
export function Logo({ className }: { className?: string }) {
  return (
    <Link
      href="/#home"
      className={cn("inline-flex min-h-11 items-center gap-2.5 rounded-md text-cream", className)}
      aria-label={`${brandName} — לעמוד הבית`}
    >
      <span aria-hidden className="grid h-9 w-9 place-items-center rounded-full bg-cherry font-display text-2xl leading-none font-bold text-night">
        {brandName.charAt(0)}
      </span>
      <span dir="auto" className="font-display text-3xl leading-none font-bold tracking-wide">
        {brandName}
      </span>
    </Link>
  );
}

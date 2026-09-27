import Link from "next/link";
import { brandName } from "@/config/site";
import { cn } from "@/lib/utils";

/** Brand wordmark placeholder — swap for an SVG logo when one exists. */
export function Logo({ tone = "dark", className }: { tone?: "dark" | "light"; className?: string }) {
  return (
    <Link
      href="/#home"
      className={cn(
        "inline-flex min-h-11 items-center gap-2.5 rounded-md",
        tone === "light" ? "text-ivory" : "text-ink",
        className,
      )}
      aria-label={`${brandName} — לעמוד הבית`}
    >
      <span
        aria-hidden
        className={cn(
          "grid h-9 w-9 place-items-center rounded-full border font-display text-lg leading-none",
          tone === "light" ? "border-ivory/30" : "border-ink/15",
        )}
      >
        {brandName.charAt(0)}
      </span>
      <span dir="auto" className="font-display text-xl leading-none tracking-wide">
        {brandName}
      </span>
    </Link>
  );
}

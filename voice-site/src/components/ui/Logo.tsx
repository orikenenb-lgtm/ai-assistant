import { clsx } from "clsx";
import { brand } from "@/config/site";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={clsx("shrink-0", className)}>
      <rect width="32" height="32" rx="9" fill="currentColor" />
      <g fill="var(--logo-bars, #bfe08f)">
        <rect x="7" y="12.5" width="3" height="7" rx="1.5" />
        <rect x="12" y="8.5" width="3" height="15" rx="1.5" />
        <rect x="17" y="11" width="3" height="10" rx="1.5" />
        <rect x="22" y="13.5" width="3" height="5" rx="1.5" />
      </g>
    </svg>
  );
}

export function Logo({ className, tone = "ink" }: { className?: string; tone?: "ink" | "light" }) {
  return (
    <span className={clsx("inline-flex items-center gap-2 font-extrabold tracking-tight", className)}>
      <LogoMark className={clsx("size-8", tone === "light" ? "text-white/10" : "text-forest dark:text-forest-3")} />
      <span dir="ltr" className={clsx("whitespace-nowrap text-lg leading-none", tone === "light" ? "text-on-forest" : "text-ink")}>
        {brand.name}
      </span>
    </span>
  );
}

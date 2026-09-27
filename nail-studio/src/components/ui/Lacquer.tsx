import type { PlaceholderTone } from "@/types";
import { cn } from "@/lib/utils";

/**
 * Glossy "wet lacquer" surface — the brand's placeholder visual until real
 * photos exist. Pure CSS gradients: no network requests, no layout shift.
 */
export const lacquerTones: Record<PlaceholderTone, { base: string; deep: string; glow: string; ink: "light" | "dark" }> = {
  cherry: { base: "#ff2a5f", deep: "#8a0022", glow: "#ff8aa6", ink: "dark" },
  noir: { base: "#2a2226", deep: "#050304", glow: "#6b5a61", ink: "light" },
  gold: { base: "#f2c46d", deep: "#8a5a12", glow: "#fff0c9", ink: "dark" },
  nude: { base: "#d9a58d", deep: "#7a4533", glow: "#ffe1d3", ink: "dark" },
  fuchsia: { base: "#e0158c", deep: "#5c0036", glow: "#ff8fd0", ink: "light" },
  plum: { base: "#6b1f45", deep: "#1c0512", glow: "#c46a98", ink: "light" },
  chrome: { base: "#c9c3c6", deep: "#4a4448", glow: "#ffffff", ink: "dark" },
};

export function Lacquer({ tone, className, animated = true }: { tone: PlaceholderTone; className?: string; animated?: boolean }) {
  const t = lacquerTones[tone];
  return (
    <div
      aria-hidden
      className={cn("relative h-full w-full overflow-hidden", className)}
      style={{
        background: `radial-gradient(120% 90% at 20% 10%, ${t.glow} 0%, ${t.base} 32%, ${t.deep} 100%)`,
      }}
    >
      {/* Liquid highlight that drifts slowly, like light on wet polish */}
      <div
        className={cn("absolute -inset-1/4", animated && "animate-shine")}
        style={{
          background: `radial-gradient(40% 22% at 68% 30%, rgb(255 255 255 / 0.55), transparent 70%),
                       radial-gradient(60% 40% at 30% 85%, rgb(0 0 0 / 0.35), transparent 70%)`,
        }}
      />
      {/* Hard specular streak */}
      <div className="absolute top-[12%] end-[18%] h-[38%] w-[7%] rotate-[18deg] rounded-full bg-white/35 blur-[2px]" />
    </div>
  );
}

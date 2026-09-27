import type { PlaceholderTone } from "@/types";
import { cn } from "@/lib/utils";

/**
 * Soft iridescent "aura" surface — the brand's placeholder visual until real
 * photos exist. Pure CSS mesh gradients in pastel rose, lilac and ice.
 */
const tones: Record<PlaceholderTone, string> = {
  aura: "radial-gradient(70% 60% at 70% 25%, #f7a9c9 0%, transparent 70%), radial-gradient(55% 50% at 15% 55%, #cdbff7 0%, transparent 70%), radial-gradient(55% 45% at 45% 100%, #bfe6f7 0%, transparent 70%), #fdeef4",
  lilac: "radial-gradient(70% 60% at 30% 25%, #d9ccff 0%, transparent 65%), radial-gradient(60% 60% at 80% 85%, #b7a4f0 0%, transparent 70%), #f3eefc",
  rose: "radial-gradient(70% 60% at 70% 25%, #f9bfd6 0%, transparent 65%), radial-gradient(60% 60% at 20% 85%, #e98ab2 0%, transparent 70%), #fceaf1",
  ice: "radial-gradient(70% 60% at 30% 30%, #e3f5fd 0%, transparent 60%), radial-gradient(60% 60% at 80% 80%, #a7d9ef 0%, transparent 70%), #eef7fb",
  chrome: "radial-gradient(60% 45% at 30% 25%, #ffffff 0%, transparent 60%), radial-gradient(50% 50% at 75% 70%, #e6dfee 0%, transparent 70%), linear-gradient(160deg, #f4eef4, #d8cfdc)",
  dusk: "radial-gradient(75% 70% at 75% 20%, #f4a3c4 0%, transparent 65%), radial-gradient(55% 50% at 20% 85%, #c9b8f5 0%, transparent 70%), #fbe9f0",
  noir: "radial-gradient(50% 40% at 30% 25%, #f1e4ea 0%, transparent 70%), radial-gradient(60% 60% at 80% 90%, #d9c3cf 0%, transparent 70%), #efe3e8",
};

export function Aura({ tone, className, animated = false }: { tone: PlaceholderTone; className?: string; animated?: boolean }) {
  return (
    <div aria-hidden className={cn("relative h-full w-full overflow-hidden", className)}>
      <div className={cn("absolute -inset-[15%]", animated && "animate-aura")} style={{ background: tones[tone] }} />
      {/* Fine pearl sheen, like light across a glazed nail */}
      <div className="absolute inset-0 bg-[linear-gradient(115deg,transparent_40%,rgb(255_255_255/0.45)_48%,transparent_56%)]" />
    </div>
  );
}

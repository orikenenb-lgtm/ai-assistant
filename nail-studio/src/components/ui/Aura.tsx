import type { PlaceholderTone } from "@/types";
import { cn } from "@/lib/utils";

/**
 * Iridescent "chrome aura" surface — the brand's placeholder visual until real
 * photos exist. Pure CSS mesh gradients: no network, no layout shift.
 */
const tones: Record<PlaceholderTone, string> = {
  aura: "radial-gradient(75% 65% at 70% 25%, #f0a3d2 0%, transparent 70%), radial-gradient(55% 50% at 15% 55%, #9b7bff 0%, transparent 70%), radial-gradient(55% 45% at 45% 100%, #8fd3f4 0%, transparent 70%), #2a1624",
  violet: "radial-gradient(70% 60% at 30% 25%, #b39cff 0%, transparent 65%), radial-gradient(60% 60% at 80% 85%, #5a3fd1 0%, transparent 70%), #1a1430",
  orchid: "radial-gradient(70% 60% at 70% 25%, #f5b3d9 0%, transparent 65%), radial-gradient(60% 60% at 20% 85%, #9c3f79 0%, transparent 70%), #2a1523",
  ice: "radial-gradient(70% 60% at 30% 30%, #d6f1ff 0%, transparent 60%), radial-gradient(60% 60% at 80% 80%, #4b8fb8 0%, transparent 70%), #13212b",
  chrome: "radial-gradient(60% 45% at 30% 25%, #ffffff 0%, transparent 60%), radial-gradient(50% 50% at 75% 70%, #c9c3de 0%, transparent 70%), linear-gradient(160deg, #8e88a0, #3a3645)",
  dusk: "radial-gradient(75% 70% at 75% 20%, #e98bc4 0%, transparent 65%), radial-gradient(55% 50% at 20% 85%, #9b7bff 0%, transparent 70%), #24121f",
  noir: "radial-gradient(50% 40% at 30% 25%, #4a4458 0%, transparent 70%), radial-gradient(60% 60% at 80% 90%, #2a2236 0%, transparent 70%), #0f0d14",
};

export function Aura({ tone, className, animated = false }: { tone: PlaceholderTone; className?: string; animated?: boolean }) {
  return (
    <div aria-hidden className={cn("relative h-full w-full overflow-hidden", className)}>
      <div className={cn("absolute -inset-[15%]", animated && "animate-aura")} style={{ background: tones[tone] }} />
      {/* Fine sheen line, like light across a chrome nail */}
      <div className="absolute inset-0 bg-[linear-gradient(115deg,transparent_40%,rgb(255_255_255/0.12)_48%,transparent_56%)]" />
    </div>
  );
}

import type { PlaceholderTone } from "@/types";
import { cn } from "@/lib/utils";

/**
 * Abstract, brand-safe artwork used wherever real photos are not yet available.
 * Pure SVG + CSS — no network requests, no layout shift.
 */

interface ToneSpec {
  background: string;
  nail: string;
  tip?: string;
  accent: string;
}

export const toneSpecs: Record<PlaceholderTone, ToneSpec> = {
  nude: { background: "linear-gradient(160deg,#f3e9df 0%,#e2cdbd 100%)", nail: "#c9a48e", accent: "#b48c77" },
  rose: { background: "linear-gradient(160deg,#f5e7e3 0%,#e2c1bf 100%)", nail: "#b77f82", accent: "#9f6a6e" },
  ivory: { background: "linear-gradient(160deg,#fbf8f4 0%,#ede3d8 100%)", nail: "#f0ddd6", tip: "#fffdfa", accent: "#d8c0ad" },
  mocha: { background: "linear-gradient(160deg,#dcc9bb 0%,#b69a8a 100%)", nail: "#7e5f53", accent: "#6a4f45" },
  blush: { background: "linear-gradient(160deg,#f8eeeb 0%,#ebd3ce 100%)", nail: "#d8a9a6", tip: "#fbf3f1", accent: "#c79290" },
  sand: { background: "linear-gradient(160deg,#f4ece3 0%,#e1d1c0 100%)", nail: "#cdb59d", accent: "#b89d83" },
};

const NAIL_PATH = "M30 2C41 2 58 30 58 56V118H2V56C2 30 19 2 30 2Z";

function Nail({ x, y, rotate, scale = 1, tone }: { x: number; y: number; rotate: number; scale?: number; tone: ToneSpec }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rotate} 30 60) scale(${scale})`}>
      <path d={NAIL_PATH} fill={tone.nail} />
      {tone.tip && <path d="M30 2C41 2 58 30 58 48C44 40 16 40 2 48C2 30 19 2 30 2Z" fill={tone.tip} />}
      <path d="M15 34C17 24 22 15 27 12" stroke="#fff" strokeOpacity="0.55" strokeWidth="3" strokeLinecap="round" fill="none" />
      <path d={NAIL_PATH} fill="none" stroke="#000" strokeOpacity="0.05" />
    </g>
  );
}

export type NailArtComposition = "fan" | "single" | "duo" | "row";

interface NailArtProps {
  tone: PlaceholderTone;
  composition?: NailArtComposition;
  className?: string;
}

export function NailArt({ tone, composition = "single", className }: NailArtProps) {
  const spec = toneSpecs[tone];
  return (
    <div
      aria-hidden
      className={cn("relative h-full w-full overflow-hidden", className)}
      style={{ background: spec.background }}
    >
      {/* soft light blooms */}
      <div className="absolute -top-1/4 -end-1/4 h-3/4 w-3/4 rounded-full bg-white/35 blur-3xl" />
      <div className="absolute -bottom-1/3 -start-1/4 h-2/3 w-2/3 rounded-full blur-3xl" style={{ background: spec.accent, opacity: 0.18 }} />

      <svg viewBox="0 0 200 200" preserveAspectRatio="xMidYMid meet" className="absolute inset-0 h-full w-full">
        {composition === "single" && <Nail x={70} y={40} rotate={-8} tone={spec} />}
        {composition === "duo" && (
          <>
            <Nail x={52} y={48} rotate={-14} scale={0.9} tone={spec} />
            <Nail x={98} y={38} rotate={8} scale={0.9} tone={spec} />
          </>
        )}
        {composition === "fan" && (
          <>
            <Nail x={30} y={62} rotate={-26} scale={0.72} tone={spec} />
            <Nail x={62} y={42} rotate={-10} scale={0.8} tone={spec} />
            <Nail x={100} y={40} rotate={6} scale={0.8} tone={spec} />
            <Nail x={136} y={58} rotate={22} scale={0.72} tone={spec} />
          </>
        )}
        {composition === "row" && (
          <>
            {[0, 1, 2, 3, 4].map((i) => (
              <Nail key={i} x={14 + i * 36} y={70 - Math.abs(2 - i) * 6} rotate={(i - 2) * 4} scale={0.55} tone={spec} />
            ))}
          </>
        )}
        <circle cx="160" cy="40" r="2" fill={spec.accent} opacity="0.5" />
        <circle cx="40" cy="170" r="1.5" fill={spec.accent} opacity="0.4" />
      </svg>
    </div>
  );
}

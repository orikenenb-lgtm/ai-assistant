import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export function Logo({ className, compact, onBrand }: { className?: string; compact?: boolean; onBrand?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <span className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-ai text-white shadow-sm">
        <Sparkles className="size-4" />
      </span>
      {!compact && (
        <span dir="ltr" className="text-[15px]">
          SMART CRM <span className={onBrand ? "text-white/80" : "text-ai"}>AI</span>
        </span>
      )}
    </span>
  );
}

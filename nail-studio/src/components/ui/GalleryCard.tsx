import Image from "next/image";
import type { GalleryItem } from "@/types";
import { cn } from "@/lib/utils";
import { Aura } from "@/components/ui/Aura";

export function GalleryVisual({ item, sizes, priority }: { item: GalleryItem; sizes: string; priority?: boolean }) {
  if (item.image) {
    return <Image src={item.image.src} alt={item.alt} fill sizes={sizes} priority={priority} className="object-cover" />;
  }
  return <Aura tone={item.tone} />;
}

interface GalleryCardProps {
  item: GalleryItem;
  onOpen: () => void;
  className?: string;
}

/** A gallery tile. It is a real <button> so it works with keyboard and screen readers. */
export function GalleryCard({ item, onOpen, className }: GalleryCardProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-label={`הגדלה: ${item.alt}`}
      className={cn("group relative block h-full w-full overflow-hidden rounded-xl bg-blush text-start", className)}
    >
      <div className="absolute inset-0 transition-transform duration-[1.2s] ease-[var(--ease-premium)] group-hover:scale-[1.04] group-focus-visible:scale-[1.04]">
        <GalleryVisual item={item} sizes="(min-width: 1024px) 25vw, 50vw" />
      </div>
      <div className="absolute inset-0 bg-gradient-to-t from-paper/70 via-transparent to-transparent" />
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-4 sm:p-5">
        <span dir="auto" className="text-sm text-ink">{item.category}</span>
        <span dir="ltr" className="hidden text-[11px] tracking-[0.2em] text-ink/70 uppercase sm:inline">
          {item.swatchName}
        </span>
      </div>
    </button>
  );
}

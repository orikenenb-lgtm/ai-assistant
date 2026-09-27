import Image from "next/image";
import { Plus } from "lucide-react";
import type { GalleryItem } from "@/types";
import { cn } from "@/lib/utils";
import { Lacquer, lacquerTones } from "@/components/ui/Lacquer";

export function GalleryVisual({ item, sizes, priority }: { item: GalleryItem; sizes: string; priority?: boolean }) {
  if (item.image) {
    return <Image src={item.image.src} alt={item.alt} fill sizes={sizes} priority={priority} className="object-cover" />;
  }
  const dark = lacquerTones[item.tone].ink === "dark";
  return (
    <div className="relative h-full w-full">
      <Lacquer tone={item.tone} />
      {/* Swatch label, like the sticker on a polish bottle */}
      <span
        dir="ltr"
        className={cn(
          "absolute top-4 left-4 font-display text-2xl leading-none font-bold tracking-wide sm:text-3xl",
          dark ? "text-night/80" : "text-cream/85",
        )}
      >
        {item.swatchName}
      </span>
    </div>
  );
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
      className={cn("group relative block h-full w-full overflow-hidden rounded-3xl bg-coal text-start", className)}
    >
      <div className="absolute inset-0 transition-transform duration-700 ease-[var(--ease-premium)] group-hover:scale-[1.05] group-focus-visible:scale-[1.05]">
        <GalleryVisual item={item} sizes="(min-width: 1024px) 25vw, 50vw" />
      </div>
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-3 sm:p-4">
        <span dir="auto" className="rounded-full bg-night/85 px-3 py-1.5 text-xs font-bold text-cream backdrop-blur">
          {item.category}
        </span>
        <span className="hidden h-10 w-10 place-items-center rounded-full bg-night/85 text-cream backdrop-blur transition-[transform,background-color] duration-500 group-hover:rotate-90 group-hover:bg-cherry group-hover:text-night sm:grid">
          <Plus aria-hidden className="h-5 w-5" strokeWidth={2} />
        </span>
      </div>
    </button>
  );
}

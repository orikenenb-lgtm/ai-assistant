import Image from "next/image";
import { Expand } from "lucide-react";
import type { GalleryItem } from "@/types";
import { cn } from "@/lib/utils";
import { NailArt, type NailArtComposition } from "@/components/ui/NailArt";

const compositionByShape: Record<GalleryItem["shape"], NailArtComposition> = {
  tall: "single",
  square: "duo",
  wide: "row",
};

export function GalleryVisual({ item, sizes, priority }: { item: GalleryItem; sizes: string; priority?: boolean }) {
  if (item.image) {
    return (
      <Image
        src={item.image.src}
        alt={item.alt}
        fill
        sizes={sizes}
        priority={priority}
        className="object-cover"
      />
    );
  }
  return <NailArt tone={item.tone} composition={compositionByShape[item.shape]} />;
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
      className={cn(
        "group relative block h-full w-full overflow-hidden rounded-2xl bg-sand text-start shadow-soft",
        className,
      )}
    >
      <div className="absolute inset-0 transition-transform duration-700 ease-[var(--ease-premium)] group-hover:scale-[1.04] group-focus-visible:scale-[1.04]">
        <GalleryVisual item={item} sizes="(min-width: 1024px) 25vw, 50vw" />
      </div>
      <div className="absolute inset-0 bg-gradient-to-t from-ink/45 via-ink/0 to-ink/0 opacity-40 transition-opacity duration-500 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-visible:opacity-100" />
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-3 sm:p-4 sm:opacity-0 sm:translate-y-2 sm:transition-[opacity,transform] sm:duration-500 sm:group-hover:translate-y-0 sm:group-hover:opacity-100 sm:group-focus-visible:translate-y-0 sm:group-focus-visible:opacity-100">
        <span dir="auto" className="rounded-full bg-ivory/90 px-3 py-1 text-xs font-medium text-ink backdrop-blur">
          {item.category}
        </span>
        <span className="hidden h-9 w-9 place-items-center rounded-full bg-ivory/90 text-ink backdrop-blur sm:grid">
          <Expand aria-hidden className="h-4 w-4" strokeWidth={1.6} />
        </span>
      </div>
    </button>
  );
}

"use client";

import { useCallback, useState } from "react";
import dynamic from "next/dynamic";
import type { GalleryItem } from "@/types";
import { cn } from "@/lib/utils";
import { GalleryCard } from "@/components/ui/GalleryCard";
import { Reveal } from "@/components/ui/Reveal";

// The lightbox is only needed after a click, so it is split into its own chunk.
const Lightbox = dynamic(() => import("@/components/sections/Lightbox").then((mod) => mod.Lightbox));

const shapeClasses: Record<GalleryItem["shape"], string> = {
  square: "",
  tall: "row-span-2",
  wide: "col-span-2",
};

export function GalleryGrid({ items }: { items: GalleryItem[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const close = useCallback(() => setOpenIndex(null), []);

  return (
    <>
      <ul className="grid auto-rows-[150px] grid-flow-dense grid-cols-2 gap-3 min-[400px]:auto-rows-[170px] sm:auto-rows-[220px] sm:gap-4 lg:auto-rows-[240px] lg:grid-cols-4">
        {items.map((item, index) => (
          <Reveal as="li" key={item.id} delay={(index % 4) * 0.06} className={cn("min-w-0", shapeClasses[item.shape])}>
            <GalleryCard item={item} onOpen={() => setOpenIndex(index)} />
          </Reveal>
        ))}
      </ul>

      {openIndex !== null && (
        <Lightbox items={items} index={openIndex} onIndexChange={setOpenIndex} onClose={close} />
      )}
    </>
  );
}

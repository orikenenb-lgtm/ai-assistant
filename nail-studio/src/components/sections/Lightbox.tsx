"use client";

import { useCallback, useEffect, useRef, type TouchEvent } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { GalleryItem } from "@/types";
import { siteConfig } from "@/config/site";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { useScrollLock } from "@/hooks/useScrollLock";
import { GalleryVisual } from "@/components/ui/GalleryCard";

interface LightboxProps {
  items: GalleryItem[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}

const isRtl = siteConfig.dir === "rtl";
const SWIPE_THRESHOLD = 50;

/** Accessible modal viewer: focus trap, Escape, arrow keys (direction-aware) and swipe. */
export function Lightbox({ items, index, onIndexChange, onClose }: LightboxProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const touchStartX = useRef<number | null>(null);

  const count = items.length;
  const item = items[index];
  const next = useCallback(() => onIndexChange((index + 1) % count), [index, count, onIndexChange]);
  const prev = useCallback(() => onIndexChange((index - 1 + count) % count), [index, count, onIndexChange]);

  useScrollLock(true);
  useFocusTrap(dialogRef, true, { onEscape: onClose, initialFocus: closeRef });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // In RTL the "next" item sits to the left.
      if (event.key === "ArrowLeft") (isRtl ? next : prev)();
      if (event.key === "ArrowRight") (isRtl ? prev : next)();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [next, prev]);

  const onTouchStart = (event: TouchEvent) => {
    touchStartX.current = event.touches[0]?.clientX ?? null;
  };
  const onTouchEnd = (event: TouchEvent) => {
    const start = touchStartX.current;
    const end = event.changedTouches[0]?.clientX;
    touchStartX.current = null;
    if (start === null || end === undefined) return;
    const delta = end - start;
    if (Math.abs(delta) < SWIPE_THRESHOLD) return;
    const swipedLeft = delta < 0;
    (swipedLeft === isRtl ? prev : next)();
  };

  if (!item) return null;
  const titleId = "lightbox-title";

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex animate-fade flex-col bg-night/95 text-cream outline-none backdrop-blur-sm"
    >
      <div className="flex items-center justify-between gap-4 px-4 py-3 sm:px-6 sm:py-4">
        <p className="text-sm text-mist" aria-live="polite">
          <span className="sr-only">פריט </span>
          <span dir="ltr">{index + 1} / {count}</span>
        </p>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="סגירת הגלריה"
          className="grid h-11 w-11 place-items-center rounded-full border border-cream/20 transition-colors hover:border-cream/60"
        >
          <X aria-hidden className="h-5 w-5" strokeWidth={1.6} />
        </button>
      </div>

      <div
        className="relative flex min-h-0 flex-1 items-center justify-center px-4 sm:px-20"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <figure key={item.id} className="flex h-full max-h-[78svh] w-full max-w-lg animate-fade flex-col items-center justify-center gap-4">
          <div className="relative aspect-[4/5] max-h-full w-full overflow-hidden rounded-2xl shadow-lift">
            <GalleryVisual item={item} sizes="(min-width: 640px) 512px, 100vw" priority />
          </div>
          <figcaption className="flex flex-col items-center gap-1 text-center">
            <span id={titleId} dir="auto" className="font-display text-3xl font-extralight">{item.category}</span>
            <span className="text-sm text-mist">{item.description}</span>
            <span className="sr-only">{item.alt}</span>
          </figcaption>
        </figure>

        {count > 1 && (
          <>
            <NavButton side="start" label="לפריט הקודם" onClick={prev} />
            <NavButton side="end" label="לפריט הבא" onClick={next} />
          </>
        )}
      </div>
    </div>
  );
}

function NavButton({ side, label, onClick }: { side: "start" | "end"; label: string; onClick: () => void }) {
  // "start" = previous. In RTL start is on the right, so the chevron points right.
  const pointsRight = (side === "start") === isRtl;
  const Icon = pointsRight ? ChevronRight : ChevronLeft;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={
        "absolute top-1/2 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full border border-cream/20 bg-night/60 backdrop-blur transition-colors hover:border-cream/60 " +
        (side === "start" ? "start-2 sm:start-6" : "end-2 sm:end-6")
      }
    >
      <Icon aria-hidden className="h-5 w-5" strokeWidth={1.6} />
    </button>
  );
}

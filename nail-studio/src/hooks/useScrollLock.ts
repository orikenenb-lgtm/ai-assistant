"use client";

import { useEffect } from "react";

let lockCount = 0;

/** Prevents page scroll behind overlays, compensating for the scrollbar to avoid layout shift. */
export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const html = document.documentElement;
    lockCount += 1;
    if (lockCount === 1) {
      const scrollbar = window.innerWidth - html.clientWidth;
      html.style.overflow = "hidden";
      if (scrollbar > 0) html.style.paddingInlineEnd = `${scrollbar}px`;
    }
    return () => {
      lockCount -= 1;
      if (lockCount === 0) {
        html.style.overflow = "";
        html.style.paddingInlineEnd = "";
      }
    };
  }, [active]);
}

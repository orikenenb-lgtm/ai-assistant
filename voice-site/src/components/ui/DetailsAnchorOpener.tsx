"use client";

import { useEffect } from "react";

/** Opens a closed <details> when a link points at something inside it. */
export function DetailsAnchorOpener() {
  useEffect(() => {
    const open = () => {
      const id = decodeURIComponent(location.hash.slice(1));
      if (!id) return;
      const target = document.getElementById(id);
      const details = target?.closest("details");
      if (details && !details.open) {
        details.open = true;
        target?.scrollIntoView({ block: "center" });
      }
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);
  return null;
}

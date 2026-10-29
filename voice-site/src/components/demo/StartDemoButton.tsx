"use client";

import type { ReactNode } from "react";

/** Scrolls to the live demo and starts a voice call there. */
export function StartDemoButton({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        const target = document.getElementById("demo");
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        target?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
        window.dispatchEvent(new Event("demo:start"));
      }}
    >
      {children}
    </button>
  );
}

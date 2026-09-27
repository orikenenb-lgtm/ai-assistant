"use client";

import * as m from "motion/react-m";
import type { ReactNode } from "react";

interface RevealProps {
  children: ReactNode;
  className?: string;
  /** Seconds. Use small values (≤ 0.3) for staggering siblings. */
  delay?: number;
  as?: "div" | "li";
}

/** Fades content in as it scrolls into view. Respects prefers-reduced-motion via MotionConfig. */
export function Reveal({ children, className, delay = 0, as = "div" }: RevealProps) {
  const Component = as === "li" ? m.li : m.div;
  return (
    <Component
      className={className}
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -10% 0px" }}
      transition={{ duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </Component>
  );
}

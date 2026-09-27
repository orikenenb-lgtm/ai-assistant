"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * Renders the current year. The server-rendered (build-time) year is used
 * during hydration and replaced with the visitor's current year right after,
 * so a statically built page never shows a stale copyright.
 */
export function CurrentYear({ serverYear }: { serverYear: number }) {
  const year = useSyncExternalStore(
    subscribe,
    () => new Date().getFullYear(),
    () => serverYear,
  );
  return <>{year}</>;
}

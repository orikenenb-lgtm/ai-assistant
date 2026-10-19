"use client";

import { useEffect, useRef } from "react";
import { createBrowserClient } from "@supabase/ssr";

/**
 * Keeps inbox views fresh: Supabase Realtime (RLS-filtered postgres_changes)
 * when configured, plus polling — the only mechanism when Realtime is not
 * available (local development) and a safety net otherwise.
 */
export function useInboxLive(opts: { realtimeUrl: string | null; realtimeKey: string | null; tenantId: string; pollMs: number; onChange: () => void }) {
  const callback = useRef(opts.onChange);
  useEffect(() => {
    callback.current = opts.onChange;
  });

  const { realtimeUrl, realtimeKey, tenantId, pollMs } = opts;
  useEffect(() => {
    const realtime = Boolean(realtimeUrl && realtimeKey);
    const fire = () => {
      if (document.visibilityState === "visible") callback.current();
    };
    const timer = setInterval(fire, realtime ? Math.max(pollMs, 30_000) : pollMs);
    let unsubscribe = () => {};
    if (realtime) {
      const client = createBrowserClient(realtimeUrl!, realtimeKey!);
      const channel = client
        .channel(`inbox:${tenantId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `tenant_id=eq.${tenantId}` }, () => callback.current())
        .on("postgres_changes", { event: "*", schema: "public", table: "conversations", filter: `tenant_id=eq.${tenantId}` }, () => callback.current())
        .subscribe();
      unsubscribe = () => void client.removeChannel(channel);
    }
    const onVisible = () => document.visibilityState === "visible" && callback.current();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [realtimeUrl, realtimeKey, tenantId, pollMs]);
}

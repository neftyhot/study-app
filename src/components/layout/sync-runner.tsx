"use client";

/**
 * Keeps decks in step with the student's other devices while sync is on:
 * a round when the app opens, every minute, and when the window comes back
 * to the front. See src/lib/sync/desktop.ts.
 */
import { useEffect } from "react";

import { syncNowAction } from "@/lib/sync/actions";

const EVERY_MS = 60_000;
const AT_MOST_EVERY_MS = 15_000;

export function SyncRunner({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (!enabled) return;
    let last = 0;
    let busy = false;

    function sync() {
      const now = Date.now();
      if (busy || now - last < AT_MOST_EVERY_MS) return;
      busy = true;
      last = now;
      void syncNowAction()
        .catch(() => {})
        .finally(() => {
          busy = false;
        });
    }

    sync();
    const timer = window.setInterval(sync, EVERY_MS);
    const onFocus = () => sync();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [enabled]);

  return null;
}

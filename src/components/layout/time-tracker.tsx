"use client";

/**
 * Counts time the app is open, split into focused (the window is in front)
 * and in the background, for Settings → Your stats.
 *
 * Ticks are measured by the clock, not assumed, and capped: a laptop asleep
 * with the app open freezes timers, and the gap when it wakes is not study.
 */
import { useEffect } from "react";

import { recordTimeAction } from "@/lib/app-actions";

const TICK_MS = 5_000;
const MAX_TICK_MS = 15_000;
const REPORT_MS = 60_000;

export function TimeTracker() {
  useEffect(() => {
    let focused = 0;
    let background = 0;
    let last = Date.now();

    function tick() {
      const now = Date.now();
      const elapsed = Math.min(now - last, MAX_TICK_MS) / 1000;
      last = now;
      if (document.visibilityState === "visible" && document.hasFocus()) focused += elapsed;
      else background += elapsed;
    }

    function report() {
      tick();
      if (focused + background < 1) return;
      const [f, b] = [focused, background];
      focused = 0;
      background = 0;
      void recordTimeAction(f, b).catch(() => {
        // Put it back for the next report.
        focused += f;
        background += b;
      });
    }

    const ticker = setInterval(tick, TICK_MS);
    const reporter = setInterval(report, REPORT_MS);
    const onFocusChange = () => tick();
    window.addEventListener("focus", onFocusChange);
    window.addEventListener("blur", onFocusChange);
    window.addEventListener("pagehide", report);

    return () => {
      clearInterval(ticker);
      clearInterval(reporter);
      window.removeEventListener("focus", onFocusChange);
      window.removeEventListener("blur", onFocusChange);
      window.removeEventListener("pagehide", report);
      report();
    };
  }, []);

  return null;
}

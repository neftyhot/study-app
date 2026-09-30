"use client";

import { useEffect } from "react";

import { prewarmGrading } from "@/lib/settings-actions";

/**
 * Loads the answer-checking model as a study screen opens, so the first Check
 * Answer is as fast as the rest. Once per page load is enough; the model stays
 * in memory afterwards.
 */
let started = false;

export function usePrewarmGrading() {
  useEffect(() => {
    if (started) return;
    started = true;
    void prewarmGrading().catch(() => {
      started = false;
    });
  }, []);
}

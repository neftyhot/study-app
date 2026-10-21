"use server";

import { getProvider } from "@/lib/llm";

import { estimateScan, type ScanEstimate } from "./scan";

export type ScanPlan =
  | { ok: true; provider: string; model: string; estimate: ScanEstimate }
  | { ok: false; error: string };

/** Who would read the photos and roughly what it costs, before anything is sent. */
export async function scanPlanAction(imageCount: number): Promise<ScanPlan> {
  try {
    const provider = getProvider(undefined, "interactive");
    if (provider.vision === false) {
      return {
        ok: false,
        error: `${provider.model} reads text, not pictures. Choose Gemini, Claude or OpenAI in Settings to scan notes.`,
      };
    }
    return {
      ok: true,
      provider: provider.name,
      model: provider.model,
      estimate: estimateScan(provider.model, imageCount),
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

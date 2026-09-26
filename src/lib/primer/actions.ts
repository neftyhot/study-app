"use server";

import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { getProvider } from "@/lib/llm";

import { generatePrimer, isPrimerDepth } from "./index";

/**
 * Writes (or rewrites) the Primer at one depth.
 *
 * Returns the failure as a message rather than throwing it: no key, no
 * network, or an empty deck are things to tell the student, not crashes.
 */
export async function writePrimer(
  examId: string,
  depth: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isPrimerDepth(depth)) return { ok: false, error: "Unknown depth." };

  try {
    await generatePrimer(db, getProvider(undefined, "primer"), examId, depth);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  revalidatePath(`/exams/${examId}/primer`);
  return { ok: true };
}

"use server";

import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { getProvider } from "@/lib/llm";

import { enrichCard } from "./enrich";

/**
 * Fills in the explanation and misconceptions a bulk run skipped.
 *
 * Per card, on request. Generating them for eight hundred cards costs most of
 * a run's wall-clock and almost none of them are ever read.
 */
export async function enrichCardAction(examId: string, cardId: string) {
  try {
    const card = await enrichCard(db, getProvider(), cardId);
    if (!card) return { ok: false as const, error: "That card no longer exists." };

    revalidatePath(`/exams/${examId}/cards`);
    return {
      ok: true as const,
      fullExplanation: card.fullExplanation,
      commonMisconceptions: card.commonMisconceptions,
    };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

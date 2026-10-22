/**
 * Cards from photos of the student's own notes: the desktop's save step.
 *
 * The prompt, the estimate and the reading itself are in the shared core, so
 * the iOS app's "Snap your notes" makes the same cards; see packages/core.
 */
import type { Db } from "@/db/client";
import { cardRubrics, flashcards } from "@/db/schema";
import type { ExtractedCard } from "@/lib/tutor/schemas";

export * from "@megan/core/scan/scan";

/** Adds scanned cards to a deck, marked as from a scan. Returns how many. */
export function saveScanCards(db: Db, examId: string, cards: ExtractedCard[]): number {
  if (cards.length === 0) return 0;
  db.transaction((tx) => {
    for (const card of cards) {
      const row = tx
        .insert(flashcards)
        .values({
          examId,
          topic: card.topic,
          question: card.question,
          directAnswer: card.directAnswer,
          fullExplanation: card.fullExplanation ?? null,
          cardType: "atomic",
          sourceExcerpt: null,
          hasAiSupplement: !card.fromMaterial,
          fromScan: true,
        })
        .returning({ id: flashcards.id })
        .get();
      tx.insert(cardRubrics)
        .values({
          flashcardId: row.id,
          essentialPoints: card.essentialPoints,
          optionalPoints: [],
          commonMisconceptions: card.commonMisconceptions ?? [],
        })
        .run();
    }
  });
  return cards.length;
}

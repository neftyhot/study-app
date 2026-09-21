/**
 * Storing cards that came out of a conversation.
 *
 * These cards cannot satisfy the provenance rule generation lives under: a
 * conversation about a diagram has no sentence to quote verbatim. So they are
 * stored as what they are — the student's own cards, linked to the page that
 * was on screen, flagged when the answer came from the model rather than the
 * material — instead of being dressed up as extracted ones.
 */
import type { Db } from "@/db/client";
import { cardRubrics, flashcards } from "@/db/schema";

import type { ExtractedCard } from "./schemas";

export type SaveRequest = {
  examId: string;
  sourceSlideId?: string | null;
  cards: ExtractedCard[];
};

export function saveTutorCards(db: Db, request: SaveRequest): string[] {
  if (request.cards.length === 0) return [];

  return db.transaction((tx) => {
    const ids: string[] = [];

    for (const card of request.cards) {
      const row = tx
        .insert(flashcards)
        .values({
          examId: request.examId,
          topic: card.topic,
          question: card.question,
          directAnswer: card.directAnswer,
          fullExplanation: card.fullExplanation ?? null,
          cardType: "atomic",
          sourceSlideId: request.sourceSlideId ?? null,
          // No excerpt: nothing here was copied out of the slide, and
          // inventing one would make an unsourced card look sourced.
          sourceExcerpt: null,
          hasAiSupplement: !card.fromMaterial,
          // The student read it and pressed save, so regeneration leaves it.
          isUserEdited: true,
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

      ids.push(row.id);
    }

    return ids;
  });
}

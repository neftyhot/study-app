/**
 * "Make a deck": cards the student typed or pasted, saved the way the
 * desktop's card-set editor saves them (src/lib/cards/manual.ts
 * `createManualCard`). AI-made cards go through `saveExtractedCards`.
 */
import type { ImportedCard } from "@megan/core/cards/import";
import type { SqlDriver } from "@megan/core/platform/types";

import { newId } from "./db";

/** Adds the typed cards to a deck and returns how many were saved. Half-filled cards are skipped. */
export async function saveTypedCards(db: SqlDriver, examId: string, cards: ImportedCard[]): Promise<number> {
  const complete = cards
    .map((card) => ({ front: card.front.trim(), back: card.back.trim() }))
    .filter((card) => card.front && card.back);
  if (complete.length === 0) return 0;
  await db.transaction(async () => {
    for (const card of complete) {
      const cardId = newId();
      await db.run(
        `INSERT INTO flashcards (id, exam_id, topic, question, direct_answer, full_explanation, card_type,
           source_excerpt, has_ai_supplement, is_user_edited)
         VALUES (?, ?, NULL, ?, ?, NULL, 'atomic', NULL, 0, 1)`,
        [cardId, examId, card.front, card.back],
      );
      // With no rubric written, the answer itself is the standard.
      await db.run(
        "INSERT INTO card_rubrics (id, flashcard_id, essential_points, optional_points, common_misconceptions) VALUES (?, ?, ?, '[]', '[]')",
        [newId(), cardId, JSON.stringify([card.back])],
      );
    }
  });
  return complete.length;
}

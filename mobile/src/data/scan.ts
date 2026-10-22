/**
 * "Snap your notes": the cards read from a photo, saved the way the desktop
 * saves them (src/lib/scan/scan.ts `saveScanCards`).
 */
import type { SqlDriver } from "@megan/core/platform/types";
import type { ExtractedCard } from "@megan/core/tutor/schemas";

import { newId } from "./db";

export const SCAN_COURSE = "My notes";

/** Adds the cards to a deck and returns how many were saved. */
export async function saveScanCards(db: SqlDriver, examId: string, cards: ExtractedCard[]): Promise<number> {
  if (cards.length === 0) return 0;
  await db.transaction(async () => {
    for (const card of cards) {
      const cardId = newId();
      await db.run(
        `INSERT INTO flashcards (id, exam_id, topic, question, direct_answer, full_explanation, card_type,
           source_excerpt, has_ai_supplement, from_scan)
         VALUES (?, ?, ?, ?, ?, ?, 'atomic', NULL, ?, 1)`,
        [cardId, examId, card.topic ?? null, card.question, card.directAnswer, card.fullExplanation ?? null, card.fromMaterial ? 0 : 1],
      );
      await db.run(
        "INSERT INTO card_rubrics (id, flashcard_id, essential_points, optional_points, common_misconceptions) VALUES (?, ?, ?, '[]', ?)",
        [newId(), cardId, JSON.stringify(card.essentialPoints), JSON.stringify(card.commonMisconceptions ?? [])],
      );
    }
  });
  return cards.length;
}

/** A new, empty deck for a scan, in the "My notes" course. */
export async function createScanDeck(db: SqlDriver, title: string): Promise<string> {
  return db.transaction(async () => {
    const [existing] = await db.all<{ id: string }>("SELECT id FROM courses WHERE title = ? AND deleted_at IS NULL LIMIT 1", [
      SCAN_COURSE,
    ]);
    const courseId = existing?.id ?? newId();
    if (!existing) await db.run("INSERT INTO courses (id, title) VALUES (?, ?)", [courseId, SCAN_COURSE]);
    const examId = newId();
    await db.run("INSERT INTO exams (id, course_id, title) VALUES (?, ?, ?)", [examId, courseId, title.trim() || "Scanned notes"]);
    return examId;
  });
}

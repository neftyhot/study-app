/**
 * Repeated cards: finding them, and keeping the one worth keeping.
 *
 * A deck repeats itself in two ways. The same question asked twice, sometimes
 * word for word, sometimes reworded. And the same fact asked twice where the
 * second card adds a detail: "When did the US enter WW1?" next to "When and
 * why did the US enter WW1?". Both waste a review; the second also means the
 * student answers the first card from memory of the second.
 *
 * The rule is coverage. A card is a repeat when another card asks about the
 * same thing and already says everything it says. The fuller card stays and
 * the covered one goes. Two cards that each say something the other does not
 * are both kept: they are different cards, even if they are about the same
 * event.
 */
import { eq, inArray } from "drizzle-orm";

import { findRepeats } from "@megan/core/cards/repeats";
import type { Db } from "@/db/client";
import { coverageMappings, diagramOcclusions, flashcards, studyProgress } from "@/db/schema";

// Finding repeats is pure and shared with iOS; removing them touches the database.
export * from "@megan/core/cards/repeats";

export type RepeatCleanup = {
  removed: number;
  groups: { kept: string; removed: { question: string; directAnswer: string }[] }[];
  removedIds: string[];
};

export type RepeatOptions = {
  /**
   * Only these cards may be removed; the rest of the deck still counts as
   * cover. Generation passes the cards it just wrote, so a run never deletes
   * a card the student was already studying.
   */
  onlyRemove?: Set<string>;
};

/**
 * Removes a deck's repeated cards, keeping the fullest of each group.
 *
 * Nothing the student did is lost with them: a star on any card of the group
 * moves to the one kept, and when only a removed card has review history,
 * that history moves too, so the schedule carries on where it was.
 */
export function removeRepeats(
  db: Db,
  examId: string,
  options: RepeatOptions = {},
): RepeatCleanup {
  const rows = db
    .select({
      id: flashcards.id,
      question: flashcards.question,
      directAnswer: flashcards.directAnswer,
      isUserEdited: flashcards.isUserEdited,
      starred: flashcards.starred,
      excluded: flashcards.excluded,
      studied: studyProgress.id,
    })
    .from(flashcards)
    .leftJoin(studyProgress, eq(studyProgress.flashcardId, flashcards.id))
    .where(eq(flashcards.examId, examId))
    .all();

  // Diagram cards ask about a picture, so their words say little about what
  // they test; a card the student set aside is theirs to bring back.
  const diagrams = new Set(
    db
      .select({ id: diagramOcclusions.flashcardId })
      .from(diagramOcclusions)
      .innerJoin(flashcards, eq(flashcards.id, diagramOcclusions.flashcardId))
      .where(eq(flashcards.examId, examId))
      .all()
      .map((row) => row.id),
  );
  const candidates = rows
    .filter((row) => !diagrams.has(row.id) && !row.excluded)
    .map((row) => ({
      ...row,
      studied: row.studied !== null,
      locked: options.onlyRemove ? !options.onlyRemove.has(row.id) : false,
    }));

  const groups = findRepeats(candidates);
  if (groups.length === 0) return { removed: 0, groups: [], removedIds: [] };

  db.transaction((tx) => {
    for (const { keep, drop } of groups) {
      if (!keep.starred && drop.some((card) => card.starred)) {
        tx.update(flashcards)
          .set({ starred: true })
          .where(eq(flashcards.id, keep.id))
          .run();
      }

      const history = drop.find((card) => card.studied);
      if (!keep.studied && history) {
        tx.update(studyProgress)
          .set({ flashcardId: keep.id })
          .where(eq(studyProgress.flashcardId, history.id))
          .run();
      }

      // The objectives a dropped card answered are answered by the card that
      // covers it; without this the coverage matrix shows a gap that is not
      // there until coverage is checked again.
      const covered = new Set(
        tx
          .select({ objectiveId: coverageMappings.objectiveId })
          .from(coverageMappings)
          .where(eq(coverageMappings.flashcardId, keep.id))
          .all()
          .map((row) => row.objectiveId),
      );
      for (const mapping of tx
        .select()
        .from(coverageMappings)
        .where(inArray(coverageMappings.flashcardId, drop.map((card) => card.id)))
        .all()) {
        if (covered.has(mapping.objectiveId)) continue;
        covered.add(mapping.objectiveId);
        tx.update(coverageMappings)
          .set({ flashcardId: keep.id })
          .where(eq(coverageMappings.id, mapping.id))
          .run();
      }

      tx.delete(flashcards)
        .where(inArray(flashcards.id, drop.map((card) => card.id)))
        .run();
    }
  });

  const removedIds = groups.flatMap((group) => group.drop.map((card) => card.id));
  return {
    removed: removedIds.length,
    removedIds,
    groups: groups.map((group) => ({
      kept: group.keep.question,
      removed: group.drop.map(({ question, directAnswer }) => ({ question, directAnswer })),
    })),
  };
}

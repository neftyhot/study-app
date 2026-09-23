/**
 * Cards the student writes, and bulk operations over cards they already have.
 *
 * A hand-written card is not a lesser card: it goes into the same table, is
 * scheduled by the same scheduler and is graded by the same rubric. What marks
 * it is `isUserEdited`, which is what stops a regeneration from deleting work
 * the model did not do.
 */
import { inArray } from "drizzle-orm";

import type { Db } from "@/db/client";
import { cardRubrics, flashcards, type cardTypes } from "@/db/schema";

type CardType = (typeof cardTypes)[number];

import { clozeAnswers, clozeQuestion, hasCloze } from "./cloze";

export type ManualCardInput = {
  examId: string;
  topic?: string | null;
  question: string;
  directAnswer?: string;
  fullExplanation?: string | null;
  cardType?: CardType;
  professorEmphasis?: boolean;
  starred?: boolean;
  frontImagePath?: string | null;
  backImagePath?: string | null;
  essentialPoints?: string[];
  optionalPoints?: string[];
  commonMisconceptions?: string[];
  /** Provenance, when the card was written while looking at a page. */
  sourceSlideId?: string | null;
};

export class CardInputError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join(" "));
    this.name = "CardInputError";
  }
}

/**
 * What is wrong with a card, in words rather than as a thrown field name.
 *
 * A cloze card is the one case where an empty answer is fine: the answer is
 * inside the question, between the braces.
 */
export function validateManualCard(input: ManualCardInput): string[] {
  const problems: string[] = [];
  const question = input.question?.trim() ?? "";
  const answer = input.directAnswer?.trim() ?? "";
  const cloze = input.cardType === "cloze";

  if (!question) problems.push("A card needs a question.");

  if (cloze && !hasCloze(question)) {
    problems.push(
      "A cloze card needs something in {{double braces}} — that is the part that gets hidden.",
    );
  }

  if (!cloze && !answer) {
    problems.push("A card needs an answer.");
  }

  return problems;
}

export function createManualCard(db: Db, input: ManualCardInput) {
  const problems = validateManualCard(input);
  if (problems.length > 0) throw new CardInputError(problems);

  const cloze = input.cardType === "cloze";
  const question = input.question.trim();

  // For a cloze card the answer is the deletions, so it does not have to be
  // typed twice; anything the student did write wins.
  const directAnswer =
    input.directAnswer?.trim() ||
    (cloze ? clozeAnswers(question).join(", ") : "");

  return db.transaction((tx) => {
    const card = tx
      .insert(flashcards)
      .values({
        examId: input.examId,
        topic: input.topic?.trim() || null,
        question,
        directAnswer,
        fullExplanation: input.fullExplanation?.trim() || null,
        cardType: input.cardType ?? "atomic",
        sourceSlideId: input.sourceSlideId ?? null,
        sourceExcerpt: null,
        hasAiSupplement: false,
        isUserEdited: true,
        professorEmphasis: input.professorEmphasis ?? false,
        starred: input.starred ?? false,
        frontImagePath: input.frontImagePath ?? null,
        backImagePath: input.backImagePath ?? null,
      })
      .returning()
      .get();

    const essential = (input.essentialPoints ?? []).map((p) => p.trim()).filter(Boolean);

    tx.insert(cardRubrics)
      .values({
        flashcardId: card.id,
        // With no rubric written, the answer itself is the standard — better
        // than an empty rubric, which would grade every typed answer correct.
        essentialPoints:
          essential.length > 0
            ? essential
            : cloze
              ? clozeAnswers(question)
              : directAnswer
                ? [directAnswer]
                : [],
        optionalPoints: (input.optionalPoints ?? []).map((p) => p.trim()).filter(Boolean),
        commonMisconceptions: (input.commonMisconceptions ?? [])
          .map((p) => p.trim())
          .filter(Boolean),
      })
      .run();

    return card;
  });
}

/** Problems with one card of a set, by its position in the set. */
export type SetProblem = { index: number; problems: string[] };

/**
 * Writes a whole set of cards, or none of them.
 *
 * Every card is checked before any is written, so a set with one bad row
 * comes back with that row named rather than half-saved. Blank rows — the
 * empty card left at the bottom after "add another" — are skipped.
 */
export function createManualCards(
  db: Db,
  examId: string,
  inputs: Omit<ManualCardInput, "examId">[],
): { created: number } | { problems: SetProblem[] } {
  const rows = inputs
    .map((input, index) => ({ input: { ...input, examId }, index }))
    .filter(
      ({ input }) => input.question?.trim() || input.directAnswer?.trim(),
    );

  const problems = rows
    .map(({ input, index }) => ({ index, problems: validateManualCard(input) }))
    .filter((row) => row.problems.length > 0);
  if (problems.length > 0) return { problems };

  db.transaction(() => {
    for (const { input } of rows) createManualCard(db, input);
  });

  return { created: rows.length };
}

/** What study shows on the front of a card, cloze or not. */
export function frontOf(card: {
  cardType: string;
  question: string;
}): string {
  return card.cardType === "cloze" ? clozeQuestion(card.question) : card.question;
}

/* ------------------------------------------------------------ Bulk actions */

export type BulkResult = { affected: number };

/**
 * Moves cards to another deck.
 *
 * Review history travels with the card: it is keyed to the card, and moving a
 * card the student has been studying for a week into another deck must not
 * quietly reset it to new.
 */
export function moveCards(
  db: Db,
  cardIds: string[],
  targetExamId: string,
): BulkResult {
  if (cardIds.length === 0) return { affected: 0 };

  db.update(flashcards)
    .set({ examId: targetExamId, updatedAt: new Date().toISOString() })
    .where(inArray(flashcards.id, cardIds))
    .run();

  return { affected: cardIds.length };
}

export function retagCards(db: Db, cardIds: string[], topic: string): BulkResult {
  const trimmed = topic.trim();
  if (cardIds.length === 0 || !trimmed) return { affected: 0 };

  db.update(flashcards)
    .set({ topic: trimmed, updatedAt: new Date().toISOString() })
    .where(inArray(flashcards.id, cardIds))
    .run();

  return { affected: cardIds.length };
}

export function deleteCards(db: Db, cardIds: string[]): BulkResult {
  if (cardIds.length === 0) return { affected: 0 };

  db.delete(flashcards).where(inArray(flashcards.id, cardIds)).run();
  return { affected: cardIds.length };
}

/**
 * Copies cards into another deck.
 *
 * The copies start unstudied. Progress belongs to a card, not to its text:
 * carrying a week of review history onto a card the student has never seen in
 * this deck would make the schedule a lie.
 */
export function duplicateCards(
  db: Db,
  cardIds: string[],
  targetExamId: string,
): BulkResult {
  if (cardIds.length === 0) return { affected: 0 };

  const cards = db
    .select()
    .from(flashcards)
    .where(inArray(flashcards.id, cardIds))
    .all();

  const rubrics = db
    .select()
    .from(cardRubrics)
    .where(inArray(cardRubrics.flashcardId, cardIds))
    .all();
  const rubricByCard = new Map(rubrics.map((row) => [row.flashcardId, row]));

  db.transaction((tx) => {
    for (const card of cards) {
      const copy = tx
        .insert(flashcards)
        .values({
          examId: targetExamId,
          topic: card.topic,
          question: card.question,
          directAnswer: card.directAnswer,
          fullExplanation: card.fullExplanation,
          cardType: card.cardType,
          // The provenance link is kept: the copy came from the same slide,
          // and a card that cannot say where it came from is worth less.
          sourceSlideId: card.sourceSlideId,
          sourceExcerpt: card.sourceExcerpt,
          hasAiSupplement: card.hasAiSupplement,
          isUserEdited: card.isUserEdited,
          professorEmphasis: card.professorEmphasis,
          starred: card.starred,
          frontImagePath: card.frontImagePath,
          backImagePath: card.backImagePath,
        })
        .returning()
        .get();

      const rubric = rubricByCard.get(card.id);
      tx.insert(cardRubrics)
        .values({
          flashcardId: copy.id,
          essentialPoints: rubric?.essentialPoints ?? [],
          optionalPoints: rubric?.optionalPoints ?? [],
          commonMisconceptions: rubric?.commonMisconceptions ?? [],
        })
        .run();
    }
  });

  return { affected: cards.length };
}

/** Star or unstar a selection, the one bulk edit with no side effects. */
export function setStarred(
  db: Db,
  cardIds: string[],
  starred: boolean,
): BulkResult {
  if (cardIds.length === 0) return { affected: 0 };

  db.update(flashcards)
    .set({ starred })
    .where(inArray(flashcards.id, cardIds))
    .run();

  return { affected: cardIds.length };
}

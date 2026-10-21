/**
 * Cards the student writes, and bulk operations over cards they already have.
 *
 * A hand-written card is not a lesser card: it goes into the same table, is
 * scheduled by the same scheduler and is graded by the same rubric. What marks
 * it is `isUserEdited`, which is what stops a regeneration from deleting work
 * the model did not do.
 */
import { and, eq, gt, gte, inArray, isNull, sql } from "drizzle-orm";

import type { Db } from "@/db/client";
import { cardRubrics, diagramOcclusions, flashcards, type cardTypes } from "@/db/schema";

type CardType = (typeof cardTypes)[number];

import { isSafeStoredPath } from "@/lib/ingest/safe-path";
import { chronologicalCardOrder } from "@/lib/order";

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

  // Set by the card editor from the upload's reply, so only a forged request
  // gets here — and the image route reads whatever is stored.
  for (const image of [input.frontImagePath, input.backImagePath]) {
    if (image && !isSafeStoredPath(image)) problems.push("That image is not one this app stored.");
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

/**
 * Where new cards go in a deck: after everything (the default), before
 * everything, or straight after one card that is already there.
 */
export type CardPlacement = "end" | "start" | { after: string };

/**
 * Moves freshly written cards to a place in the deck's order.
 *
 * A card's place is its order key (see lib/order.ts), so the new cards take
 * the key of the card they sit next to and the cards behind them in that
 * group shift along. Nothing is linked to a slide: a card typed in between
 * two cards from slide 14 was still not written from slide 14.
 */
export function placeCards(
  db: Db,
  examId: string,
  cardIds: string[],
  placement: CardPlacement,
): void {
  if (placement === "end" || cardIds.length === 0) return;

  const others = db
    .select({
      id: flashcards.id,
      topic: flashcards.topic,
      sourceDocumentIndex: flashcards.sourceDocumentIndex,
      sourcePageNumber: flashcards.sourcePageNumber,
      documentOrderIndex: flashcards.documentOrderIndex,
    })
    .from(flashcards)
    .where(eq(flashcards.examId, examId))
    .orderBy(...chronologicalCardOrder())
    .all()
    .filter((card) => !cardIds.includes(card.id));

  const anchor =
    placement === "start"
      ? others[0]
      : others.find((card) => card.id === placement.after);
  // An empty deck, or a card deleted while the editor was open: the end is
  // where the cards already are.
  if (!anchor) return;

  const before = placement === "start";
  const first = anchor.documentOrderIndex + (before ? 0 : 1);
  const group = and(
    eq(flashcards.examId, examId),
    anchor.sourceDocumentIndex === null
      ? isNull(flashcards.sourceDocumentIndex)
      : eq(flashcards.sourceDocumentIndex, anchor.sourceDocumentIndex),
    anchor.sourcePageNumber === null
      ? isNull(flashcards.sourcePageNumber)
      : eq(flashcards.sourcePageNumber, anchor.sourcePageNumber),
  );

  db.transaction((tx) => {
    tx.update(flashcards)
      .set({
        documentOrderIndex: sql`${flashcards.documentOrderIndex} + ${cardIds.length}`,
      })
      .where(
        and(
          group,
          before
            ? gte(flashcards.documentOrderIndex, anchor.documentOrderIndex)
            : gt(flashcards.documentOrderIndex, anchor.documentOrderIndex),
        ),
      )
      .run();

    cardIds.forEach((id, offset) => {
      tx.update(flashcards)
        .set({
          // A card with no topic of its own joins its neighbour's, so it does
          // not split that topic's run of cards in two.
          topic: sql`coalesce(${flashcards.topic}, ${anchor.topic})`,
          sourceDocumentIndex: anchor.sourceDocumentIndex,
          sourcePageNumber: anchor.sourcePageNumber,
          documentOrderIndex: first + offset,
        })
        .where(eq(flashcards.id, id))
        .run();
    });
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
  placement: CardPlacement = "end",
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
    const ids = rows.map(({ input }) => createManualCard(db, input).id);
    placeCards(db, examId, ids, placement);
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

/** The ids among `cardIds` that belong to `examId`. */
export function cardsInExam(db: Db, examId: string, cardIds: string[]): string[] {
  if (cardIds.length === 0) return [];
  return db
    .select({ id: flashcards.id })
    .from(flashcards)
    .where(and(eq(flashcards.examId, examId), inArray(flashcards.id, cardIds)))
    .all()
    .map((row) => row.id);
}

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

  const occlusionsByCard = new Map<string, (typeof diagramOcclusions.$inferSelect)[]>();
  for (const row of db
    .select()
    .from(diagramOcclusions)
    .where(inArray(diagramOcclusions.flashcardId, cardIds))
    .all()) {
    occlusionsByCard.set(row.flashcardId, [...(occlusionsByCard.get(row.flashcardId) ?? []), row]);
  }

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
          excluded: card.excluded,
          frontImagePath: card.frontImagePath,
          backImagePath: card.backImagePath,
          givens: card.givens,
          calculations: card.calculations,
        })
        .returning()
        .get();

      // A diagram drill is the card; without its masks the copy is a blank
      // picture with nothing to recall.
      for (const occlusion of occlusionsByCard.get(card.id) ?? []) {
        tx.insert(diagramOcclusions)
          .values({
            flashcardId: copy.id,
            sourceSlideId: occlusion.sourceSlideId,
            imagePath: occlusion.imagePath,
            maskCoordinates: occlusion.maskCoordinates,
          })
          .run();
      }

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

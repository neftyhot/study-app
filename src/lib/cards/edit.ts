/**
 * Card editing with history (PRD §15).
 *
 * Editing is continuous — the study UI saves as the student types — which
 * without history is a good way to lose a card to a stray keystroke. Every
 * save writes what the card *was* to `card_revisions` first, so undo restores
 * the exact previous text rather than approximating it.
 *
 * Revisions inside one editing burst are coalesced: typing a sentence should
 * be one undoable change, not forty.
 */
import { and, desc, eq, gt } from "drizzle-orm";

import type { Db } from "@/db/client";
import { cardRevisions, flashcards, type Flashcard } from "@/db/schema";

/** Saves within this window of the last revision extend it instead of adding one. */
export const COALESCE_WINDOW_MS = 90_000;

export type CardEdit = {
  question: string;
  directAnswer: string;
  fullExplanation?: string | null;
};

export type EditResult = {
  card: Flashcard;
  /** True when this save created a new undo point rather than extending one. */
  revisionCreated: boolean;
  undoAvailable: boolean;
};

function normalize(edit: CardEdit) {
  return {
    question: edit.question.trim(),
    directAnswer: edit.directAnswer.trim(),
    fullExplanation: edit.fullExplanation?.trim() || null,
  };
}

function unchanged(card: Flashcard, next: ReturnType<typeof normalize>) {
  return (
    card.question === next.question &&
    card.directAnswer === next.directAnswer &&
    (card.fullExplanation ?? null) === next.fullExplanation
  );
}

export function editCard(
  db: Db,
  cardId: string,
  edit: CardEdit,
  now: Date = new Date(),
): EditResult | undefined {
  const card = db
    .select()
    .from(flashcards)
    .where(eq(flashcards.id, cardId))
    .get();
  if (!card) return undefined;

  const next = normalize(edit);
  if (!next.question || !next.directAnswer) {
    throw new Error("A card needs both a question and an answer.");
  }

  // An autosave that changes nothing must not burn an undo point.
  if (unchanged(card, next)) {
    return {
      card,
      revisionCreated: false,
      undoAvailable: hasRevision(db, cardId),
    };
  }

  const cutoff = new Date(now.getTime() - COALESCE_WINDOW_MS).toISOString();
  const recent = db
    .select({ id: cardRevisions.id })
    .from(cardRevisions)
    .where(
      and(
        eq(cardRevisions.flashcardId, cardId),
        gt(cardRevisions.createdAt, cutoff),
      ),
    )
    .orderBy(desc(cardRevisions.createdAt))
    .get();

  let revisionCreated = false;

  db.transaction((tx) => {
    if (!recent) {
      tx.insert(cardRevisions)
        .values({
          flashcardId: cardId,
          question: card.question,
          directAnswer: card.directAnswer,
          fullExplanation: card.fullExplanation,
          wasUserEdited: card.isUserEdited,
          // Written explicitly: SQLite's `current_timestamp` default is
          // "YYYY-MM-DD HH:MM:SS", which does not compare against an ISO
          // cutoff string, and the coalescing window is a string comparison.
          createdAt: now.toISOString(),
        })
        .run();
      revisionCreated = true;
    }

    tx.update(flashcards)
      .set({ ...next, isUserEdited: true })
      .where(eq(flashcards.id, cardId))
      .run();
  });

  return {
    card: { ...card, ...next, isUserEdited: true },
    revisionCreated,
    undoAvailable: true,
  };
}

export function hasRevision(db: Db, cardId: string): boolean {
  return (
    db
      .select({ id: cardRevisions.id })
      .from(cardRevisions)
      .where(eq(cardRevisions.flashcardId, cardId))
      .get() !== undefined
  );
}

export type UndoResult = {
  card: Flashcard;
  undoAvailable: boolean;
};

/**
 * Restores the most recent revision and consumes it.
 *
 * `is_user_edited` is restored too: undoing the only edit a card ever had puts
 * it back to being exactly what was generated, which is what the deletion
 * rules elsewhere read to decide whether it is the student's work.
 */
export function undoCardEdit(db: Db, cardId: string): UndoResult | undefined {
  const revision = db
    .select()
    .from(cardRevisions)
    .where(eq(cardRevisions.flashcardId, cardId))
    .orderBy(desc(cardRevisions.createdAt))
    .get();
  if (!revision) return undefined;

  const card = db
    .select()
    .from(flashcards)
    .where(eq(flashcards.id, cardId))
    .get();
  if (!card) return undefined;

  db.transaction((tx) => {
    tx.update(flashcards)
      .set({
        question: revision.question,
        directAnswer: revision.directAnswer,
        fullExplanation: revision.fullExplanation,
        isUserEdited: revision.wasUserEdited,
      })
      .where(eq(flashcards.id, cardId))
      .run();

    tx.delete(cardRevisions).where(eq(cardRevisions.id, revision.id)).run();
  });

  return {
    card: {
      ...card,
      question: revision.question,
      directAnswer: revision.directAnswer,
      fullExplanation: revision.fullExplanation,
      isUserEdited: revision.wasUserEdited,
    },
    undoAvailable: hasRevision(db, cardId),
  };
}

"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { flashcards } from "@/db/schema";

import { editCard, undoCardEdit } from "@/lib/cards/edit";

import type { Grade } from "./grade";
import type { QueueFilter } from "./queue";
import {
  completeSession,
  gradeCard,
  setPosition,
  skipKnownCard,
  skipUnknownCard,
  startSession,
} from "./session";

/**
 * Grading and position updates deliberately do NOT revalidate: they fire on
 * every card, and re-rendering the page under the student mid-session would
 * cost them their place. The next page load reads the stored state.
 */
export async function beginStudySession(examId: string, filter: QueueFilter) {
  const session = startSession(db, examId, filter);
  return {
    id: session.id,
    cardOrder: session.cardOrder,
    position: session.position,
  };
}

export async function saveStudyPosition(sessionId: string, position: number) {
  setPosition(db, sessionId, position);
}

export async function finishStudySession(sessionId: string) {
  completeSession(db, sessionId);
}

export async function gradeStudyCard(
  cardId: string,
  grade: Grade,
  sessionId?: string | null,
) {
  gradeCard(db, cardId, grade, sessionId);
}

/** "I know it": credit the card and move on without flipping it. */
export async function skipKnown(cardId: string, sessionId?: string | null) {
  skipKnownCard(db, cardId, sessionId);
}

/** "No clue": mark it missed and re-queue it later in this session. */
export async function skipUnknown(cardId: string, sessionId?: string | null) {
  const order = skipUnknownCard(db, cardId, sessionId);
  return { cardOrder: order ?? null };
}

export async function toggleCardStar(cardId: string) {
  const card = db
    .select({ starred: flashcards.starred, examId: flashcards.examId })
    .from(flashcards)
    .where(eq(flashcards.id, cardId))
    .get();
  if (!card) return false;

  const starred = !card.starred;
  db.update(flashcards)
    .set({ starred })
    .where(eq(flashcards.id, cardId))
    .run();

  return starred;
}

/**
 * In-place editing (PRD §4, §15).
 *
 * Saves continuously as the student types, and writes the previous text to
 * history first so the edit can be undone. `is_user_edited` tells later
 * regeneration and the deletion rules that this card is the student's work.
 */
export async function saveCardEdit(
  cardId: string,
  fields: { question: string; directAnswer: string; fullExplanation: string },
) {
  const card = db
    .select({ examId: flashcards.examId })
    .from(flashcards)
    .where(eq(flashcards.id, cardId))
    .get();
  if (!card) return null;

  const result = editCard(db, cardId, fields);
  if (!result) return null;

  revalidatePath(`/exams/${card.examId}/cards`);

  return {
    undoAvailable: result.undoAvailable,
    revisionCreated: result.revisionCreated,
  };
}

export async function undoCardEditAction(cardId: string) {
  const card = db
    .select({ examId: flashcards.examId })
    .from(flashcards)
    .where(eq(flashcards.id, cardId))
    .get();
  if (!card) return null;

  const result = undoCardEdit(db, cardId);
  if (!result) return null;

  revalidatePath(`/exams/${card.examId}/cards`);

  return {
    question: result.card.question,
    directAnswer: result.card.directAnswer,
    fullExplanation: result.card.fullExplanation,
    isUserEdited: result.card.isUserEdited,
    undoAvailable: result.undoAvailable,
  };
}

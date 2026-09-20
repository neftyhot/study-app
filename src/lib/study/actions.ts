"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { flashcards } from "@/db/schema";

import type { Grade } from "./grade";
import type { QueueFilter } from "./queue";
import {
  completeSession,
  gradeCard,
  setPosition,
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
 * In-place editing (PRD §4). Sets `is_user_edited` so later regeneration and
 * the coverage matrix can tell the student's wording from the model's.
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
  if (!card) return;

  db.update(flashcards)
    .set({
      question: fields.question.trim(),
      directAnswer: fields.directAnswer.trim(),
      fullExplanation: fields.fullExplanation.trim() || null,
      isUserEdited: true,
    })
    .where(eq(flashcards.id, cardId))
    .run();

  revalidatePath(`/exams/${card.examId}/cards`);
}

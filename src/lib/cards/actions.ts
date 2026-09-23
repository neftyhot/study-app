"use server";

import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { createExam } from "@/lib/manage";

import {
  CardInputError,
  createManualCard,
  createManualCards,
  deleteCards,
  duplicateCards,
  moveCards,
  retagCards,
  setStarred,
  type ManualCardInput,
} from "./manual";

export type CreateResult =
  | { ok: true; cardId: string }
  | { ok: false; problems: string[] };

export async function createCardAction(
  input: ManualCardInput,
): Promise<CreateResult> {
  try {
    const card = createManualCard(db, input);
    revalidatePath(`/exams/${input.examId}`);
    revalidatePath(`/exams/${input.examId}/cards`);
    return { ok: true, cardId: card.id };
  } catch (error) {
    if (error instanceof CardInputError) {
      return { ok: false, problems: error.problems };
    }
    throw error;
  }
}

export type SetCardInput = Omit<ManualCardInput, "examId">;

/** Saves a whole set of cards at once — the "type a deck in" editor. */
export async function createCardSetAction(examId: string, cards: SetCardInput[]) {
  const result = createManualCards(db, examId, cards);
  if ("problems" in result) return { ok: false as const, problems: result.problems };

  revalidatePath("/exams/[examId]", "layout");
  return { ok: true as const, created: result.created };
}

/** A deck with no uploaded material behind it — a student's own set. */
export async function createDeckAction(input: {
  courseId: string;
  title: string;
}) {
  const exam = createExam(db, { courseId: input.courseId, title: input.title });
  revalidatePath("/");
  return exam ? { id: exam.id, title: exam.title } : null;
}

export type BulkAction =
  | { kind: "move"; targetExamId: string }
  | { kind: "duplicate"; targetExamId: string }
  | { kind: "retag"; topic: string }
  | { kind: "star"; starred: boolean }
  | { kind: "delete" };

export async function bulkCardAction(
  examId: string,
  cardIds: string[],
  action: BulkAction,
) {
  const result = (() => {
    switch (action.kind) {
      case "move":
        return moveCards(db, cardIds, action.targetExamId);
      case "duplicate":
        return duplicateCards(db, cardIds, action.targetExamId);
      case "retag":
        return retagCards(db, cardIds, action.topic);
      case "star":
        return setStarred(db, cardIds, action.starred);
      case "delete":
        return deleteCards(db, cardIds);
    }
  })();

  revalidatePath(`/exams/${examId}`);
  revalidatePath(`/exams/${examId}/cards`);
  if ("targetExamId" in action) {
    revalidatePath(`/exams/${action.targetExamId}/cards`);
  }

  return result;
}

"use server";

import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { getTypedGrader } from "@/lib/grade";
import { getProvider } from "@/lib/llm";
import { regroupTopics } from "@/lib/topics";

import {
  abandonPaper,
  createPaper,
  loadPaperCards,
  paperQuestions,
  saveAnswer,
  selectCards,
  submitPaper,
} from "./session";
import { rewriteQuestions } from "./rewrite";

export type StartRequest = {
  questionCount: number;
  durationMinutes: number | null;
  /** File ids (or "own"); empty means every source. */
  sources: string[];
  ranges: Record<string, { from: number; to: number }>;
  topics: string[];
  rephrase: boolean;
};

/**
 * Sets a paper.
 *
 * Rewording needs a model and is the slow part, so it is optional and fails
 * soft: a paper in the deck's own wording is worth more than no paper.
 */
export async function startPaper(examId: string, request: StartRequest) {
  const cards = loadPaperCards(db, examId);
  const scope = {
    sources: request.sources,
    ranges: request.ranges,
    topics: request.topics,
  };
  // One seed for both picks: the cards reworded here must be the cards the
  // paper is then built from, or the rewrites land on questions not asked.
  const seed = Math.floor(Math.random() * 2 ** 31);
  const selected = selectCards(cards, {
    questionCount: request.questionCount,
    ...scope,
    seed,
  });

  if (selected.length === 0) {
    return {
      ok: false as const,
      error: "No cards come from those sources and pages. Widen the range or pick another file.",
    };
  }

  let rephrased: Map<string, string> | undefined;

  if (request.rephrase) {
    try {
      rephrased = await rewriteQuestions(
        getProvider(),
        selected.map((card) => ({ id: card.id, question: card.question })),
      );
    } catch {
      // No model, or it failed. The paper is still worth sitting.
      rephrased = undefined;
    }
  }

  const paper = createPaper(db, examId, {
    questionCount: request.questionCount,
    ...scope,
    seed,
    durationMinutes: request.durationMinutes,
    rephrased,
  });

  if (!paper) return { ok: false as const, error: "Could not set a paper." };

  revalidatePath(`/exams/${examId}/practice`);

  return {
    ok: true as const,
    paperId: paper.id,
    rephrased: paper.rephrased,
    askedFor: request.questionCount,
    set: paper.questionCount,
  };
}

export async function answerQuestion(questionId: string, answer: string) {
  saveAnswer(db, questionId, answer);
}

export async function submit(examId: string, paperId: string) {
  const marked = await submitPaper(db, paperId, getTypedGrader());
  revalidatePath(`/exams/${examId}/practice`);
  return marked ?? null;
}

export async function abandon(examId: string, paperId: string) {
  abandonPaper(db, paperId);
  revalidatePath(`/exams/${examId}/practice`);
}

export async function loadQuestions(paperId: string) {
  return paperQuestions(db, paperId).map((question) => ({
    id: question.id,
    position: question.position,
    format: question.format,
    prompt: question.prompt,
    options: question.options,
    answer: question.answer,
  }));
}

/**
 * Folds each file's narrow topics into a few broad ones (see `lib/topics`).
 * Force regroups even files that already look broad enough.
 */
export async function regroupTopicsAction(examId: string, force = false) {
  try {
    const result = await regroupTopics(db, getProvider(), examId, { force });
    revalidatePath("/exams/[examId]", "layout");
    return { ok: true as const, ...result };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Could not regroup topics.",
    };
  }
}

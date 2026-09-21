"use server";

import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { getTypedGrader } from "@/lib/grade";
import { getProvider } from "@/lib/llm";

import {
  abandonPaper,
  createPaper,
  diagnostic,
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
  const selected = selectCards(cards, {
    questionCount: request.questionCount,
    topics: request.topics,
  });

  if (selected.length === 0) {
    return { ok: false as const, error: "No cards match those topics." };
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
    topics: request.topics,
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

export async function loadDiagnostic(paperId: string) {
  return diagnostic(db, paperId).map((row) => ({
    id: row.id,
    position: row.position,
    prompt: row.prompt,
    topic: row.topic,
    format: row.format,
    answer: row.answer,
    verdict: row.verdict,
    errorType: row.errorType,
    feedback: row.feedback,
    expectedAnswer: row.expectedAnswer,
    missedPoints: row.missedPoints,
    source: row.source,
  }));
}

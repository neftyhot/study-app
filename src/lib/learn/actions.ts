"use server";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { cardRubrics, flashcards } from "@/db/schema";
import type { QueueFilter } from "@/lib/study/queue";

import { hasRevision } from "@/lib/cards/edit";

import { buildMcq, type McqCard, type McqOption } from "./mcq";
import type { Stage } from "./ladder";
import {
  assistsForCard,
  diagnoseCard,
  existingDiagnosis,
  type AssistKind,
} from "@/lib/assist";
import { getProvider } from "@/lib/llm";

import {
  finishLearnSession,
  loadLearn,
  loadLearnCards,
  overrideAttempt,
  recordAttempt,
  skipToRecall,
  startLearnSession,
  startNextRound,
  submitOutcome,
  provideAssist,
} from "./session";
import type { TypedGrade } from "./typed";
import { getTypedGrader } from "@/lib/grade";

/**
 * Typed answers are graded on the server: the client never receives the answer
 * it is being asked for, and correctness is never the browser's to decide.
 */
const grader = getTypedGrader();

export type LearnPrompt = {
  cardId: string;
  stage: Stage;
  topic: string | null;
  question: string;
  /** Present only on a recognition step. */
  options?: { text: string }[];
  /** Sub-concept breakdown, shown once errors repeat (PRD §5). */
  breakdown?: string[];
  remediate: boolean;
  countsTowardMastery: boolean;
  /** An earlier edit to this card is still restorable. */
  canUndo: boolean;
};

export type LearnStatus = {
  prompt: LearnPrompt | null;
  roundNumber: number;
  roundCount: number;
  roundComplete: boolean;
  remaining: number;
  mastered: number;
  struggled: number;
};

export type Reveal = {
  directAnswer: string;
  fullExplanation: string | null;
  sourceExcerpt: string | null;
  /** Why the chosen option was wrong (PRD §8 debrief). */
  debrief?: string;
  grade?: TypedGrade;
  correct: boolean;
  /** Why this card keeps being missed, once there is a pattern (PRD §14). */
  diagnosis?: {
    category: string;
    explanation: string;
    suggestion: string;
  } | null;
  /** Set for typed answers, so the student can overrule the grade (PRD §7). */
  attemptId?: string;
};

/** Stable per card and attempt, so re-rendering does not reshuffle the options. */
function seedFor(sessionId: string, cardId: string, attempts: number): number {
  const input = `${sessionId}:${cardId}:${attempts}`;
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function cardRow(cardId: string) {
  return db
    .select({
      id: flashcards.id,
      examId: flashcards.examId,
      topic: flashcards.topic,
      question: flashcards.question,
      directAnswer: flashcards.directAnswer,
      fullExplanation: flashcards.fullExplanation,
      sourceExcerpt: flashcards.sourceExcerpt,
      essentialPoints: cardRubrics.essentialPoints,
      optionalPoints: cardRubrics.optionalPoints,
      misconceptions: cardRubrics.commonMisconceptions,
    })
    .from(flashcards)
    .leftJoin(cardRubrics, eq(cardRubrics.flashcardId, flashcards.id))
    .where(eq(flashcards.id, cardId))
    .get();
}

function optionsFor(
  sessionId: string,
  card: NonNullable<ReturnType<typeof cardRow>>,
  attempts: number,
): McqOption[] {
  const deck: McqCard[] = loadLearnCards(db, card.examId).map((row) => ({
    id: row.id,
    topic: row.topic,
    question: row.question,
    directAnswer: row.directAnswer,
    misconceptions: row.misconceptions ?? [],
  }));

  return buildMcq(
    {
      id: card.id,
      topic: card.topic,
      question: card.question,
      directAnswer: card.directAnswer,
      misconceptions: card.misconceptions ?? [],
    },
    deck,
    { seed: seedFor(sessionId, card.id, attempts) },
  );
}

function status(sessionId: string): LearnStatus {
  const view = loadLearn(db, sessionId);

  if (!view || !view.state) {
    return {
      prompt: null,
      roundNumber: view?.roundNumber ?? 0,
      roundCount: view?.roundCount ?? 0,
      roundComplete: true,
      remaining: 0,
      mastered: 0,
      struggled: 0,
    };
  }

  const { state, step } = view;
  const concepts = state.concepts;

  const base = {
    roundNumber: view.roundNumber,
    roundCount: view.roundCount,
    roundComplete: step === null,
    remaining: concepts.filter((concept) => !concept.done).length,
    mastered: concepts.filter((concept) => concept.tier === "immediate_recall")
      .length,
    struggled: concepts.filter((concept) => concept.struggled).length,
  };

  if (!step) return { ...base, prompt: null };

  const card = cardRow(step.cardId);
  if (!card) return { ...base, prompt: null };

  const concept = concepts.find((c) => c.cardId === step.cardId);

  return {
    ...base,
    prompt: {
      cardId: card.id,
      stage: step.stage,
      topic: card.topic,
      question: card.question,
      options:
        step.stage === "mcq"
          ? optionsFor(sessionId, card, concept?.attempts ?? 0).map(
              ({ text }) => ({ text }),
            )
          : undefined,
      breakdown: step.remediate ? (card.essentialPoints ?? []) : undefined,
      remediate: step.remediate,
      countsTowardMastery: step.countsTowardMastery,
      canUndo: hasRevision(db, card.id),
    },
  };
}

export async function beginLearnSession(
  examId: string,
  filter: QueueFilter & { roundSize?: number },
) {
  const session = startLearnSession(db, examId, filter);
  return { sessionId: session.id, status: status(session.id) };
}

export async function getLearnStatus(sessionId: string) {
  return status(sessionId);
}

export async function answerMultipleChoice(
  sessionId: string,
  cardId: string,
  chosen: string,
  guessed = false,
): Promise<{ reveal: Reveal; status: LearnStatus } | null> {
  const card = cardRow(cardId);
  if (!card) return null;

  const view = loadLearn(db, sessionId);
  const concept = view?.state?.concepts.find((c) => c.cardId === cardId);
  const options = optionsFor(sessionId, card, concept?.attempts ?? 0);

  // Correctness is decided from the stored answer, never from the client.
  const picked = options.find((option) => option.text === chosen);
  const correct = picked?.correct ?? false;

  const submitted = submitOutcome(db, sessionId, cardId, { correct, guessed });
  if (!submitted) return null;

  return {
    reveal: {
      correct,
      directAnswer: card.directAnswer,
      fullExplanation: card.fullExplanation,
      sourceExcerpt: card.sourceExcerpt,
      debrief: picked?.debrief,
    },
    status: status(sessionId),
  };
}

export async function answerTyped(
  sessionId: string,
  cardId: string,
  answer: string,
  guessed = false,
): Promise<{ reveal: Reveal; status: LearnStatus } | null> {
  const card = cardRow(cardId);
  if (!card) return null;

  const view = loadLearn(db, sessionId);
  const step = view?.step;
  if (!step || step.cardId !== cardId) return null;

  const grade = await grader.grade({
    question: card.question,
    expected: card.directAnswer,
    essentialPoints: card.essentialPoints ?? [],
    optionalPoints: card.optionalPoints ?? [],
    misconceptions: card.misconceptions ?? [],
    answer,
  });

  const correct = grade.verdict === "correct";

  const submitted = submitOutcome(db, sessionId, cardId, {
    correct,
    guessed,
    metPoints: grade.metPoints,
    verdict: grade.verdict,
  });
  if (!submitted) return null;

  // An answer given after a hint is assisted practice, not recall.
  const assisted = assistsForCard(db, cardId, sessionId).length > 0;

  const attempt = recordAttempt(db, {
    flashcardId: cardId,
    sessionId,
    stage: step.stage,
    answer,
    grade,
    countsTowardMastery: step.countsTowardMastery,
    guessed,
    assisted,
  });

  // A pattern of wrong answers is worth explaining; one is not.
  let diagnosis = null;
  if (!correct) {
    try {
      diagnosis = (await diagnoseCard(db, getProvider(), cardId)) ?? null;
    } catch {
      diagnosis = existingDiagnosis(db, cardId) ?? null;
    }
  }

  return {
    reveal: {
      correct,
      grade,
      attemptId: attempt.id,
      directAnswer: card.directAnswer,
      fullExplanation: card.fullExplanation,
      sourceExcerpt: card.sourceExcerpt,
      diagnosis: diagnosis
        ? {
            category: diagnosis.category,
            explanation: diagnosis.explanation,
            suggestion: diagnosis.suggestion,
          }
        : null,
    },
    status: status(sessionId),
  };
}

export type AssistResult = {
  kind: AssistKind;
  body: string;
  usesOutsideKnowledge: boolean;
  status: LearnStatus;
};

/**
 * Asks for help mid-question (PRD §14).
 *
 * Returns the updated status too, because using an aid changes what the
 * current attempt can prove — the badge flips from "Counts" to "Practice"
 * as soon as the help arrives, rather than silently downgrading later.
 */
export async function askForHelp(
  sessionId: string,
  cardId: string,
  kind: AssistKind,
): Promise<AssistResult | { error: string }> {
  try {
    const provider = kind === "source" ? undefined : getProvider();
    const event = await provideAssist(
      db,
      provider ?? ({} as never),
      sessionId,
      cardId,
      kind,
    );

    if (!event) return { error: "That card is no longer available." };

    return {
      kind,
      body: event.body,
      usesOutsideKnowledge: event.usesOutsideKnowledge,
      status: status(sessionId),
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Could not fetch help",
    };
  }
}

/**
 * "My answer was correct" (PRD §7): the student overrules the grader, and the
 * ladder rejoins where it would have been had the answer been marked right.
 */
export async function overrideAnswer(sessionId: string, attemptId: string) {
  const result = overrideAttempt(db, attemptId);
  return { applied: Boolean(result), status: status(sessionId) };
}

/**
 * Drill only the points an answer missed (PRD §7).
 *
 * Graded and recorded but never scored: it is deliberate practice on a known
 * gap, not a fresh claim to know the whole concept.
 */
export async function practiceMissedPoints(
  cardId: string,
  answer: string,
  focusPoints: string[],
): Promise<TypedGrade | null> {
  const card = cardRow(cardId);
  if (!card || focusPoints.length === 0) return null;

  const grade = await grader.grade({
    question: card.question,
    expected: card.directAnswer,
    essentialPoints: card.essentialPoints ?? [],
    optionalPoints: card.optionalPoints ?? [],
    misconceptions: card.misconceptions ?? [],
    focusPoints,
    answer,
  });

  recordAttempt(db, {
    flashcardId: cardId,
    answer,
    grade,
    countsTowardMastery: false,
    practice: true,
  });

  return grade;
}

export async function skipToTypedRecall(sessionId: string, cardId: string) {
  skipToRecall(db, sessionId, cardId);
  return status(sessionId);
}

export async function nextLearnRound(sessionId: string) {
  const more = startNextRound(db, sessionId);
  return { more, status: status(sessionId) };
}

export async function endLearnSession(sessionId: string) {
  finishLearnSession(db, sessionId);
}

/** Topic list for the Learn picker, excluding cards the student excluded. */
export async function learnTopics(examId: string) {
  const rows = db
    .selectDistinct({ topic: flashcards.topic })
    .from(flashcards)
    .where(and(eq(flashcards.examId, examId), eq(flashcards.excluded, false)))
    .orderBy(flashcards.topic)
    .all();

  return rows
    .map((row) => row.topic)
    .filter((topic): topic is string => Boolean(topic));
}

/**
 * Learn-mode persistence.
 *
 * Reuses `study_sessions` with `mode: "learn"`: a Learn run is still one pass
 * through a chosen deck, with the engine's state saved alongside so a round
 * survives a reload the same way a flashcard session does.
 */
import { and, desc, eq, isNull } from "drizzle-orm";

import type { Db } from "@/db/client";
import {
  answerAttempts,
  cardRubrics,
  flashcards,
  studyProgress,
  studySessions,
  type AnswerAttempt,
  type AssistEvent,
  type StudySession,
} from "@/db/schema";
import { buildQueue, type QueueFilter } from "@/lib/study/queue";
import { loadQueueCards } from "@/lib/study/session";

import {
  applyOutcome,
  isComplete,
  markAssisted,
  nextStep,
  skipRecognition,
  startRound,
  type Outcome,
  type RoundState,
  type Step,
} from "./ladder";
import { qualityForVerdict, scheduleFor } from "@/lib/srs";

import { applyLearnResult } from "./progress";
import type { TypedGrade } from "./typed";
import { requestAssist, type AssistKind } from "@/lib/assist";
import type { LlmProvider } from "@/lib/llm";

/** Concepts per round, bounded by PRD §5's 5–8. */
export const MIN_ROUND_SIZE = 5;
export const MAX_ROUND_SIZE = 8;
export const DEFAULT_ROUND_SIZE = 6;

export function clampRoundSize(size: number): number {
  if (!Number.isFinite(size)) return DEFAULT_ROUND_SIZE;
  return Math.min(Math.max(Math.round(size), MIN_ROUND_SIZE), MAX_ROUND_SIZE);
}

export function openLearnSession(
  db: Db,
  examId: string,
): StudySession | undefined {
  return db
    .select()
    .from(studySessions)
    .where(
      and(
        eq(studySessions.examId, examId),
        eq(studySessions.mode, "learn"),
        isNull(studySessions.completedAt),
      ),
    )
    .orderBy(desc(studySessions.updatedAt))
    .get();
}

/** Cards already recognized can skip the recognition rung (PRD §5). */
function knownCards(db: Db, cardIds: readonly string[]): Set<string> {
  if (cardIds.length === 0) return new Set();

  return new Set(
    db
      .select({
        flashcardId: studyProgress.flashcardId,
        state: studyProgress.state,
      })
      .from(studyProgress)
      .all()
      .filter(
        (row) =>
          cardIds.includes(row.flashcardId) &&
          (row.state === "recognition" ||
            row.state === "immediate_recall" ||
            row.state === "retained"),
      )
      .map((row) => row.flashcardId),
  );
}

export function startLearnSession(
  db: Db,
  examId: string,
  filter: QueueFilter & { roundSize?: number },
): StudySession {
  const order = buildQueue(loadQueueCards(db, examId), filter);
  const roundSize = clampRoundSize(filter.roundSize ?? DEFAULT_ROUND_SIZE);

  const existing = openLearnSession(db, examId);
  if (existing) {
    const now = new Date().toISOString();
    db.update(studySessions)
      .set({ completedAt: now, updatedAt: now })
      .where(eq(studySessions.id, existing.id))
      .run();
  }

  const first = order.slice(0, roundSize);

  return db
    .insert(studySessions)
    .values({
      examId,
      mode: "learn",
      scope: filter.scope,
      topic: filter.scope === "topic" ? (filter.topic ?? null) : null,
      shuffled: filter.shuffled ?? false,
      cardOrder: order,
      roundSize,
      roundIndex: 0,
      roundState:
        first.length > 0
          ? startRound(first, { skipRecognitionFor: knownCards(db, first) })
          : null,
    })
    .returning()
    .get();
}

export type LearnView = {
  session: StudySession;
  state: RoundState | null;
  step: Step | null;
  roundNumber: number;
  roundCount: number;
};

export function loadLearn(db: Db, sessionId: string): LearnView | undefined {
  const session = db
    .select()
    .from(studySessions)
    .where(eq(studySessions.id, sessionId))
    .get();
  if (!session) return undefined;

  const state = session.roundState ?? null;

  return {
    session,
    state,
    step: state ? nextStep(state) : null,
    roundNumber: Math.floor(session.roundIndex / session.roundSize) + 1,
    roundCount: Math.max(
      Math.ceil(session.cardOrder.length / session.roundSize),
      1,
    ),
  };
}

function save(db: Db, sessionId: string, patch: Partial<StudySession>) {
  db.update(studySessions)
    .set({ ...patch, updatedAt: new Date().toISOString() })
    .where(eq(studySessions.id, sessionId))
    .run();
}

export type SubmitResult = {
  state: RoundState;
  step: Step | null;
  roundComplete: boolean;
};

/**
 * Records one answer: progress first, then the ladder.
 *
 * `cardId` is checked against the step the engine actually expects, so a stale
 * client cannot credit an answer to the wrong concept.
 */
export function submitOutcome(
  db: Db,
  sessionId: string,
  cardId: string,
  outcome: Outcome & {
    metPoints?: string[];
    /** The grader's verdict, so a partial answer is not scheduled as a miss. */
    verdict?: "correct" | "partial" | "incorrect";
  },
): SubmitResult | undefined {
  const session = db
    .select()
    .from(studySessions)
    .where(eq(studySessions.id, sessionId))
    .get();
  if (!session?.roundState) return undefined;

  const step = nextStep(session.roundState);
  if (!step || step.cardId !== cardId) return undefined;

  const current = db
    .select()
    .from(studyProgress)
    .where(eq(studyProgress.flashcardId, cardId))
    .get();

  const update = applyLearnResult(current, {
    stage: step.stage,
    correct: outcome.correct,
    guessed: outcome.guessed,
    countsTowardMastery: step.countsTowardMastery,
    metPoints: outcome.metPoints,
  });

  const schedule = scheduleFor(current, update.state, {
    quality: qualityForVerdict(
      outcome.verdict ?? (outcome.correct ? "correct" : "incorrect"),
    ),
    // Only an unaided recall after other concepts intervened can prove
    // multi-day retention; an MCQ or a just-revealed answer cannot.
    retentionEligible: step.countsTowardMastery,
    guessed: outcome.guessed,
  });

  const row = { ...update, ...schedule };

  if (current) {
    db.update(studyProgress)
      .set(row)
      .where(eq(studyProgress.flashcardId, cardId))
      .run();
  } else {
    db.insert(studyProgress).values({ flashcardId: cardId, ...row }).run();
  }

  const state = applyOutcome(session.roundState, step, outcome);
  // One step of undo, so an overridden grade can rejoin the ladder where it
  // would have been rather than re-asking something the student knew.
  save(db, sessionId, {
    roundState: state,
    previousRoundState: session.roundState,
  });

  return {
    state,
    step: nextStep(state),
    roundComplete: isComplete(state),
  };
}

/**
 * Fetches an aid and marks the concept as assisted (PRD §14).
 *
 * Order matters: the concept is marked before the student answers, so the
 * attempt they make next is already known to be assisted practice.
 */
// Not named `useAssist`: a `use` prefix reads as a React hook to both humans
// and the linter, and this is a database function.
export async function provideAssist(
  db: Db,
  llm: LlmProvider,
  sessionId: string | null,
  cardId: string,
  kind: AssistKind,
): Promise<AssistEvent | undefined> {
  const event = await requestAssist(db, llm, { cardId, kind, sessionId });
  if (!event || !sessionId) return event;

  const session = db
    .select()
    .from(studySessions)
    .where(eq(studySessions.id, sessionId))
    .get();

  if (session?.roundState) {
    save(db, sessionId, {
      roundState: markAssisted(session.roundState, cardId),
    });
  }

  return event;
}

export function skipToRecall(
  db: Db,
  sessionId: string,
  cardId: string,
): SubmitResult | undefined {
  const session = db
    .select()
    .from(studySessions)
    .where(eq(studySessions.id, sessionId))
    .get();
  if (!session?.roundState) return undefined;

  const state = skipRecognition(session.roundState, cardId);
  save(db, sessionId, { roundState: state });

  return { state, step: nextStep(state), roundComplete: isComplete(state) };
}

/** Advances to the next micro-round; returns false when the deck is finished. */
export function startNextRound(db: Db, sessionId: string): boolean {
  const session = db
    .select()
    .from(studySessions)
    .where(eq(studySessions.id, sessionId))
    .get();
  if (!session) return false;

  const nextIndex = session.roundIndex + session.roundSize;
  const slice = session.cardOrder.slice(nextIndex, nextIndex + session.roundSize);

  if (slice.length === 0) {
    const now = new Date().toISOString();
    save(db, sessionId, { completedAt: now, roundState: null });
    return false;
  }

  save(db, sessionId, {
    roundIndex: nextIndex,
    roundState: startRound(slice, {
      skipRecognitionFor: knownCards(db, slice),
    }),
  });

  return true;
}

export function finishLearnSession(db: Db, sessionId: string) {
  const now = new Date().toISOString();
  save(db, sessionId, { completedAt: now });
}

/** Everything the Learn UI needs for one card. */
export function loadLearnCards(db: Db, examId: string) {
  return db
    .select({
      id: flashcards.id,
      topic: flashcards.topic,
      question: flashcards.question,
      directAnswer: flashcards.directAnswer,
      fullExplanation: flashcards.fullExplanation,
      sourceExcerpt: flashcards.sourceExcerpt,
      essentialPoints: cardRubrics.essentialPoints,
      misconceptions: cardRubrics.commonMisconceptions,
    })
    .from(flashcards)
    .leftJoin(cardRubrics, eq(cardRubrics.flashcardId, flashcards.id))
    .where(and(eq(flashcards.examId, examId), eq(flashcards.excluded, false)))
    .orderBy(flashcards.topic, flashcards.createdAt)
    .all();
}

/* ----------------------------------------------------------------- Attempts */

export type AttemptInput = {
  flashcardId: string;
  sessionId?: string | null;
  stage?: string | null;
  answer: string;
  grade: TypedGrade;
  countsTowardMastery: boolean;
  guessed?: boolean;
  /** A sub-point drill: recorded and graded, never scored. */
  practice?: boolean;
  /** The student used an aid before answering (PRD §14). */
  assisted?: boolean;
};

export function recordAttempt(db: Db, input: AttemptInput): AnswerAttempt {
  return db
    .insert(answerAttempts)
    .values({
      flashcardId: input.flashcardId,
      sessionId: input.sessionId ?? null,
      stage: input.stage ?? null,
      answer: input.answer,
      verdict: input.grade.verdict,
      errorType: input.grade.errorType,
      metPoints: input.grade.metPoints,
      missedPoints: input.grade.missedPoints,
      countsTowardMastery: input.countsTowardMastery,
      guessed: input.guessed ?? false,
      practice: input.practice ?? false,
      assisted: input.assisted ?? false,
      provisional: input.grade.provisional,
    })
    .returning()
    .get();
}

export type OverrideResult = {
  attempt: AnswerAttempt;
  ladderRevised: boolean;
};

/**
 * "My answer was correct" (PRD §7).
 *
 * The student overrules the grade, so everything that grade caused is undone:
 * the lapse it recorded, the credit it withheld, and the rung it sent them
 * back to. A practice drill has no score to overturn, and an attempt can only
 * be overridden once.
 */
export function overrideAttempt(
  db: Db,
  attemptId: string,
): OverrideResult | undefined {
  const attempt = db
    .select()
    .from(answerAttempts)
    .where(eq(answerAttempts.id, attemptId))
    .get();

  if (!attempt || attempt.overridden || attempt.practice) return undefined;

  const updated = db
    .update(answerAttempts)
    .set({ overridden: true, verdict: "correct" })
    .where(eq(answerAttempts.id, attemptId))
    .returning()
    .get();

  const current = db
    .select()
    .from(studyProgress)
    .where(eq(studyProgress.flashcardId, attempt.flashcardId))
    .get();

  const update = applyLearnResult(current, {
    stage: (attempt.stage as Step["stage"]) ?? "typed_immediate",
    correct: true,
    countsTowardMastery: attempt.countsTowardMastery,
    // Everything the rubric asked for is credited: the student is asserting
    // their answer said it.
    metPoints: [...attempt.metPoints, ...attempt.missedPoints],
  });

  // The lapse the overturned grade recorded goes with it.
  const lapses = Math.max((current?.lapses ?? 0) - 1, 0);

  // Reschedule as the pass it is now agreed to have been. The failed grade
  // already halved the interval, so this re-grows it from there.
  const schedule = scheduleFor(current, update.state, {
    quality: "pass",
    retentionEligible: attempt.countsTowardMastery,
  });

  const row = { ...update, ...schedule, lapses };

  if (current) {
    db.update(studyProgress)
      .set(row)
      .where(eq(studyProgress.flashcardId, attempt.flashcardId))
      .run();
  } else {
    db.insert(studyProgress)
      .values({ flashcardId: attempt.flashcardId, ...row })
      .run();
  }

  if (!attempt.sessionId) return { attempt: updated, ladderRevised: false };

  const session = db
    .select()
    .from(studySessions)
    .where(eq(studySessions.id, attempt.sessionId))
    .get();

  const previous = session?.previousRoundState;
  if (!previous) return { attempt: updated, ladderRevised: false };

  const step = nextStep(previous);
  if (!step || step.cardId !== attempt.flashcardId) {
    return { attempt: updated, ladderRevised: false };
  }

  save(db, attempt.sessionId, {
    roundState: applyOutcome(previous, step, { correct: true }),
    previousRoundState: null,
  });

  return { attempt: updated, ladderRevised: true };
}

/** The points a card's most recent scored attempt missed, for drilling. */
export function lastMissedPoints(db: Db, flashcardId: string): string[] {
  const attempt = db
    .select()
    .from(answerAttempts)
    .where(eq(answerAttempts.flashcardId, flashcardId))
    .orderBy(desc(answerAttempts.createdAt))
    .get();

  return attempt?.practice ? [] : (attempt?.missedPoints ?? []);
}

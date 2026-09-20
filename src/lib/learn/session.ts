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
  cardRubrics,
  flashcards,
  studyProgress,
  studySessions,
  type StudySession,
} from "@/db/schema";
import { buildQueue, type QueueFilter } from "@/lib/study/queue";
import { loadQueueCards } from "@/lib/study/session";

import {
  applyOutcome,
  isComplete,
  nextStep,
  skipRecognition,
  startRound,
  type Outcome,
  type RoundState,
  type Step,
} from "./ladder";
import { applyLearnResult } from "./progress";

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
  outcome: Outcome & { metPoints?: string[] },
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

  if (current) {
    db.update(studyProgress)
      .set(update)
      .where(eq(studyProgress.flashcardId, cardId))
      .run();
  } else {
    db.insert(studyProgress).values({ flashcardId: cardId, ...update }).run();
  }

  const state = applyOutcome(session.roundState, step, outcome);
  save(db, sessionId, { roundState: state });

  return {
    state,
    step: nextStep(state),
    roundComplete: isComplete(state),
  };
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

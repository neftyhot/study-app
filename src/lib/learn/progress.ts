/**
 * What a Learn outcome is allowed to change (PRD §5, §6).
 *
 * The tiers are separate tracking axes, not one score: recognizing a concept
 * among four options and recalling it cold after other items intervened are
 * different achievements, and PRD §6 wants them counted separately.
 *
 * As in flashcard mode, nothing here writes `interval_days` or
 * `next_review_due` — multi-day scheduling is Phase 7, and a same-session
 * success is not evidence of multi-day retention.
 */
import type { StudyProgress } from "@/db/schema";

import type { Stage } from "./ladder";

const STATE_ORDER: StudyProgress["state"][] = [
  "unstudied",
  "recognition",
  "immediate_recall",
  "retained",
];

export type LearnResult = {
  stage: Stage;
  correct: boolean;
  guessed?: boolean;
  /** False when the answer was just on screen (see `ladder.ts`). */
  countsTowardMastery: boolean;
  /** Rubric points the typed answer actually hit. */
  metPoints?: string[];
};

export type LearnProgressUpdate = {
  state: StudyProgress["state"];
  recognitionCount: number;
  immediateRecallCount: number;
  lapses: number;
  masteredPoints: string[];
  lastReviewedAt: string;
};

export function applyLearnResult(
  current:
    | Pick<
        StudyProgress,
        | "state"
        | "recognitionCount"
        | "immediateRecallCount"
        | "lapses"
        | "masteredPoints"
      >
    | undefined,
  result: LearnResult,
  now: string = new Date().toISOString(),
): LearnProgressUpdate {
  const base = {
    state: current?.state ?? ("unstudied" as StudyProgress["state"]),
    recognitionCount: current?.recognitionCount ?? 0,
    immediateRecallCount: current?.immediateRecallCount ?? 0,
    lapses: current?.lapses ?? 0,
    masteredPoints: current?.masteredPoints ?? [],
    lastReviewedAt: now,
  };

  // A point once demonstrated stays demonstrated: missing one part of a
  // multi-point concept must not reset credit for the parts already mastered.
  const masteredPoints = mergePoints(base.masteredPoints, result.metPoints ?? []);

  const credited = result.correct && !result.guessed;

  if (!credited) {
    return {
      ...base,
      masteredPoints,
      // An admitted guess is not an error, it is an absence of evidence.
      lapses: result.guessed ? base.lapses : base.lapses + 1,
    };
  }

  if (result.stage === "mcq") {
    return {
      ...base,
      masteredPoints,
      recognitionCount: base.recognitionCount + 1,
      state: promote(base.state, "recognition"),
    };
  }

  if (!result.countsTowardMastery) {
    // Correct, but the answer was on screen a moment ago. Practice, not proof.
    return { ...base, masteredPoints };
  }

  return {
    ...base,
    masteredPoints,
    immediateRecallCount: base.immediateRecallCount + 1,
    state: promote(base.state, "immediate_recall"),
  };
}

function promote(
  current: StudyProgress["state"],
  candidate: StudyProgress["state"],
): StudyProgress["state"] {
  return STATE_ORDER.indexOf(current) >= STATE_ORDER.indexOf(candidate)
    ? current
    : candidate;
}

function mergePoints(existing: string[], added: string[]): string[] {
  const seen = new Map(existing.map((point) => [point.toLowerCase(), point]));
  for (const point of added) {
    const key = point.toLowerCase();
    if (!seen.has(key)) seen.set(key, point);
  }
  return [...seen.values()];
}

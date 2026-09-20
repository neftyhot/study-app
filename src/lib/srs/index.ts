import type { StudyProgress } from "@/db/schema";

import {
  DEFAULT_EASE,
  scheduleReview,
  type ReviewSignal,
  type ScheduleState,
} from "./schedule";

export * from "./schedule";

/**
 * Runs the scheduler over a card's stored progress.
 *
 * Takes the tier the grader just promoted the card to, so a review is
 * scheduled against what the student has now shown rather than what they had
 * shown before this answer.
 */
export function scheduleFor(
  current: Partial<StudyProgress> | undefined,
  promotedState: StudyProgress["state"],
  signal: ReviewSignal,
  today?: string,
): ScheduleState {
  const base: ScheduleState = {
    state: promotedState,
    intervalDays: current?.intervalDays ?? 0,
    nextReviewDue: current?.nextReviewDue ?? null,
    ease: current?.ease ?? DEFAULT_EASE,
    retentionCount: current?.retentionCount ?? 0,
    lastCreditedAt: current?.lastCreditedAt ?? null,
  };

  return scheduleReview(base, signal, today);
}

/** Flip-card self-grades map onto the same three qualities. */
export function qualityForGrade(
  grade: "missed" | "difficult" | "easy",
): ReviewSignal["quality"] {
  if (grade === "missed") return "fail";
  if (grade === "difficult") return "partial";
  return "pass";
}

/** Typed verdicts map straight across. */
export function qualityForVerdict(
  verdict: "correct" | "partial" | "incorrect",
): ReviewSignal["quality"] {
  if (verdict === "correct") return "pass";
  if (verdict === "partial") return "partial";
  return "fail";
}

/**
 * The `study_progress` row an answer produces, computed once for every
 * platform.
 *
 * The desktop writes it through Drizzle and the iOS app through raw SQL, but
 * both start from these functions, so a card graded on either device is
 * scheduled identically. `record.test.ts` holds the two to the same result.
 */
import type { StudyProgress } from "../types";
import { applyLearnResult } from "../learn/progress";
import type { LearnMode, Outcome, Step } from "../learn/ladder";
import {
  addDays,
  qualityForGrade,
  qualityForVerdict,
  scheduleFor,
  todayIso,
} from "../srs/index";
import { applyFlashcardGrade, type Grade } from "./grade";

/**
 * Cramming brings every card back tomorrow.
 *
 * The interval and ease are kept, so once the exam is over the card carries on
 * spacing out from where the scheduler put it; only the next date is pulled in.
 */
export function forMode<T extends { nextReviewDue: string | null }>(
  schedule: T,
  mode: LearnMode | undefined,
  today = todayIso(),
): T {
  if (mode !== "cram") return schedule;
  const tomorrow = addDays(today, 1);
  const due = schedule.nextReviewDue;
  return due !== null && due <= tomorrow
    ? schedule
    : { ...schedule, nextReviewDue: tomorrow };
}

/**
 * A flip-card grade. It is given after the answer was revealed, so it moves
 * the review schedule but can never establish multi-day retention (PRD §6).
 */
export function flipGradeRow(
  current: StudyProgress | undefined,
  grade: Grade,
  options: { now?: string; today?: string } = {},
) {
  const update = applyFlashcardGrade(current, grade, options.now);
  const schedule = scheduleFor(
    current,
    update.state,
    { quality: qualityForGrade(grade), retentionEligible: false },
    options.today,
  );
  return { ...update, ...schedule };
}

export type LearnAnswer = Outcome & {
  metPoints?: string[];
  /** The grader's verdict, so a partial answer is not scheduled as a miss. */
  verdict?: "correct" | "partial" | "incorrect";
};

/** One Learn answer against the step the ladder asked for. */
export function learnOutcomeRow(
  current: StudyProgress | undefined,
  step: Pick<Step, "stage" | "countsTowardMastery">,
  outcome: LearnAnswer,
  mode: LearnMode | undefined,
  options: { now?: string; today?: string } = {},
) {
  const update = applyLearnResult(
    current,
    {
      stage: step.stage,
      correct: outcome.correct,
      guessed: outcome.guessed,
      countsTowardMastery: step.countsTowardMastery,
      metPoints: outcome.metPoints,
    },
    options.now,
  );

  const schedule = scheduleFor(
    current,
    update.state,
    {
      quality: qualityForVerdict(
        outcome.verdict ?? (outcome.correct ? "correct" : "incorrect"),
      ),
      // Only an unaided recall after other concepts intervened can prove
      // multi-day retention; an MCQ or a just-revealed answer cannot.
      retentionEligible: step.countsTowardMastery,
      guessed: outcome.guessed,
    },
    options.today,
  );

  return { ...update, ...forMode(schedule, mode, options.today) };
}

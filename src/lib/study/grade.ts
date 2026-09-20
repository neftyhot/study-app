/**
 * What a flip-card grade is allowed to change (PRD §4, §6).
 *
 * Grading in normal flashcard mode happens AFTER the answer is revealed, so it
 * is the student's own assessment of recognition — not evidence of independent
 * recall. PRD §6 is explicit that post-reveal signals must not count toward
 * recall intervals, so this never writes `interval_days` or `next_review_due`
 * and never promotes past the recognition tier. Scheduling is Phase 7's job.
 *
 * It also never demotes. A single missed flip does not erase multi-day
 * retention credit already earned (PRD §6, granular error accounting); it
 * records a lapse, which is what the scheduler will read later.
 */
import type { StudyProgress } from "@/db/schema";

export const GRADES = ["missed", "difficult", "easy"] as const;

export type Grade = (typeof GRADES)[number];

export type ProgressUpdate = {
  state: StudyProgress["state"];
  recognitionCount: number;
  lapses: number;
  lastGrade: Grade;
  lastReviewedAt: string;
};

export function applyFlashcardGrade(
  current: Pick<StudyProgress, "state" | "recognitionCount" | "lapses"> | undefined,
  grade: Grade,
  now: string = new Date().toISOString(),
): ProgressUpdate {
  const state = current?.state ?? "unstudied";
  const recognitionCount = current?.recognitionCount ?? 0;
  const lapses = current?.lapses ?? 0;

  if (grade === "missed") {
    return {
      state,
      recognitionCount,
      lapses: lapses + 1,
      lastGrade: grade,
      lastReviewedAt: now,
    };
  }

  return {
    // Only the first rung of the ladder: recognizing a revealed answer is not
    // recall, however easy it felt.
    state: state === "unstudied" ? "recognition" : state,
    recognitionCount: recognitionCount + 1,
    lapses,
    lastGrade: grade,
    lastReviewedAt: now,
  };
}

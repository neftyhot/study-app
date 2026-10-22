/**
 * The shapes the core logic reads, written out so the core never imports the
 * desktop's database schema. `src/lib/core-compat.ts` checks at compile time
 * that these still match `src/db/schema.ts` exactly.
 */

export const progressStates = ["unstudied", "recognition", "immediate_recall", "retained"] as const;
export type ProgressState = (typeof progressStates)[number];

export const grades = ["missed", "difficult", "easy"] as const;
export type Grade = (typeof grades)[number];

export const cardTypes = ["atomic", "process", "integration", "application", "cloze"] as const;
export type CardType = (typeof cardTypes)[number];

/** One card's review state: a row of `study_progress`. */
export type StudyProgress = {
  id: string;
  flashcardId: string;
  state: ProgressState;
  intervalDays: number;
  /** Due date (YYYY-MM-DD); null means not yet scheduled. */
  nextReviewDue: string | null;
  ease: number;
  lastCreditedAt: string | null;
  lastGrade: Grade | null;
  lastReviewedAt: string | null;
  recognitionCount: number;
  immediateRecallCount: number;
  retentionCount: number;
  lapses: number;
  masteredPoints: string[];
  updatedAt: string | null;
  deletedAt: string | null;
};

// Kept apart from session.ts so the Learn screen can use it without the database.

/**
 * Concepts per round. PRD §5 suggested 5–8; the student now chooses, and
 * these bounds only keep a typo from making a round of none or thousands.
 */
export const MIN_ROUND_SIZE = 1;
export const MAX_ROUND_SIZE = 50;
export const DEFAULT_ROUND_SIZE = 6;

export function clampRoundSize(size: number): number {
  if (!Number.isFinite(size)) return DEFAULT_ROUND_SIZE;
  return Math.min(Math.max(Math.round(size), MIN_ROUND_SIZE), MAX_ROUND_SIZE);
}

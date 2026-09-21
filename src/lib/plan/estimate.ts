/**
 * How long studying actually takes (PRD §12).
 *
 * Every number here is a guess, but a guess with a stated basis beats a
 * planner that quietly assumes all cards cost the same. They are deliberately
 * a little pessimistic: a plan that overruns is worse than one that finishes
 * early, because the first teaches a student to distrust it.
 */
export const MINUTES = {
  /** Read, try to recall, flip, grade. */
  flipReview: 0.2,
  /** Type an answer and read the feedback on it. */
  typedReview: 0.6,
  /**
   * A new concept costs the whole ladder — recognise it, recall it, recall it
   * again after other items, and once more later — not one look.
   */
  newConcept: 2,
  /** A concept that keeps being missed needs the breakdown and another pass. */
  strugglingExtra: 0.5,
} as const;

/** Lapses at which a card stops being "hard" and starts being "stuck". */
export const STRUGGLING_LAPSES = 2;

import { DEFAULT_EASE, FIRST_INTERVAL, SECOND_INTERVAL } from "@/lib/srs";

/**
 * How many times a card learned today will come back before a given day.
 *
 * Walks the real scheduling ladder rather than assuming a flat rate: the first
 * reviews are close together and they spread out fast, so a fortnight costs
 * far less per card than a naive "one review a day" estimate suggests.
 */
export function reviewsWithin(days: number, ease: number = DEFAULT_EASE): number {
  if (!Number.isFinite(days) || days <= 0) return 0;

  let interval = 0;
  let elapsed = 0;
  let reviews = 0;

  for (let guard = 0; guard < 64; guard += 1) {
    interval =
      interval <= 0
        ? FIRST_INTERVAL
        : interval < SECOND_INTERVAL
          ? SECOND_INTERVAL
          : Math.max(SECOND_INTERVAL + 1, Math.round(interval * ease));

    elapsed += interval;
    if (elapsed > days) break;
    reviews += 1;
  }

  return reviews;
}

/** Whole minutes, never rounding a real cost down to zero. */
export function roundMinutes(minutes: number): number {
  if (minutes <= 0) return 0;
  return Math.max(1, Math.round(minutes));
}

export function formatMinutes(minutes: number): string {
  const total = roundMinutes(minutes);
  if (total < 60) return `${total} min`;

  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

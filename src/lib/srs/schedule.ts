/**
 * Multi-day spaced review (PRD §6).
 *
 * Every earlier phase refused to write `interval_days` or `next_review_due`
 * and deferred here, so this module is the only thing that schedules anything.
 *
 * Two ideas carry the whole design:
 *
 *  1. **Not every correct answer is evidence.** A guess schedules nothing. An
 *     answer typed straight after seeing it, or recognized among four options,
 *     moves the review schedule but can never establish multi-day retention —
 *     only unaided recall, after other items intervened, can do that.
 *  2. **Being behind is not being wrong.** A card answered late is scheduled
 *     from its interval, not from how overdue it was, and a miss halves an
 *     interval rather than resetting it. Missing a week of study must not cost
 *     a student the deck they built.
 */
import type { StudyProgress } from "@/db/schema";

export const DEFAULT_EASE = 2.3;
export const MIN_EASE = 1.3;
export const MAX_EASE = 3;

/** First two intervals are fixed; after that the ease multiplier takes over. */
export const FIRST_INTERVAL = 1;
export const SECOND_INTERVAL = 3;

export type ReviewQuality = "pass" | "partial" | "fail";

export type ReviewSignal = {
  quality: ReviewQuality;
  /**
   * True only for independent recall: typed, unaided, after other concepts
   * intervened. Everything else can move the schedule but never proves
   * retention (PRD §6, invalid-signal discard).
   */
  retentionEligible: boolean;
  /** An admitted guess is not evidence of anything, and schedules nothing. */
  guessed?: boolean;
};

/**
 * What the scheduler owns. Lapse counting belongs to the graders, which
 * already record it against the answer that caused it; this module decides
 * only when the card is seen again and what tier that proves.
 */
export type ScheduleState = Pick<
  StudyProgress,
  | "state"
  | "intervalDays"
  | "nextReviewDue"
  | "ease"
  | "retentionCount"
  | "lastCreditedAt"
>;

export function todayIso(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  // Local noon avoids a daylight-saving shift moving the date by a day.
  const date = new Date(year, month - 1, day, 12);
  date.setDate(date.getDate() + days);
  return todayIso(date);
}

function clampEase(ease: number): number {
  return Math.min(Math.max(ease, MIN_EASE), MAX_EASE);
}

function nextInterval(current: number, ease: number): number {
  if (current <= 0) return FIRST_INTERVAL;
  if (current < SECOND_INTERVAL) return SECOND_INTERVAL;
  return Math.max(SECOND_INTERVAL + 1, Math.round(current * ease));
}

/**
 * A miss costs a tier only at the top.
 *
 * Dropping a card all the way back would contradict PRD §6's granular error
 * accounting: forgetting one part of a multi-point concept must not erase the
 * parts that are known.
 */
function demote(state: StudyProgress["state"]): StudyProgress["state"] {
  return state === "retained" ? "immediate_recall" : state;
}

export function scheduleReview(
  current: ScheduleState,
  signal: ReviewSignal,
  today: string = todayIso(),
): ScheduleState {
  // No evidence, no schedule change — not even a lapse.
  if (signal.guessed) return current;

  const ease = current.ease || DEFAULT_EASE;

  if (signal.quality === "fail") {
    return {
      ...current,
      state: demote(current.state),
      ease: clampEase(ease - 0.2),
      // Halved, never reset: the card is harder than we thought, not unseen.
      intervalDays: Math.max(1, Math.floor(current.intervalDays / 2)),
      nextReviewDue: addDays(
        today,
        Math.max(1, Math.floor(current.intervalDays / 2)),
      ),
    };
  }

  if (signal.quality === "partial") {
    const interval = Math.max(1, current.intervalDays);
    return {
      ...current,
      ease: clampEase(ease - 0.15),
      // Right as far as it goes: see it again at the same spacing, not later.
      intervalDays: interval,
      nextReviewDue: addDays(today, interval),
    };
  }

  // A second success on the same day is the same day's evidence, not new
  // evidence. Grinding one card in one sitting cannot push it out a month.
  if (current.lastCreditedAt === today) {
    return current;
  }

  const interval = nextInterval(current.intervalDays, ease);

  // Retention is the multi-day axis: an unaided recall on a later day than the
  // last credited one is the only thing that can establish it.
  const retained =
    signal.retentionEligible && current.lastCreditedAt !== null;

  return {
    ...current,
    state: retained ? "retained" : current.state,
    retentionCount: retained
      ? current.retentionCount + 1
      : current.retentionCount,
    ease: clampEase(ease + 0.05),
    intervalDays: interval,
    nextReviewDue: addDays(today, interval),
    lastCreditedAt: today,
  };
}

export function isDue(
  progress: Pick<StudyProgress, "nextReviewDue">,
  today: string = todayIso(),
): boolean {
  // ISO dates compare correctly as strings, and "overdue" is just "due".
  return progress.nextReviewDue !== null && progress.nextReviewDue <= today;
}

/** How late a card is, for showing a backlog without punishing it. */
export function daysOverdue(
  progress: Pick<StudyProgress, "nextReviewDue">,
  today: string = todayIso(),
): number {
  if (!progress.nextReviewDue || progress.nextReviewDue > today) return 0;

  const [dueYear, dueMonth, dueDay] = progress.nextReviewDue
    .split("-")
    .map(Number);
  const [year, month, day] = today.split("-").map(Number);
  const due = Date.UTC(dueYear, dueMonth - 1, dueDay);
  const now = Date.UTC(year, month - 1, day);

  return Math.round((now - due) / 86400000);
}

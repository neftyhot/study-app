/**
 * Building a study queue (PRD §4).
 *
 * The queue is an ordered list of card ids, computed once and then stored on
 * the session. Recomputing it on every render would reshuffle a shuffled deck
 * and reorder a "missed" deck as soon as the student graded a card — either
 * way losing their place mid-session.
 */
import { shuffle } from "@/lib/random";
import { isDue, todayIso } from "@/lib/srs";

export { shuffle };

export const STUDY_SCOPES = [
  "all",
  "topic",
  "starred",
  "missed",
  "due",
] as const;

export type StudyScope = (typeof STUDY_SCOPES)[number];

export type QueueFilter = {
  scope: StudyScope;
  topic?: string | null;
  shuffled?: boolean;
  /** Supplied so a shuffle is reproducible in tests; random otherwise. */
  seed?: number;
  /** Overridden in tests; today's date otherwise. */
  today?: string;
  /**
   * PRD §9 higher-order cards. Included unless explicitly switched off, since
   * a deck without them behaves exactly as it did before they existed.
   */
  includeApplication?: boolean;
  /**
   * Most cards to put in the session.
   *
   * A backlog is the normal state of an SRS deck, and handing someone four
   * hundred due cards is how a deck gets abandoned. Capping keeps the session
   * finishable; the rest stay due and come back tomorrow, longest-overdue
   * first, which is the order that matters.
   */
  limit?: number;
};

export type QueueCard = {
  id: string;
  topic: string | null;
  starred: boolean;
  excluded: boolean;
  lastGrade: "missed" | "difficult" | "easy" | null;
  /** Due date (YYYY-MM-DD) from the scheduler; null if never scheduled. */
  nextReviewDue: string | null;
  cardType: string;
};

export function filterCards<T extends QueueCard>(
  cards: readonly T[],
  filter: QueueFilter,
): T[] {
  // Cards the student marked as not testable stay out of every deck, and
  // application questions drop out when they have been switched off.
  const testable = cards.filter(
    (card) =>
      !card.excluded &&
      (filter.includeApplication !== false || card.cardType !== "application"),
  );

  switch (filter.scope) {
    case "topic":
      return testable.filter((card) => card.topic === filter.topic);
    case "starred":
      return testable.filter((card) => card.starred);
    case "missed":
      return testable.filter((card) => card.lastGrade === "missed");
    case "due":
      // Overdue is just due: a missed study day costs nothing (PRD §6).
      return testable.filter((card) => isDue(card, filter.today));
    case "all":
    default:
      return testable;
  }
}

/**
 * Structured order is whatever order the caller supplied (topic, then
 * creation), which keeps a concept's facets adjacent — the order they were
 * atomized in is the order they make sense in.
 */
export function buildQueue(
  cards: readonly QueueCard[],
  filter: QueueFilter,
): string[] {
  const selected = filterCards(cards, filter);

  // A review queue leads with the longest overdue, so a backlog is worked off
  // oldest first rather than in whatever order the deck happens to be in.
  const ordered = filter.shuffled
    ? shuffle(selected, filter.seed)
    : filter.scope === "due"
      ? [...selected].sort((a, b) =>
          (a.nextReviewDue ?? "").localeCompare(b.nextReviewDue ?? ""),
        )
      : selected;

  const ids = ordered.map((card) => card.id);
  return filter.limit && filter.limit > 0 ? ids.slice(0, filter.limit) : ids;
}

export { todayIso };

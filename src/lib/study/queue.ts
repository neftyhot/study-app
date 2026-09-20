/**
 * Building a study queue (PRD §4).
 *
 * The queue is an ordered list of card ids, computed once and then stored on
 * the session. Recomputing it on every render would reshuffle a shuffled deck
 * and reorder a "missed" deck as soon as the student graded a card — either
 * way losing their place mid-session.
 */
export const STUDY_SCOPES = ["all", "topic", "starred", "missed"] as const;

export type StudyScope = (typeof STUDY_SCOPES)[number];

export type QueueFilter = {
  scope: StudyScope;
  topic?: string | null;
  shuffled?: boolean;
  /** Supplied so a shuffle is reproducible in tests; random otherwise. */
  seed?: number;
};

export type QueueCard = {
  id: string;
  topic: string | null;
  starred: boolean;
  excluded: boolean;
  lastGrade: "missed" | "difficult" | "easy" | null;
};

export function filterCards<T extends QueueCard>(
  cards: readonly T[],
  filter: QueueFilter,
): T[] {
  // Cards the student marked as not testable stay out of every deck.
  const testable = cards.filter((card) => !card.excluded);

  switch (filter.scope) {
    case "topic":
      return testable.filter((card) => card.topic === filter.topic);
    case "starred":
      return testable.filter((card) => card.starred);
    case "missed":
      return testable.filter((card) => card.lastGrade === "missed");
    case "all":
    default:
      return testable;
  }
}

/** Deterministic PRNG so a seeded shuffle is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(items: readonly T[], seed?: number): T[] {
  const random = seed === undefined ? Math.random : mulberry32(seed);
  const result = [...items];

  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }

  return result;
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
  const ordered = filter.shuffled ? shuffle(selected, filter.seed) : selected;
  return ordered.map((card) => card.id);
}

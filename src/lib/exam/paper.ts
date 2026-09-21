/**
 * Building a practice paper (PRD §11).
 *
 * Two things make this an exam rather than another study session:
 *
 *  1. **The wording is not the flashcard's.** A student who has drilled a deck
 *     recognises its phrasing, and recognising a phrasing is not knowing the
 *     answer. Prompts are rewritten so the question has to be read.
 *  2. **Topics interleave.** Real papers do not do all the renal questions
 *     first, and a block of one topic lets a student coast on context.
 *
 * Selection and interleaving are pure and tested here; the rewriting needs a
 * model and lives in `rewrite.ts`, so a paper can still be built without one.
 */
import { shuffle } from "@/lib/random";

export type PaperCard = {
  id: string;
  topic: string | null;
  question: string;
  directAnswer: string;
  essentialPoints: string[];
  misconceptions: string[];
  cardType: string;
  /** Progress state, used to favour material that is not yet solid. */
  state: string | null;
  excluded: boolean;
};

export type PaperOptions = {
  questionCount: number;
  /** Empty means the whole deck. */
  topics?: string[];
  /** Share of questions that should be typed rather than multiple choice. */
  typedShare?: number;
  seed?: number;
};

export const DEFAULT_QUESTION_COUNT = 20;
export const DEFAULT_TYPED_SHARE = 0.4;

/**
 * Chooses what the paper asks about.
 *
 * Weighted towards what is not yet known, because a mock exam is worth most
 * where the gaps are — but never only that: a paper made entirely of weak
 * material measures morale, not readiness.
 */
export function selectCards(
  cards: PaperCard[],
  options: PaperOptions,
): PaperCard[] {
  const topics = options.topics ?? [];
  const pool = cards.filter(
    (card) =>
      !card.excluded && (topics.length === 0 || topics.includes(card.topic ?? "")),
  );

  if (pool.length === 0) return [];

  const shaky = pool.filter(
    (card) => card.state === null || card.state === "unstudied" || card.state === "recognition",
  );
  const solid = pool.filter((card) => !shaky.includes(card));

  const wanted = Math.min(options.questionCount, pool.length);
  const fromShaky = Math.min(shaky.length, Math.ceil(wanted * 0.7));

  const picked = [
    ...shuffle(shaky, options.seed).slice(0, fromShaky),
    ...shuffle(solid, options.seed).slice(0, wanted - fromShaky),
  ];

  // Short of solid material, top up from whatever is left.
  if (picked.length < wanted) {
    const chosen = new Set(picked.map((card) => card.id));
    picked.push(
      ...shuffle(pool, options.seed)
        .filter((card) => !chosen.has(card.id))
        .slice(0, wanted - picked.length),
    );
  }

  return picked;
}

/**
 * Orders the paper so no two neighbours share a topic where that is possible.
 *
 * A run of questions on one topic lets a student answer from the momentum of
 * the previous one rather than from memory.
 */
export function interleave<T extends { topic: string | null }>(
  items: T[],
  seed?: number,
): T[] {
  const byTopic = new Map<string, T[]>();
  for (const item of shuffle(items, seed)) {
    const key = item.topic ?? "";
    byTopic.set(key, [...(byTopic.get(key) ?? []), item]);
  }

  const queues = [...byTopic.values()].sort((a, b) => b.length - a.length);
  const ordered: T[] = [];
  let lastTopic: string | null = null;

  while (ordered.length < items.length) {
    // Take from the largest queue whose topic is not the one just used;
    // largest-first is what keeps a dominant topic from clumping at the end.
    const index = queues.findIndex(
      (queue) => queue.length > 0 && (queue[0].topic ?? "") !== lastTopic,
    );

    const from = index === -1 ? queues.findIndex((queue) => queue.length > 0) : index;
    if (from === -1) break;

    const next = queues[from].shift()!;
    ordered.push(next);
    lastTopic = next.topic ?? "";
    queues.sort((a, b) => b.length - a.length);
  }

  return ordered;
}

export type DraftQuestion = {
  card: PaperCard;
  format: "mcq" | "typed";
};

/**
 * Decides which questions are typed.
 *
 * Typed questions are given to the material that matters most — a card with a
 * real rubric can be marked on meaning, where one without it can only be
 * marked on recognition.
 */
export function assignFormats(
  cards: PaperCard[],
  typedShare = DEFAULT_TYPED_SHARE,
  seed?: number,
): DraftQuestion[] {
  const typedCount = Math.round(cards.length * typedShare);

  const ranked = [...cards].sort(
    (a, b) => b.essentialPoints.length - a.essentialPoints.length,
  );
  const typed = new Set(ranked.slice(0, typedCount).map((card) => card.id));

  return shuffle(cards, seed).map((card) => ({
    card,
    format: typed.has(card.id) ? ("typed" as const) : ("mcq" as const),
  }));
}

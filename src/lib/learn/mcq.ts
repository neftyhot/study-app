/**
 * Multiple-choice construction (PRD §8).
 *
 * Distractors come from the deck itself, so eliminating them requires knowing
 * the material rather than spotting the odd one out. Two sources, in order of
 * quality:
 *
 *  1. The card's own `commonMisconceptions` — generated in Phase 2 precisely
 *     as the plausible wrong answers for this fact (reversed directionality,
 *     synthesis vs. secretion). These are the best distractors we will ever
 *     have, because they were written to be tempting.
 *  2. Sibling cards' answers, same topic first, chosen to match the correct
 *     answer's length. Length matching removes the oldest test-taking tell
 *     there is: the longest option is the right one.
 */
import { shuffle } from "@/lib/random";

export type McqCard = {
  id: string;
  topic: string | null;
  question: string;
  directAnswer: string;
  misconceptions: string[];
};

export type McqOption = {
  text: string;
  correct: boolean;
  /** Shown after answering: why this option fails (PRD §8 debrief). */
  debrief: string;
};

export type McqOptions = {
  optionCount?: number;
  seed?: number;
};

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").replace(/[.,;:]+$/, "").trim();
}

export function buildMcq(
  card: McqCard,
  deck: readonly McqCard[],
  options: McqOptions = {},
): McqOption[] {
  const { optionCount = 4, seed } = options;
  const target = normalize(card.directAnswer);
  const taken = new Set([target]);

  const distractors: McqOption[] = [];

  const add = (text: string, debrief: string) => {
    const key = normalize(text);
    if (!key || taken.has(key)) return;
    taken.add(key);
    distractors.push({ text, correct: false, debrief });
  };

  for (const misconception of card.misconceptions) {
    add(
      misconception,
      "This is the mistake this card is designed to catch — check the direction and the mechanism.",
    );
  }

  const siblings = deck.filter((other) => other.id !== card.id);

  // Length gate first, topic second. An option three times the length of the
  // others is answerable without reading it, and that artifact costs more than
  // the extra plausibility of a same-topic distractor.
  const length = card.directAnswer.length;
  const plausible = siblings.filter((other) => {
    const ratio = other.directAnswer.length / Math.max(length, 1);
    return ratio >= 0.4 && ratio <= 2.5;
  });

  const byRelevance = (candidates: readonly McqCard[]) =>
    candidates.slice().sort((a, b) => {
      const sameTopic =
        Number(b.topic === card.topic) - Number(a.topic === card.topic);
      if (sameTopic !== 0) return sameTopic;
      return (
        Math.abs(a.directAnswer.length - length) -
        Math.abs(b.directAnswer.length - length)
      );
    });

  for (const sibling of byRelevance(plausible)) {
    if (distractors.length >= optionCount - 1) break;
    add(sibling.directAnswer, `That is the answer to "${sibling.question}"`);
  }

  // A question with three options is fine; a fourth that is obviously wrong on
  // sight is not. Only top up past the length gate to reach a usable minimum.
  const MIN_DISTRACTORS = 2;
  if (distractors.length < MIN_DISTRACTORS) {
    const rest = siblings.filter((other) => !plausible.includes(other));
    for (const sibling of byRelevance(rest)) {
      if (distractors.length >= MIN_DISTRACTORS) break;
      add(sibling.directAnswer, `That is the answer to "${sibling.question}"`);
    }
  }

  const chosen = distractors.slice(0, optionCount - 1);

  return shuffle(
    [
      {
        text: card.directAnswer,
        correct: true,
        debrief: "Correct.",
      },
      ...chosen,
    ],
    seed,
  );
}

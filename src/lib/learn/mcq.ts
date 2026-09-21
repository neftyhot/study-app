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

const FILLER = new Set(
  "a an the is are was were of in on by to for and or its it this that which with from into at as be been".split(" "),
);

/** Crude stem, enough that "synthesizes" matches "synthesized". */
function stem(word: string): string {
  const w = word.toLowerCase().replace(/[^a-z0-9]/g, "");
  return w.length > 5 ? w.slice(0, 5) : w;
}

/**
 * Removes the part of an option that just repeats the question.
 *
 * Asked "Which hormone does the pineal gland synthesize?", the option "The
 * pineal gland synthesizes melatonin" is the right one on sight: it is the
 * only option that echoes the question, and the distractors — answers to
 * other questions — never do. The answer is the part that is new:
 * "Melatonin". Every option gets the same treatment, so none is marked out
 * by being shorter either.
 *
 * Words are only trimmed from the ends, never the middle, and an option that
 * is nothing but echo is left alone rather than reduced to nothing.
 */
export function stripQuestionEcho(option: string, question: string): string {
  const questionStems = new Set(
    question.split(/[^A-Za-z0-9]+/).filter(Boolean).map(stem),
  );
  const echoes = (token: string) => {
    // A bracketed aside is part of the answer ("Leydig cells (interstitial
    // cells)"); trimming into it would leave half a bracket.
    if (/[()[\]]/.test(token)) return false;
    const key = stem(token);
    return !key || FILLER.has(key) || questionStems.has(key);
  };
  const content = (token: string) => {
    const key = stem(token);
    return Boolean(key) && !FILLER.has(key);
  };

  const words = option.trim().split(/\s+/);
  let start = 0;
  let end = words.length;

  // Leading echo, only if it includes a real word from the question.
  let i = 0;
  while (i < end && echoes(words[i])) i += 1;
  if (i < end && words.slice(0, i).some(content)) start = i;

  // Trailing echo, keeping at least two words of a longer option.
  const keep = words.length - start >= 3 ? 2 : 1;
  let j = end;
  while (j - start > keep && echoes(words[j - 1])) j -= 1;
  if (words.slice(j, end).some(content)) end = j;

  if (start === 0 && end === words.length) return option.trim();

  const trimmed = words
    .slice(start, end)
    .join(" ")
    .replace(/^[,;:–—-]\s*/, "")
    .replace(/\s*[,;:–—-]$/, "");
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

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
  const all = [
    { text: card.directAnswer, correct: true, debrief: "Correct." },
    ...chosen,
  ];

  // Strip every option's echo of the question. If trimming would make two
  // options read the same, keep them all as written instead: a duplicate is
  // a worse tell than an echo.
  const trimmed = all.map((option) => ({
    ...option,
    text: stripQuestionEcho(option.text, card.question),
  }));
  const distinct = new Set(trimmed.map((option) => normalize(option.text)));

  return shuffle(distinct.size === trimmed.length ? trimmed : all, seed);
}

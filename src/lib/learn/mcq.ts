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
import { mulberry32, shuffle } from "@/lib/random";

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

/**
 * Whether a trimmed option has lost what made it an answer.
 *
 * "DNA polymerase III" asked about as "the DNA polymerase that…" trims to
 * "III", which is no longer a name for anything. A numeral, a single letter or
 * a word too short to mean anything on its own is kept as written instead.
 */
export function isFragment(text: string): boolean {
  const words = text
    .replace(/\([^)]*\)/g, " ")
    .split(/[^A-Za-z0-9\u0370-\u03FF'-]+/)
    .filter(Boolean);
  const meaningful = words.filter(
    (word) =>
      !DESIGNATION.test(word) &&
      word.replace(/[^A-Za-z]/g, "").length >= 3 &&
      !FILLER.has(word.toLowerCase()),
  );
  return meaningful.length === 0;
}

/** A member's designation within a family: III, 2, B, β, gamma. */
const DESIGNATION =
  /^(?:I{1,3}|IV|VI{0,3}|IX|X|[1-9]|[A-Z]|[α-ω]|alpha|beta|gamma|delta|epsilon)$/i;

const FAMILIES: readonly (readonly string[])[] = [
  ["I", "II", "III", "IV", "V"],
  ["1", "2", "3", "4", "5"],
  ["α", "β", "γ", "δ", "ε"],
  ["alpha", "beta", "gamma", "delta", "epsilon"],
  ["A", "B", "C", "D", "E"],
];

/**
 * Other members of the correct answer's family: "DNA polymerase III" gives
 * "DNA polymerase I" and "DNA polymerase II".
 *
 * When the answer is one of a numbered set, the tempting mistake is a sibling
 * from that set, not an answer to some other question — and it reads as the
 * same kind of thing, so nothing marks the right one out.
 */
export function familyVariants(answer: string): string[] {
  const words = answer.trim().replace(/[.;]+$/, "").split(/\s+/);
  if (words.length < 2 || words.length > 6) return [];

  for (let index = words.length - 1; index >= 0; index -= 1) {
    const token = words[index].replace(/[,:]$/, "");
    // A bare capital or numeral opening the answer is more likely a word
    // ("I", "A") or a count ("3 ATP") than a designation.
    const greek = /^(?:[α-ω]|alpha|beta|gamma|delta|epsilon)$/i.test(token);
    if (index === 0 && !greek) continue;

    const family = FAMILIES.find((members) =>
      members.some((member) => member === token || (greek && member.toLowerCase() === token.toLowerCase())),
    );
    if (!family) continue;
    // "Type A" is a designation; "Vitamin A" is one too, but "in A" is not a
    // thing anyone names. Single capitals need a capitalized word before them.
    if (/^[A-E]$/.test(token) && !/^[A-Z]/.test(words[index - 1] ?? "")) continue;

    const current = family.findIndex(
      (member) => member.toLowerCase() === token.toLowerCase(),
    );
    const capital = /^[A-Z]/.test(token) && token.length > 1;
    const members = family
      .map((member, position) => ({ member, distance: Math.abs(position - current) }))
      .filter(({ distance }) => distance > 0)
      .sort((a, b) => a.distance - b.distance)
      .map(({ member }) =>
        capital ? member.charAt(0).toUpperCase() + member.slice(1) : member,
      );

    return members.map((member) =>
      [...words.slice(0, index), member + words[index].slice(token.length), ...words.slice(index + 1)].join(" "),
    );
  }
  return [];
}

/** Content stems of an answer, for ranking distractors by kinship. */
function contentStems(value: string): Set<string> {
  return new Set(
    value
      .split(/[^A-Za-z0-9]+/)
      .filter((word) => word.length >= 3 && !FILLER.has(word.toLowerCase()))
      .map(stem),
  );
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

  // Siblings of a numbered answer first, but only a couple: a question whose
  // every option is "DNA polymerase N" tests the numeral, not the concept.
  for (const variant of familyVariants(card.directAnswer).slice(0, 2)) {
    add(
      variant,
      "A different member of the same family — check which one does this particular job.",
    );
  }

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

  // Answers of the same kind first: "DNA polymerase I" from another card is a
  // far better distractor for "DNA polymerase III" than "Okazaki fragments".
  const kin = contentStems(card.directAnswer);
  const shared = (other: McqCard) =>
    [...contentStems(other.directAnswer)].filter((key) => kin.has(key)).length;

  const byRelevance = (candidates: readonly McqCard[]) =>
    candidates.slice().sort((a, b) => {
      const kinship = shared(b) - shared(a);
      if (kinship !== 0) return kinship;
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
  // a worse tell than an echo. An option that trimming reduces to a fragment
  // ("III") keeps its name; if that is the right answer, every option does,
  // so the whole names compete on equal terms.
  const stripped = all.map((option) =>
    stripQuestionEcho(option.text, card.question),
  );
  const lost = (index: number) =>
    stripped[index] !== all[index].text.trim() && isFragment(stripped[index]);
  const keepWhole = lost(0);
  const trimmed = all.map((option, index) => ({
    ...option,
    text: keepWhole || lost(index) ? option.text : stripped[index],
  }));
  const distinct = new Set(trimmed.map((option) => normalize(option.text)));

  const [correct, ...wrong] =
    distinct.size === trimmed.length ? trimmed : all;

  // The correct option's slot is drawn on its own rather than left to wherever
  // a shuffle happens to put it, so it is uniform by construction: every slot
  // equally likely, whatever the seed.
  const random = seed === undefined ? Math.random : mulberry32(seed);
  const ordered = shuffle(wrong, seed === undefined ? undefined : seed + 1);
  ordered.splice(Math.floor(random() * (wrong.length + 1)), 0, correct);
  return ordered;
}

/**
 * Moves the correct option to `slot`, keeping the others in their order.
 *
 * For a caller balancing positions over several questions (a practice paper,
 * via `dealPositions`); a single question needs nothing but `buildMcq`.
 */
export function placeCorrect(options: McqOption[], slot: number): McqOption[] {
  const correct = options.find((option) => option.correct);
  if (!correct) return options;

  const rest = options.filter((option) => option !== correct);
  rest.splice(Math.min(Math.max(0, slot), rest.length), 0, correct);
  return rest;
}

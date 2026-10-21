/**
 * Repeated cards: finding them, and keeping the one worth keeping.
 *
 * A deck repeats itself in two ways. The same question asked twice, sometimes
 * word for word, sometimes reworded. And the same fact asked twice where the
 * second card adds a detail: "When did the US enter WW1?" next to "When and
 * why did the US enter WW1?". Both waste a review; the second also means the
 * student answers the first card from memory of the second.
 *
 * The rule is coverage. A card is a repeat when another card asks about the
 * same thing and already says everything it says. The fuller card stays and
 * the covered one goes. Two cards that each say something the other does not
 * are both kept: they are different cards, even if they are about the same
 * event.
 */
import { eq, inArray } from "drizzle-orm";

import type { Db } from "@/db/client";
import { coverageMappings, diagramOcclusions, flashcards, studyProgress } from "@/db/schema";

/** Words that carry no fact: two questions sharing them share nothing. */
const STOPWORDS = new Set(
  (
    "a an the and or but nor of to in on at by for from with without into onto upon about " +
    "as is are was were be been being am do does did done has have had having " +
    "it its this that these those there their they them he she his her him we our you your i " +
    "what which who whom whose when where why how whether " +
    "not no yes so than then too very can could would should will shall may might must " +
    "also just only such each any all some most more many much other another " +
    "describe explain name list identify define state give briefly two three main key " +
    "one ones following called known term terms"
  ).split(" "),
);

/** Crude stemming: enough that "cause", "causes" and "caused" meet. */
function stem(word: string): string {
  if (word.length <= 4 || /^\d/.test(word)) return word;
  for (const suffix of ["ing", "ed", "es", "s"]) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 4) {
      return word.slice(0, -suffix.length);
    }
  }
  return word;
}

/** The fact-bearing words of a piece of text. */
export function contentWords(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[‘’']/g, "")
    .split(/[^a-z0-9]+/)
    .filter((word) => word && !STOPWORDS.has(word))
    .map(stem);
  return new Set(words);
}

export type RepeatCandidate = {
  id: string;
  question: string;
  directAnswer: string;
  /** Edited by hand: never removed, because it is the student's own work. */
  isUserEdited?: boolean;
  starred?: boolean;
  /** Has review history, which makes it the better one to keep on a tie. */
  studied?: boolean;
  /** May keep others but is never removed itself. */
  locked?: boolean;
};

type Profile = {
  card: RepeatCandidate;
  question: Set<string>;
  answer: Set<string>;
  all: Set<string>;
  exactKey: string;
};

function profile(card: RepeatCandidate): Profile {
  const question = contentWords(card.question);
  const answer = contentWords(card.directAnswer);
  const all = new Set([...question, ...answer]);
  return {
    card,
    question,
    answer,
    all,
    exactKey: card.question.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
  };
}

/**
 * Words that turn a question into its sibling. "How does an increase in cost
 * affect margin?" and "How does a decrease in price affect margin?" share most
 * words and even most of their answer, but they test opposite cases.
 */
const CONTRASTS = [
  ["increase", "decrease"],
  ["before", "after"],
  ["first", "final", "last"],
  ["easier", "accurate"],
  ["absorption", "variable"],
  ["fixed", "variable"],
  ["attachment", "enclosure"],
  ["salutation", "closing"],
  ["native", "immigrant"],
  ["exceed", "less", "fewer"],
  ["over", "under"],
  ["overapplied", "underapplied"],
  ["debit", "credit"],
  ["advantage", "disadvantage"],
  ["cause", "effect"],
  ["begin", "start", "end"],
  ["higher", "lower"],
  ["asset", "liability"],
  ["revenue", "expense"],
  ["import", "export"],
  ["union", "confederate"],
  ["allies", "central"],
].map((group) => group.map((word) => stem(word)));

/** Whether `other` asks about one side of a contrast the keeper asks the other side of. */
function opposite(keeper: Profile, other: Profile): boolean {
  return CONTRASTS.some((group) =>
    group.some(
      (word) =>
        other.question.has(word) &&
        !keeper.question.has(word) &&
        group.some((partner) => partner !== word && keeper.question.has(partner)),
    ),
  );
}

function shared(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const word of a) if (b.has(word)) count += 1;
  return count;
}

/** How much of `small` is also in `large`, 0–1. */
function containment(small: Set<string>, large: Set<string>): number {
  return small.size === 0 ? 0 : shared(small, large) / small.size;
}

/**
 * Whether `keeper` makes `other` redundant.
 *
 * Same question word for word always does. Otherwise two things must hold.
 * The other card's answer is in the keeper's answer: the answer is what a card
 * tests. And whatever the other card's question asks about appears somewhere
 * on the keeper. That second test is what keeps near twins apart: "What
 * follows the salutation?" and "What follows the closing?" share every word
 * but one, and the one is the whole question.
 *
 * One word of the question may be missing when the keeper's answer says more
 * than the other's: "Which amendment instituted national Prohibition?" next to
 * "Which amendment repealed Prohibition, and which had established it?".
 *
 * "Who killed Franz Ferdinand?" and "Where was Franz Ferdinand killed?" are
 * both kept: their questions nearly match but their answers do not. Nor is a
 * card covered by one asking the opposite case, whatever the answers share.
 */
function covers(keeper: Profile, other: Profile): boolean {
  if (keeper.exactKey && keeper.exactKey === other.exactKey) return true;

  // Too little to compare reliably: "What is TSH?" against "What is ACTH?".
  if (other.all.size < 4 || other.question.size < 2 || keeper.question.size < 2) {
    return false;
  }
  if (other.answer.size === 0) return false;
  if (containment(other.answer, keeper.answer) < 0.8) return false;
  if (opposite(keeper, other)) return false;
  // Most of what the other card asks must be what the keeper asks, not just
  // words its answer happens to use.
  if (containment(other.question, keeper.question) < 0.6) return false;

  const missing = other.question.size - shared(other.question, keeper.all);
  if (missing === 0) return true;

  const saysMore =
    keeper.answer.size > other.answer.size &&
    shared(keeper.answer, other.answer) < keeper.answer.size;
  return missing === 1 && other.question.size >= 4 && saysMore;
}

/** Better first: the card most worth keeping when two say the same thing. */
function rank(a: Profile, b: Profile): number {
  return (
    Number(Boolean(b.card.isUserEdited)) - Number(Boolean(a.card.isUserEdited)) ||
    b.all.size - a.all.size ||
    Number(Boolean(b.card.studied)) - Number(Boolean(a.card.studied)) ||
    Number(Boolean(b.card.starred)) - Number(Boolean(a.card.starred)) ||
    // Same content, so the tighter wording reads better.
    a.card.directAnswer.length - b.card.directAnswer.length
  );
}

export type RepeatGroup = {
  keep: RepeatCandidate;
  drop: RepeatCandidate[];
};

/**
 * Groups a deck's repeats under the card to keep.
 *
 * Greedy from the fullest card down, so a card is always measured against the
 * fullest card that could cover it. Cards the student edited are kept even
 * when covered; they can still be the keeper for others.
 */
export function findRepeats(cards: RepeatCandidate[]): RepeatGroup[] {
  const ordered = cards.map(profile).sort(rank);
  const kept: Profile[] = [];
  const groups = new Map<string, RepeatGroup>();

  for (const candidate of ordered) {
    const keeper =
      candidate.card.isUserEdited || candidate.card.locked
        ? undefined
      : kept.find((other) => covers(other, candidate));

    if (!keeper) {
      kept.push(candidate);
      continue;
    }

    const group = groups.get(keeper.card.id) ?? { keep: keeper.card, drop: [] };
    group.drop.push(candidate.card);
    groups.set(keeper.card.id, group);
  }

  return [...groups.values()];
}

export type RepeatCleanup = {
  removed: number;
  groups: { kept: string; removed: { question: string; directAnswer: string }[] }[];
  removedIds: string[];
};

export type RepeatOptions = {
  /**
   * Only these cards may be removed; the rest of the deck still counts as
   * cover. Generation passes the cards it just wrote, so a run never deletes
   * a card the student was already studying.
   */
  onlyRemove?: Set<string>;
};

/**
 * Removes a deck's repeated cards, keeping the fullest of each group.
 *
 * Nothing the student did is lost with them: a star on any card of the group
 * moves to the one kept, and when only a removed card has review history,
 * that history moves too, so the schedule carries on where it was.
 */
export function removeRepeats(
  db: Db,
  examId: string,
  options: RepeatOptions = {},
): RepeatCleanup {
  const rows = db
    .select({
      id: flashcards.id,
      question: flashcards.question,
      directAnswer: flashcards.directAnswer,
      isUserEdited: flashcards.isUserEdited,
      starred: flashcards.starred,
      excluded: flashcards.excluded,
      studied: studyProgress.id,
    })
    .from(flashcards)
    .leftJoin(studyProgress, eq(studyProgress.flashcardId, flashcards.id))
    .where(eq(flashcards.examId, examId))
    .all();

  // Diagram cards ask about a picture, so their words say little about what
  // they test; a card the student set aside is theirs to bring back.
  const diagrams = new Set(
    db
      .select({ id: diagramOcclusions.flashcardId })
      .from(diagramOcclusions)
      .innerJoin(flashcards, eq(flashcards.id, diagramOcclusions.flashcardId))
      .where(eq(flashcards.examId, examId))
      .all()
      .map((row) => row.id),
  );
  const candidates = rows
    .filter((row) => !diagrams.has(row.id) && !row.excluded)
    .map((row) => ({
      ...row,
      studied: row.studied !== null,
      locked: options.onlyRemove ? !options.onlyRemove.has(row.id) : false,
    }));

  const groups = findRepeats(candidates);
  if (groups.length === 0) return { removed: 0, groups: [], removedIds: [] };

  db.transaction((tx) => {
    for (const { keep, drop } of groups) {
      if (!keep.starred && drop.some((card) => card.starred)) {
        tx.update(flashcards)
          .set({ starred: true })
          .where(eq(flashcards.id, keep.id))
          .run();
      }

      const history = drop.find((card) => card.studied);
      if (!keep.studied && history) {
        tx.update(studyProgress)
          .set({ flashcardId: keep.id })
          .where(eq(studyProgress.flashcardId, history.id))
          .run();
      }

      // The objectives a dropped card answered are answered by the card that
      // covers it; without this the coverage matrix shows a gap that is not
      // there until coverage is checked again.
      const covered = new Set(
        tx
          .select({ objectiveId: coverageMappings.objectiveId })
          .from(coverageMappings)
          .where(eq(coverageMappings.flashcardId, keep.id))
          .all()
          .map((row) => row.objectiveId),
      );
      for (const mapping of tx
        .select()
        .from(coverageMappings)
        .where(inArray(coverageMappings.flashcardId, drop.map((card) => card.id)))
        .all()) {
        if (covered.has(mapping.objectiveId)) continue;
        covered.add(mapping.objectiveId);
        tx.update(coverageMappings)
          .set({ flashcardId: keep.id })
          .where(eq(coverageMappings.id, mapping.id))
          .run();
      }

      tx.delete(flashcards)
        .where(inArray(flashcards.id, drop.map((card) => card.id)))
        .run();
    }
  });

  const removedIds = groups.flatMap((group) => group.drop.map((card) => card.id));
  return {
    removed: removedIds.length,
    removedIds,
    groups: groups.map((group) => ({
      kept: group.keep.question,
      removed: group.drop.map(({ question, directAnswer }) => ({ question, directAnswer })),
    })),
  };
}

/**
 * Reading a set pasted in from Quizlet (or any list of term/definition pairs).
 *
 * Quizlet has no way to hand a set to another app, but its Export box gives
 * the set as text: one card after another, the two sides split by a separator
 * the student picks. This turns that text back into cards. Pure string work,
 * so the import box can show what it found while the student is still pasting.
 */

export type ImportedCard = { front: string; back: string };

export type ImportOptions = {
  /** Between the two sides of a card. Quizlet's default is a tab. */
  sideSeparator: string;
  /** Between one card and the next. Quizlet's default is a new line. */
  cardSeparator: string;
};

export const QUIZLET_DEFAULTS: ImportOptions = {
  sideSeparator: "\t",
  cardSeparator: "\n",
};

export type ImportResult = {
  cards: ImportedCard[];
  /** Pieces with only one side, which the student has to finish by hand. */
  incomplete: number;
};

export function parseImportedCards(
  text: string,
  options: ImportOptions = QUIZLET_DEFAULTS,
): ImportResult {
  const { sideSeparator, cardSeparator } = options;
  const normalized = text.replace(/\r\n?/g, "\n");
  if (!sideSeparator || !cardSeparator) return { cards: [], incomplete: 0 };

  const byLine = cardSeparator === "\n";
  const cards: ImportedCard[] = [];

  for (const piece of normalized.split(cardSeparator)) {
    if (!piece.trim()) continue;

    const at = piece.indexOf(sideSeparator);
    if (at === -1) {
      // A definition with a line break in it comes out of Quizlet as several
      // lines, and only the first has the separator: the rest belong to the
      // card above, not to new cards of their own.
      const previous = cards.at(-1);
      if (byLine && previous) {
        previous.back = previous.back
          ? `${previous.back}\n${piece.trim()}`
          : piece.trim();
      } else {
        cards.push({ front: piece.trim(), back: "" });
      }
      continue;
    }

    cards.push({
      front: piece.slice(0, at).trim(),
      back: piece.slice(at + sideSeparator.length).trim(),
    });
  }

  return {
    cards,
    incomplete: cards.filter((card) => !card.front || !card.back).length,
  };
}

/**
 * The separator a pasted set most likely uses between sides, so the common
 * cases need no settings at all: a tab if there is one, else " - " or a comma.
 */
export function guessSideSeparator(text: string): string {
  const lines = text.split(/\r\n?|\n/).filter((line) => line.trim());
  if (lines.length === 0) return "\t";
  for (const candidate of ["\t", " - ", ","]) {
    const hits = lines.filter((line) => line.includes(candidate)).length;
    if (hits >= Math.ceil(lines.length / 2)) return candidate;
  }
  return "\t";
}

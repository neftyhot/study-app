/**
 * Choosing which parts of a deck the tutor reads for one question.
 *
 * Sending a whole semester with every question made each answer slow — the
 * model reads all of it before it writes a word — and on a free Gemini key
 * two or three questions a minute used up the per-minute token allowance, so
 * the rest waited on retries. A question about the Krebs cycle needs the
 * Krebs cycle slides, the page on screen and anything the student names by
 * number, not the other four hundred pages.
 */

export type ContextUnit = {
  text: string;
  /** Always included: the page on screen, or a card or slide named by number. */
  pinned?: boolean;
};

const FILLER = new Set(
  "the and are was were for with from into that this which what when where why how does did has have had not but its can will would should could about there their them they you your yours explain tell mean means".split(" "),
);

function stems(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 3 && !FILLER.has(word))
      .map((word) => (word.length > 6 ? word.slice(0, 6) : word)),
  );
}

/**
 * Indexes of the units to include, in their original order.
 *
 * Everything, when everything fits. Otherwise the pinned units, then the rest
 * by how much of the question they share — rarer words counting for more, so
 * "gluconeogenesis" outweighs "cell" — until the budget is spent.
 */
export function selectUnits(
  units: readonly ContextUnit[],
  query: string,
  budget: number,
): number[] {
  const cost = (unit: ContextUnit) => unit.text.length + 2;
  const total = units.reduce((sum, unit) => sum + cost(unit), 0);
  if (total <= budget) return units.map((_, index) => index);

  const unitStems = units.map((unit) => stems(unit.text));
  const wanted = [...stems(query)];
  const weight = new Map(
    wanted.map((key) => {
      const frequency = unitStems.filter((set) => set.has(key)).length;
      return [key, frequency === 0 ? 0 : Math.log((units.length + 1) / frequency)];
    }),
  );
  const score = unitStems.map((set) =>
    wanted.reduce((sum, key) => sum + (set.has(key) ? (weight.get(key) ?? 0) : 0), 0),
  );

  const ranked = units
    .map((unit, index) => ({ index, pinned: Boolean(unit.pinned), score: score[index] }))
    .filter(({ pinned, score }) => pinned || score > 0)
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.score - a.score || a.index - b.index);

  const chosen: number[] = [];
  let used = 0;
  for (const { index, pinned } of ranked) {
    const size = cost(units[index]);
    if (used + size > budget && !(pinned && chosen.length === 0)) continue;
    chosen.push(index);
    used += size;
  }
  return chosen.sort((a, b) => a - b);
}

/** Flashcard numbers the student names: "flashcard 32", "card #7". */
export function namedCards(text: string): Set<number> {
  const numbers = new Set<number>();
  for (const match of text.matchAll(/\b(?:flash\s*)?cards?\s*(?:#|no\.?|number)?\s*(\d{1,4})\b/gi)) {
    numbers.add(Number(match[1]));
  }
  return numbers;
}

/** Slide or page numbers the student names: "slide 12", "page 4". */
export function namedSlides(text: string): Set<number> {
  const numbers = new Set<number>();
  for (const match of text.matchAll(/\b(?:slides?|pages?)\s*(?:#|no\.?|number)?\s*(\d{1,4})\b/gi)) {
    numbers.add(Number(match[1]));
  }
  return numbers;
}

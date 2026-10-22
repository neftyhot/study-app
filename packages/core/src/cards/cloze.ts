/**
 * Cloze deletion.
 *
 * A hand-written card where the thing being recalled is blanked out inside
 * the sentence it lives in: `ADH is released from the {{posterior pituitary}}`.
 * Context is the point — a term recalled inside its own sentence is recalled
 * the way it will be needed.
 *
 * Pure string work, shared by the builder's preview and by study, so what the
 * student sees while writing is what they see while answering.
 */

/**
 * A fresh matcher every time.
 *
 * A shared `/g` regex carries `lastIndex` between calls, so a `test()` here
 * silently made the next `matchAll` start halfway through the sentence and
 * drop the first deletion. Handing out a new one costs nothing and removes
 * the whole class of bug.
 */
export function clozePattern(): RegExp {
  return /\{\{([^{}]+)\}\}/g;
}

export type ClozeSpan = { text: string; hidden: boolean };

export function hasCloze(text: string): boolean {
  return clozePattern().test(text);
}

/** The sentence split into what is shown and what is hidden. */
export function parseCloze(text: string): ClozeSpan[] {
  const spans: ClozeSpan[] = [];
  let last = 0;

  for (const match of text.matchAll(clozePattern())) {
    const start = match.index ?? 0;
    if (start > last) spans.push({ text: text.slice(last, start), hidden: false });
    spans.push({ text: match[1], hidden: true });
    last = start + match[0].length;
  }

  if (last < text.length) spans.push({ text: text.slice(last), hidden: false });
  return spans;
}

/** What is hidden, in the order it appears. */
export function clozeAnswers(text: string): string[] {
  return parseCloze(text)
    .filter((span) => span.hidden)
    .map((span) => span.text.trim())
    .filter(Boolean);
}

/**
 * The question as the student first sees it.
 *
 * The blank is as long as a blank, not as long as the word: a five-character
 * gap tells you the answer has five characters, which is a free letter count
 * on every card.
 */
export const BLANK = "_____";

export function clozeQuestion(text: string): string {
  return parseCloze(text)
    .map((span) => (span.hidden ? BLANK : span.text))
    .join("");
}

/** The sentence with the blanks filled back in, for the reveal. */
export function clozeRevealed(text: string): string {
  return parseCloze(text)
    .map((span) => span.text)
    .join("");
}

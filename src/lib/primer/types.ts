/**
 * Shapes stored in the primer tables. Kept free of imports so the schema can
 * depend on it without pulling in the generator.
 */

/**
 * One sentence of a primer, with where it came from. The document index is the
 * slideshow's upload position (1 = first uploaded), matching the numbering the
 * flashcards use, so "Slideshow 2 · Slide 14" means the same thing everywhere.
 * Both source fields are null when the sentence is connective prose rather
 * than a claim from the slides.
 */
export interface CitedSentence {
  text: string;
  source_document_index: number | null;
  source_slide_number: number | null;
  source_excerpt: string | null;
  /**
   * A heading for this one line, in the formats that pair things up: the
   * question in a Q&A guide, the thing it is set against in a comparison.
   */
  label?: string;
}

/** "What this isn't": the near-miss a student is likely to confuse it with. */
export interface CounterExample {
  misconception: string;
  incorrectApplication: string;
  whyFlawed: string;
}

/** One line of working in a numeric example: what is found, how, and the value. */
export interface CalculationStep {
  /** What this step finds, e.g. "Gross profit". */
  label: string;
  /** The working with the numbers filled in, e.g. "$50,000 − $30,000". */
  expression: string;
  /** The value it comes to, with units, e.g. "$20,000". */
  result: string;
}

/**
 * An example written on request. Older guides stored plain strings; newer
 * ones carry the calculations behind any numbers so none of them are hidden.
 */
export type ExtraExample = string | { text: string; calculations: CalculationStep[] };

export function exampleView(example: ExtraExample): {
  text: string;
  calculations: CalculationStep[];
} {
  return typeof example === "string"
    ? { text: example, calculations: [] }
    : { text: example.text, calculations: example.calculations ?? [] };
}

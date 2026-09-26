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
}

/** "What this isn't": the near-miss a student is likely to confuse it with. */
export interface CounterExample {
  misconception: string;
  incorrectApplication: string;
  whyFlawed: string;
}

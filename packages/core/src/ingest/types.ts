/**
 * The format-neutral contract every extractor returns.
 *
 * Everything downstream of ingestion (card generation, provenance links,
 * the coverage matrix) depends on this shape rather than on PDF- or
 * PPTX-specific details, so adding a format later means adding one
 * extractor and nothing else.
 */

export type ExtractedTable = {
  /** Row-major cells. Ragged rows are padded by the extractor. */
  rows: string[][];
};

export type ExtractedUnit = {
  /**
   * 1-based slide/page number **as the student sees it in the original file**.
   * Every flashcard's provenance link resolves through this number, so it must
   * match the source document exactly — never a zero-based array position.
   */
  index: number;
  /** Slide title or first heading, when the format exposes one. */
  title: string | null;
  /** Body text, newline-separated, in reading order. */
  rawText: string;
  /** PPTX speaker notes. Null for formats that have no notes concept. */
  speakerNotes: string | null;
  tables: ExtractedTable[];
  /** Count of embedded images/drawings, used to set `has_diagram`. */
  imageCount: number;
};

export type ExtractionWarning = {
  /** Unit index the warning refers to, or null for file-level problems. */
  index: number | null;
  code: "unreadable_unit" | "no_units" | "parse_recovered";
  message: string;
};

export type ExtractionResult = {
  units: ExtractedUnit[];
  warnings: ExtractionWarning[];
};

/** Collapses whitespace and trims, preserving intentional line breaks. */
export function normalizeText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .filter((line, i, lines) => line !== "" || lines[i - 1] !== "")
    .join("\n")
    .trim();
}

/**
 * Classifies how usable a unit's extracted text is (PRD §3 legibility flags).
 * Image-heavy slides with no text are the common case worth surfacing: the
 * content is real but invisible to a text-only pipeline.
 */
export function classifyLegibility(
  unit: ExtractedUnit,
): "ok" | "empty" | "image_only" | "low_text" {
  const textLength = unit.rawText.length + (unit.title?.length ?? 0);
  const hasTables = unit.tables.length > 0;

  if (textLength === 0 && !hasTables) {
    return unit.imageCount > 0 ? "image_only" : "empty";
  }
  if (textLength < 25 && !hasTables && unit.imageCount > 0) {
    return "low_text";
  }
  return "ok";
}

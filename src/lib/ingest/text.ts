/**
 * Plain text and Markdown extraction (PRD §1).
 *
 * The chunking problem is the same one DOCX has: a wall of text with no
 * boundaries makes every card cite "section 1", which is the same as citing
 * nothing. Markdown gives real boundaries in its headings; plain text usually
 * does not, so blank lines are used as paragraph breaks and paragraphs are
 * grouped into sections of a readable size.
 */
import {
  classifyLegibility,
  normalizeText,
  type ExtractedUnit,
  type ExtractionResult,
  type ExtractionWarning,
} from "./types";

/** Paragraphs per section when the text has no headings of its own. */
export const PARAGRAPHS_PER_SECTION = 12;

/** ATX (`## Heading`) and Setext (`Heading\n-----`) both count. */
const ATX = /^(#{1,6})\s+(.*)$/;
const SETEXT = /^(=+|-{2,})\s*$/;

type Block = { heading: string | null; level: number; lines: string[] };

export function splitMarkdown(content: string): Block[] {
  const lines = normalizeText(content).split("\n");
  const blocks: Block[] = [];
  let current: Block = { heading: null, level: 0, lines: [] };

  const push = () => {
    if (current.heading !== null || current.lines.some((line) => line.trim())) {
      blocks.push(current);
    }
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const atx = line.match(ATX);

    if (atx) {
      push();
      current = { heading: atx[2].trim(), level: atx[1].length, lines: [] };
      continue;
    }

    // A Setext underline makes a heading of the line above it, so the heading
    // is this line — not something already pushed into the current block.
    const underline = lines[i + 1] ?? "";
    if (line.trim() && SETEXT.test(underline)) {
      push();
      current = {
        heading: line.trim(),
        level: underline.startsWith("=") ? 1 : 2,
        lines: [],
      };
      i += 1;
      continue;
    }

    current.lines.push(line.trim());
  }

  push();
  return blocks;
}

function toUnits(blocks: Block[], hasHeadings: boolean): ExtractedUnit[] {
  const units: ExtractedUnit[] = [];

  const add = (heading: string | null, lines: string[]) => {
    const rawText = normalizeText(lines.join("\n"));
    if (!rawText && !heading) return;
    units.push({
      index: units.length + 1,
      title: heading,
      rawText,
      speakerNotes: null,
      tables: [],
      imageCount: 0,
    });
  };

  for (const block of blocks) {
    if (hasHeadings) {
      add(block.heading, block.lines);
      continue;
    }

    // No headings: group paragraphs so sections stay findable.
    const paragraphs = block.lines
      .join("\n")
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean);

    for (let i = 0; i < paragraphs.length; i += PARAGRAPHS_PER_SECTION) {
      add(null, paragraphs.slice(i, i + PARAGRAPHS_PER_SECTION));
    }
  }

  return units;
}

function finish(units: ExtractedUnit[]): ExtractionResult {
  const warnings: ExtractionWarning[] = [];

  if (units.length === 0) {
    warnings.push({
      index: null,
      code: "no_units",
      message: "No readable text was found.",
    });
  }

  for (const unit of units) {
    if (classifyLegibility(unit) === "empty") {
      warnings.push({
        index: unit.index,
        code: "unreadable_unit",
        message: `Section ${unit.index} has no extractable text.`,
      });
    }
  }

  return { units, warnings };
}

export function extractPlainText(content: string): ExtractionResult {
  const blocks = splitMarkdown(content);
  const hasHeadings = blocks.some((block) => block.heading !== null);
  return finish(toUnits(blocks, hasHeadings));
}

export async function extractText(buffer: Buffer): Promise<ExtractionResult> {
  return extractPlainText(buffer.toString("utf8"));
}

/**
 * DOCX extraction (PRD §1).
 *
 * Word documents have no pages until they are laid out, so the unit of
 * provenance has to be something the student can actually find again. A
 * heading is that: "Section 3, ADH" is a place in the document, where "page 7"
 * depends on the reader's font size. Sections are therefore split at H1/H2 and
 * at explicit page breaks, and a card's excerpt lands in the section whose
 * heading it sits under.
 *
 * `mammoth` handles the OOXML; this module decides where one section ends and
 * the next begins.
 */
import mammoth from "mammoth";

import {
  classifyLegibility,
  normalizeText,
  type ExtractedTable,
  type ExtractedUnit,
  type ExtractionResult,
  type ExtractionWarning,
} from "./types";

/** Headings at or above this level start a new section. */
const SPLIT_LEVEL = 2;

/**
 * Paragraphs per section when a document has no headings at all.
 *
 * Plenty of real study guides are one long unstructured file. Emitting them as
 * a single unit would make every card cite "section 1", which is the same as
 * citing nothing.
 */
const PARAGRAPHS_PER_SECTION = 15;

/** Word page breaks are invisible to mammoth unless they are mapped to something. */
const STYLE_MAP = ["br[type='page'] => hr"];

const BLOCK =
  /<(h[1-6]|p|ul|ol|table|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi;

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "text"; text: string }
  | { kind: "table"; table: ExtractedTable }
  | { kind: "break" };

function decode(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCharCode(Number(code)),
    )
    .replace(/&amp;/g, "&");
}

function stripTags(html: string): string {
  return decode(
    html
      // List items and line breaks are real line boundaries, not spaces.
      .replace(/<\/li>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function parseTable(inner: string): ExtractedTable {
  const rows = [...inner.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) =>
    [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) =>
      stripTags(cell[1]).replace(/\n+/g, " ").trim(),
    ),
  );

  // The shared contract says extractors pad ragged rows.
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  return {
    rows: rows.map((row) => [
      ...row,
      ...Array(Math.max(0, width - row.length)).fill(""),
    ]),
  };
}

export function parseBlocks(html: string): Block[] {
  const blocks: Block[] = [];

  for (const match of html.matchAll(BLOCK)) {
    const tag = match[1].toLowerCase();
    const inner = match[2];

    if (tag === "table") {
      const table = parseTable(inner);
      if (table.rows.length > 0) blocks.push({ kind: "table", table });
      continue;
    }

    // mammoth emits a mapped page break as an <hr/> inside its paragraph.
    if (/<hr\s*\/?>/i.test(inner) && stripTags(inner) === "") {
      blocks.push({ kind: "break" });
      continue;
    }

    const text = stripTags(inner);
    if (!text) continue;

    if (/^h[1-6]$/.test(tag)) {
      blocks.push({ kind: "heading", level: Number(tag[1]), text });
    } else {
      blocks.push({ kind: "text", text });
    }
  }

  return blocks;
}

type Draft = {
  title: string | null;
  lines: string[];
  tables: ExtractedTable[];
};

function emptyDraft(title: string | null = null): Draft {
  return { title, lines: [], tables: [] };
}

function isEmpty(draft: Draft): boolean {
  return (
    draft.title === null && draft.lines.length === 0 && draft.tables.length === 0
  );
}

/**
 * Groups blocks into sections.
 *
 * Headings win when the document has them. Otherwise paragraphs are chunked,
 * because one enormous unit is not provenance.
 */
export function sectionize(blocks: Block[], imageCount = 0): ExtractedUnit[] {
  const hasHeadings = blocks.some(
    (block) => block.kind === "heading" && block.level <= SPLIT_LEVEL,
  );

  const drafts: Draft[] = [];
  let current = emptyDraft();
  let paragraphs = 0;

  const flush = () => {
    if (!isEmpty(current)) drafts.push(current);
    current = emptyDraft();
    paragraphs = 0;
  };

  for (const block of blocks) {
    switch (block.kind) {
      case "break":
        flush();
        break;

      case "heading":
        if (hasHeadings && block.level <= SPLIT_LEVEL) {
          flush();
          current.title = block.text;
        } else {
          // A deeper heading is part of the section it introduces.
          current.lines.push(block.text);
        }
        break;

      case "table":
        current.tables.push(block.table);
        break;

      case "text":
        current.lines.push(block.text);
        paragraphs += 1;
        if (!hasHeadings && paragraphs >= PARAGRAPHS_PER_SECTION) flush();
        break;
    }
  }

  flush();

  return drafts.map((draft, i) => ({
    index: i + 1,
    // A section with no heading has no title. The PDF extractor promotes a
    // short first line, but there a title is a separate visual element; here
    // the first line is just as likely to be the first bullet, and quietly
    // moving it out of the body would break any excerpt that quoted it.
    title: draft.title,
    rawText: normalizeText(draft.lines.join("\n")),
    speakerNotes: null,
    tables: draft.tables,
    // Images are counted for the file, not per section: mammoth gives no
    // reliable position for them once converted.
    imageCount: i === 0 ? imageCount : 0,
  }));
}

export async function extractDocx(buffer: Buffer): Promise<ExtractionResult> {
  const warnings: ExtractionWarning[] = [];

  const { value: html, messages } = await mammoth.convertToHtml(
    { buffer },
    { styleMap: STYLE_MAP },
  );

  for (const message of messages) {
    if (message.type === "error") {
      warnings.push({
        index: null,
        code: "parse_recovered",
        message: message.message,
      });
    }
  }

  const imageCount = (html.match(/<img\b/gi) ?? []).length;
  const units = sectionize(parseBlocks(html), imageCount);

  if (units.length === 0) {
    warnings.push({
      index: null,
      code: "no_units",
      message: "No readable text was found in this document.",
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

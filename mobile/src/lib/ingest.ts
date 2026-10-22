/**
 * "Make a deck" from a file: the same extractors the desktop uses (shared in
 * packages/core/src/ingest), picked by file type. The heavy readers (PDF and
 * Word) load only when a file of that kind is opened.
 *
 * A file comes back as one of three things: cards already (a Quizlet export
 * or a two-column sheet), text for the AI to make cards from, or a PDF with
 * no text in it (a scan), which only a model that reads files can use.
 */
import { guessSideSeparator, parseImportedCards, type ImportedCard } from "@megan/core/cards/import";
import { parseCsv } from "@megan/core/ingest/csv";
import { classifyLegibility, type ExtractionResult } from "@megan/core/ingest/types";
import type { PickedFile } from "@megan/core/platform/types";

export type FileKind = "pdf" | "pptx" | "docx" | "text" | "rtf" | "csv";

export type Ingested =
  | { kind: "cards"; cards: ImportedCard[] }
  | { kind: "text"; result: ExtractionResult; unitName: string }
  | { kind: "scanned-pdf"; pages: number };

/** What the Files picker offers. Extensions and MIME types both, for iOS. */
export const MAKE_ACCEPT = [
  ".pdf",
  ".pptx",
  ".docx",
  ".txt",
  ".md",
  ".rtf",
  ".csv",
  ".tsv",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/tab-separated-values",
  "application/rtf",
];

const BY_EXTENSION: Record<string, FileKind> = {
  pdf: "pdf",
  pptx: "pptx",
  docx: "docx",
  txt: "text",
  md: "text",
  markdown: "text",
  rtf: "rtf",
  csv: "csv",
  tsv: "csv",
};

const OLD_FORMATS: Record<string, string> = {
  doc: "This is an old Word file (.doc). Open it in Word or Pages and save it as .docx, then try again.",
  ppt: "This is an old PowerPoint file (.ppt). Open it in PowerPoint or Keynote and save it as .pptx, then try again.",
  pages: "Pages files can't be read here. In Pages, choose Export To → Word, then pick the .docx.",
  key: "Keynote files can't be read here. In Keynote, choose Export To → PowerPoint, then pick the .pptx.",
};

export class UnsupportedFileError extends Error {}

export function fileKind(name: string, type: string | null): FileKind {
  const extension = name.toLowerCase().split(".").pop() ?? "";
  if (OLD_FORMATS[extension]) throw new UnsupportedFileError(OLD_FORMATS[extension]);
  const kind = BY_EXTENSION[extension];
  if (kind) return kind;
  if (type === "application/pdf") return "pdf";
  if (type?.startsWith("text/")) return "text";
  throw new UnsupportedFileError("That kind of file can't be read. Try a PDF, PowerPoint, Word, text or CSV file.");
}

/**
 * Rows that are already cards: most rows have exactly two filled cells.
 * A wider table (hormone / origin / action) is material, not cards.
 */
export function rowsAsCards(rows: string[][]): ImportedCard[] | null {
  const filled = rows.map((row) => row.map((cell) => cell.trim())).filter((row) => row.some(Boolean));
  if (filled.length === 0) return null;
  const pairs = filled.filter((row) => row.filter(Boolean).length === 2 && row.slice(2).every((cell) => !cell));
  if (pairs.length < Math.ceil(filled.length * 0.8)) return null;
  return pairs.map(([front, back]) => ({ front, back }));
}

/** A text file that is a Quizlet or Anki export: one tab-separated card per line. */
export function textAsCards(text: string): ImportedCard[] | null {
  if (guessSideSeparator(text) !== "\t" || !text.includes("\t")) return null;
  const { cards, incomplete } = parseImportedCards(text, { sideSeparator: "\t", cardSeparator: "\n" });
  if (cards.length === 0 || incomplete > cards.length / 5) return null;
  return cards.filter((card) => card.front && card.back);
}

export async function readMaterial(file: PickedFile): Promise<Ingested> {
  const kind = fileKind(file.name, file.type);
  switch (kind) {
    case "pdf": {
      const { extractPdf } = await import("@megan/core/ingest/pdf");
      const result = await extractPdf(file.bytes);
      if (result.units.length > 0 && result.units.every((unit) => classifyLegibility(unit) !== "ok")) {
        return { kind: "scanned-pdf", pages: result.units.length };
      }
      return { kind: "text", result, unitName: "Page" };
    }
    case "pptx": {
      const { extractPptx } = await import("@megan/core/ingest/pptx");
      return { kind: "text", result: await extractPptx(file.bytes), unitName: "Slide" };
    }
    case "docx": {
      const [{ default: mammoth }, { STYLE_MAP, docxHtmlToResult }, { loadZipWithinLimits }] = await Promise.all([
        import("mammoth/mammoth.browser.min.js"),
        import("@megan/core/ingest/docx"),
        import("@megan/core/ingest/zip-limits"),
      ]);
      // mammoth unpacks the whole archive itself, so its size is checked first.
      await loadZipWithinLimits(file.bytes);
      const arrayBuffer = file.bytes.slice().buffer;
      const { value: html, messages } = await mammoth.convertToHtml({ arrayBuffer }, { styleMap: STYLE_MAP });
      const errors = messages.filter((message) => message.type === "error").map((message) => message.message);
      return { kind: "text", result: docxHtmlToResult(html, errors), unitName: "Section" };
    }
    case "rtf": {
      const { extractRtf } = await import("@megan/core/ingest/rtf");
      return { kind: "text", result: await extractRtf(file.bytes), unitName: "Section" };
    }
    case "csv": {
      const content = new TextDecoder().decode(file.bytes);
      const cards = rowsAsCards(parseTable(file.name, content));
      if (cards) return { kind: "cards", cards };
      const { extractCsvText } = await import("@megan/core/ingest/csv");
      return { kind: "text", result: extractCsvText(content), unitName: "Section" };
    }
    case "text": {
      const content = new TextDecoder().decode(file.bytes);
      const cards = textAsCards(content);
      if (cards) return { kind: "cards", cards };
      const { extractPlainText } = await import("@megan/core/ingest/text");
      return { kind: "text", result: extractPlainText(content), unitName: "Section" };
    }
  }
}

/** A .tsv is a CSV with tabs; parseCsv reads commas, so tabs are split here. */
function parseTable(name: string, content: string): string[][] {
  if (name.toLowerCase().endsWith(".tsv")) {
    return content
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => line.split("\t"));
  }
  return parseCsv(content);
}

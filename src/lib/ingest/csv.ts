/**
 * CSV extraction (PRD §1).
 *
 * A CSV in a study folder is usually one of two things: a table of facts
 * (hormone / origin / action) or an outline exported from something else.
 * Both are preserved as rows and columns rather than flattened into prose,
 * because the column a value sits in is most of its meaning — and because a
 * card quoting "Hypothalamus" needs the header row to say what that answers.
 *
 * Rows are grouped into sections so a long file still yields findable
 * provenance rather than one enormous unit.
 */
import {
  classifyLegibility,
  normalizeText,
  type ExtractedUnit,
  type ExtractionResult,
  type ExtractionWarning,
} from "./types";

/** Data rows per section, header repeated in each. */
export const ROWS_PER_SECTION = 25;

/**
 * Parses CSV including quoted fields, escaped quotes, and newlines inside
 * quotes — all of which appear the moment a lecture table is exported.
 */
export function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  const endField = () => {
    row.push(field.trim());
    field = "";
  };
  const endRow = () => {
    endField();
    if (row.some((cell) => cell !== "")) rows.push(row);
    row = [];
  };

  const text = content.replace(/\r\n?/g, "\n");

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === ",") endField();
    else if (char === "\n") endRow();
    else field += char;
  }

  endRow();
  return rows;
}

/**
 * True when the first row looks like labels rather than data.
 *
 * Deliberately conservative: treating a data row as a header loses a row of
 * the student's material, which is worse than showing an unlabelled table.
 */
export function looksLikeHeader(rows: string[][]): boolean {
  if (rows.length < 2) return false;

  const [first, ...rest] = rows;
  const numeric = (cell: string) => cell !== "" && !Number.isNaN(Number(cell));

  // A row containing a number is data, not a label.
  if (first.some((cell) => cell === "" || numeric(cell))) return false;

  const unique = new Set(first.map((cell) => cell.toLowerCase())).size;
  return rest.some((row) => row.some(numeric)) || unique === first.length;
}

export function extractCsvText(content: string): ExtractionResult {
  const rows = parseCsv(content);
  const warnings: ExtractionWarning[] = [];

  if (rows.length === 0) {
    return {
      units: [],
      warnings: [
        { index: null, code: "no_units", message: "This CSV file is empty." },
      ],
    };
  }

  const hasHeader = looksLikeHeader(rows);
  const header = hasHeader ? rows[0] : null;
  const body = hasHeader ? rows.slice(1) : rows;
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const pad = (row: string[]) => [
    ...row,
    ...Array(Math.max(0, width - row.length)).fill(""),
  ];

  const units: ExtractedUnit[] = [];

  for (let i = 0; i < body.length; i += ROWS_PER_SECTION) {
    const slice = body.slice(i, i + ROWS_PER_SECTION);
    const tableRows = header ? [pad(header), ...slice.map(pad)] : slice.map(pad);

    // The rows are also written out as text so an excerpt can quote a row:
    // provenance checks match against text, not against table structure.
    const rawText = normalizeText(
      slice
        .map((row) =>
          header
            ? row
                .map((cell, c) => (header[c] ? `${header[c]}: ${cell}` : cell))
                .filter(Boolean)
                .join(" | ")
            : row.join(" | "),
        )
        .join("\n"),
    );

    units.push({
      index: units.length + 1,
      title:
        body.length > ROWS_PER_SECTION
          ? `Rows ${i + 1}–${Math.min(i + ROWS_PER_SECTION, body.length)}`
          : null,
      rawText,
      speakerNotes: null,
      tables: [{ rows: tableRows }],
      imageCount: 0,
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

export async function extractCsv(buffer: Buffer): Promise<ExtractionResult> {
  return extractCsvText(buffer.toString("utf8"));
}

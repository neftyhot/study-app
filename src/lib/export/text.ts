/**
 * The three text export targets: CSV, Quizlet paste, and RemNote markdown.
 *
 * Each one is pure: a deck in, a string out. That keeps them unit-testable and
 * keeps the interesting part — what a target can and cannot represent —
 * visible in one place instead of spread through a route handler.
 */
import type { DeckExport, ExportCard } from "./cards";

/* ------------------------------------------------------------------- CSV */

export const CSV_COLUMNS = [
  "Topic",
  "Question",
  "Answer",
  "Explanation",
  "Rubric",
  "Professor_Emphasis",
  "Source_Slide",
] as const;

/**
 * RFC 4180 §2: quote a field that contains a comma, a quote or a line break,
 * and escape an embedded quote by doubling it. Records end with CRLF.
 */
export function csvField(value: string): string {
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function rubricText(card: ExportCard): string {
  const parts: string[] = [];
  if (card.essentialPoints.length > 0) {
    parts.push(`Essential: ${card.essentialPoints.join("; ")}`);
  }
  if (card.optionalPoints.length > 0) {
    parts.push(`Optional: ${card.optionalPoints.join("; ")}`);
  }
  if (card.commonMisconceptions.length > 0) {
    parts.push(`Misconceptions: ${card.commonMisconceptions.join("; ")}`);
  }
  return parts.join("\n");
}

export function toCsv(deck: DeckExport): string {
  const rows = [
    CSV_COLUMNS.join(","),
    ...deck.cards.map((card) =>
      [
        card.topic,
        card.question,
        card.directAnswer,
        card.fullExplanation,
        rubricText(card),
        card.professorEmphasis ? "yes" : "no",
        card.sourceLabel,
      ]
        .map(csvField)
        .join(","),
    ),
  ];

  // A trailing CRLF: the final record is terminated like every other one.
  return `${rows.join("\r\n")}\r\n`;
}

/* --------------------------------------------------------------- Quizlet */

export type QuizletOptions = {
  /** Between a term and its definition. */
  termSeparator?: "tab" | "semicolon";
  /** Between one card and the next. */
  rowSeparator?: "newline" | "blank-line";
  /** Quizlet shows one definition; the rubric is usually noise there. */
  includeExplanation?: boolean;
};

const TERM_SEPARATORS = { tab: "\t", semicolon: ";" } as const;
const ROW_SEPARATORS = { newline: "\n", "blank-line": "\n\n" } as const;

/**
 * Quizlet splits on the chosen characters, so a term containing one silently
 * tears the card in half on import. Rather than emit something that looks
 * right and imports wrong, collapse the separators out of the content first.
 */
function flatten(value: string, separator: string): string {
  let text = value.replace(/\s*\n+\s*/g, " · ").replace(/\t/g, " ");
  if (separator === ";") text = text.replace(/;/g, ",");
  return text.trim();
}

export function toQuizlet(
  deck: DeckExport,
  options: QuizletOptions = {},
): string {
  const term = TERM_SEPARATORS[options.termSeparator ?? "tab"];
  const row = ROW_SEPARATORS[options.rowSeparator ?? "newline"];

  return deck.cards
    .map((card) => {
      const definition = options.includeExplanation
        ? [card.directAnswer, card.fullExplanation].filter(Boolean).join(" — ")
        : card.directAnswer;

      return `${flatten(card.question, term)}${term}${flatten(definition, term)}`;
    })
    .join(row);
}

/* --------------------------------------------------------------- RemNote */

/**
 * RemNote reads `::` as a one-line card and `:::` as one whose answer is its
 * children, so a card with a rubric or a citation becomes the second form and
 * keeps its detail instead of being flattened into the answer line.
 */
export function toRemNote(deck: DeckExport): string {
  const lines: string[] = [`# ${deck.title}`, ""];
  let currentTopic: string | null = null;

  for (const card of deck.cards) {
    if (card.topic !== currentTopic) {
      // A blank line before the heading, so the previous topic's children end.
      if (currentTopic !== null) lines.push("");
      currentTopic = card.topic;
      lines.push(`## ${card.topic}`, "");
    }

    const children: string[] = [];
    if (card.fullExplanation) children.push(card.fullExplanation);
    for (const point of card.essentialPoints) children.push(`**Must say:** ${point}`);
    for (const point of card.optionalPoints) children.push(`_Also:_ ${point}`);
    for (const point of card.commonMisconceptions) {
      children.push(`⚠️ Not: ${point}`);
    }
    if (card.sourceLabel) children.push(`Source: ${card.sourceLabel}`);

    const question = card.question.replace(/\s*\n+\s*/g, " ");
    const emphasis = card.professorEmphasis ? " ⭐" : "";

    if (children.length === 0) {
      lines.push(`- ${question}${emphasis} :: ${oneLine(card.directAnswer)}`);
    } else {
      lines.push(`- ${question}${emphasis} ::: ${oneLine(card.directAnswer)}`);
      for (const child of children) {
        lines.push(`    - ${oneLine(child)}`);
      }
    }
  }

  lines.push("");
  return lines.join("\n");
}

/** Hierarchy in RemNote is indentation, so an answer must not break the line. */
function oneLine(value: string): string {
  return value.replace(/\s*\n+\s*/g, " ").trim();
}

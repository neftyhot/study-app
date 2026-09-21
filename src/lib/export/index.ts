import "server-only";

/**
 * Deck export targets (PRD §15).
 *
 * The JSON backup stays what it always was — everything, so nothing is
 * trapped here. These four targets are the opposite trade: each drops what
 * its destination cannot hold, and says so in the UI rather than silently.
 */
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";

import type { Db } from "@/db/client";
import { absolutePathFor } from "@/lib/ingest/storage";

import { buildApkg, type ApkgMedia } from "./anki";
import { collectDeckCards, type CollectOptions, type DeckExport } from "./cards";
import { toCsv, toQuizlet, toRemNote, type QuizletOptions } from "./text";

export * from "./cards";
export * from "./text";
export { buildApkg } from "./anki";

export const EXPORT_FORMATS = ["anki", "quizlet", "remnote", "csv"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export function isExportFormat(value: unknown): value is ExportFormat {
  return (
    typeof value === "string" &&
    (EXPORT_FORMATS as readonly string[]).includes(value)
  );
}

const EXTENSIONS: Record<ExportFormat, string> = {
  anki: "apkg",
  quizlet: "txt",
  remnote: "md",
  csv: "csv",
};

const CONTENT_TYPES: Record<ExportFormat, string> = {
  anki: "application/zip",
  quizlet: "text/plain; charset=utf-8",
  remnote: "text/markdown; charset=utf-8",
  csv: "text/csv; charset=utf-8",
};

export function exportFilename(
  title: string,
  format: ExportFormat,
  date = new Date(),
): string {
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "deck";

  return `${slug}-${date.toISOString().slice(0, 10)}.${EXTENSIONS[format]}`;
}

/**
 * Reads the slide images a deck's cards point at.
 *
 * A missing file is skipped rather than fatal: an export that loses a picture
 * is still an export, and refusing to produce one over a moved file would be
 * the worse outcome.
 */
async function loadMedia(deck: DeckExport): Promise<Map<string, ApkgMedia>> {
  const media = new Map<string, ApkgMedia>();
  // Read each file once, however many cards cite it. `null` records a file
  // that could not be read, so it is not retried for every card.
  const byPath = new Map<string, ApkgMedia | null>();

  for (const card of deck.cards) {
    if (!card.imagePath) continue;

    if (!byPath.has(card.imagePath)) {
      try {
        const data = await readFile(absolutePathFor(card.imagePath));
        const ext = extname(card.imagePath) || ".png";
        byPath.set(card.imagePath, {
          name: `study-app-${basename(card.imagePath, ext)}${ext}`,
          data,
        });
      } catch {
        byPath.set(card.imagePath, null);
      }
    }

    const attachment = byPath.get(card.imagePath);
    if (attachment) media.set(card.id, attachment);
  }

  return media;
}

export type ExportResult = {
  body: Buffer | string;
  contentType: string;
  filename: string;
  cardCount: number;
};

export type BuildOptions = CollectOptions & {
  quizlet?: QuizletOptions;
};

export async function buildDeckExport(
  db: Db,
  examId: string,
  format: ExportFormat,
  options: BuildOptions = {},
): Promise<ExportResult | undefined> {
  const deck = collectDeckCards(db, examId, options);
  if (!deck) return undefined;

  const base = {
    contentType: CONTENT_TYPES[format],
    filename: exportFilename(deck.title, format),
    cardCount: deck.cards.length,
  };

  switch (format) {
    case "anki":
      return { ...base, body: await buildApkg(deck, { media: await loadMedia(deck) }) };
    case "quizlet":
      return { ...base, body: toQuizlet(deck, options.quizlet) };
    case "remnote":
      return { ...base, body: toRemNote(deck) };
    case "csv":
      return { ...base, body: toCsv(deck) };
  }
}

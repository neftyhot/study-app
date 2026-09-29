import "server-only";

import { and, asc, eq, ne } from "drizzle-orm";

import { db } from "@/db";
import { flashcards, sourceFiles, sourceSlides } from "@/db/schema";
import { chronologicalCardOrder } from "@/lib/order";

import { namedCards, namedSlides, selectUnits } from "./select";

/**
 * How much of the deck the tutor reads per question, in characters.
 *
 * A whole semester fits in one request, but reading it made every answer take
 * the better part of a minute and spent a free Gemini key's per-minute token
 * allowance in two or three questions. A deck that fits is sent whole; a
 * bigger one is cut down to the parts the question is about (select.ts). The
 * local model reads 8k tokens in all, so it gets the slide on screen only.
 */
const BUDGET: Record<string, number> = {
  gemini: 120_000,
  anthropic: 100_000,
  openai: 80_000,
  local: 0,
};

/** What the student is asking about, for choosing what the tutor reads. */
export type ContextQuery = {
  /** The student's recent messages and the card on screen, as one string. */
  text: string;
  /** The page on screen, always included. */
  slideId?: string | null;
};

/** The student's material as one block of text, for the tutor's system prompt. */
export async function deckContext(
  examId: string,
  providerName: string,
  query?: ContextQuery,
): Promise<string> {
  const budget = BUDGET[providerName] ?? 60_000;
  if (budget <= 0) return "";

  const rows = await db
    .select({
      id: sourceSlides.id,
      filename: sourceFiles.filename,
      fileType: sourceFiles.fileType,
      index: sourceSlides.index,
      title: sourceSlides.title,
      text: sourceSlides.rawText,
      notes: sourceSlides.speakerNotes,
    })
    .from(sourceSlides)
    .innerJoin(sourceFiles, eq(sourceSlides.sourceFileId, sourceFiles.id))
    .where(
      and(
        eq(sourceFiles.examId, examId),
        eq(sourceFiles.status, "ready"),
        ne(sourceSlides.legibilityFlag, "empty"),
      ),
    )
    .orderBy(asc(sourceFiles.createdAt), asc(sourceSlides.index));

  const text = query?.text ?? "";
  const slides = namedSlides(text);
  const units = rows.map((row) => {
    const unit = row.fileType === "pptx" ? "Slide" : "Page";
    return {
      text: [
        `[${row.filename} — ${unit} ${row.index}]${row.title ? ` ${row.title}` : ""}`,
        row.text.trim(),
        row.notes?.trim() ? `Speaker notes: ${row.notes.trim()}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      pinned: row.id === query?.slideId || slides.has(row.index),
    };
  });

  const chosen = selectUnits(units, text, budget);
  const parts = chosen.map((index) => units[index].text);
  if (chosen.length < units.length) {
    parts.push(
      `[Only the ${chosen.length} of ${units.length} pages most relevant to this question are included here. If the answer needs a page that is not, say which topic to ask about and do not guess at its content.]`,
    );
  }
  return parts.join("\n\n");
}

/** How much of the flashcard list the tutor reads, in characters. */
const CARD_BUDGET: Record<string, number> = {
  gemini: 40_000,
  anthropic: 30_000,
  openai: 25_000,
  local: 0,
};

/**
 * The deck's flashcards, numbered as the app numbers them (#1 is the first
 * card in lecture order, the same number the card list and study view show),
 * so "explain flashcard 32" means one card and not every slide 32.
 */
export async function flashcardContext(
  examId: string,
  providerName: string,
  query?: ContextQuery,
): Promise<string> {
  const budget = CARD_BUDGET[providerName] ?? 20_000;
  if (budget <= 0) return "";

  const cards = await db.query.flashcards.findMany({
    where: eq(flashcards.examId, examId),
    with: { sourceSlide: { with: { sourceFile: true } } },
    orderBy: chronologicalCardOrder(),
  });

  const text = query?.text ?? "";
  const named = namedCards(text);
  const units = cards.map((card, index) => {
    const slide = card.sourceSlide;
    const source = slide
      ? ` (from [${slide.sourceFile.filename} — ${slide.sourceFile.fileType === "pptx" ? "Slide" : "Page"} ${slide.index}])`
      : "";
    return {
      // Numbered by position in the whole deck, so a card left out of this
      // request never shifts the number of one that is in it.
      text: [
        `Flashcard #${index + 1}${card.topic ? ` · ${card.topic}` : ""}${source}`,
        `Q: ${card.question.trim()}`,
        `A: ${card.directAnswer.trim()}`,
      ].join("\n"),
      pinned:
        named.has(index + 1) ||
        (Boolean(query?.slideId) && card.sourceSlideId === query?.slideId),
    };
  });

  const chosen = selectUnits(units, text, budget);
  const parts = chosen.map((index) => units[index].text);
  if (chosen.length < units.length) {
    parts.push(
      `[Only the ${chosen.length} of ${units.length} flashcards most relevant to this question are included here.]`,
    );
  }
  return parts.join("\n\n");
}

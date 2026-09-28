import "server-only";

import { and, asc, eq, ne } from "drizzle-orm";

import { db } from "@/db";
import { flashcards, sourceFiles, sourceSlides } from "@/db/schema";
import { chronologicalCardOrder } from "@/lib/order";

/**
 * How much of the deck the tutor reads, in characters.
 *
 * A semester of lecture text is a few hundred thousand characters, well inside
 * what Gemini, Claude and OpenAI take in one request. The local model reads
 * 8k tokens in all, so it gets the slide under discussion and nothing more.
 */
const BUDGET: Record<string, number> = {
  gemini: 600_000,
  anthropic: 400_000,
  openai: 300_000,
  local: 0,
};

/**
 * The student's material as one block of text, for the tutor's system prompt.
 *
 * It sits at the front of every request unchanged, so providers that cache a
 * repeated prefix (Gemini implicitly, Claude and OpenAI likewise) charge for
 * it once per conversation rather than once per follow-up.
 */
export async function deckContext(examId: string, providerName: string): Promise<string> {
  const budget = BUDGET[providerName] ?? 200_000;
  if (budget <= 0) return "";

  const rows = await db
    .select({
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

  const parts: string[] = [];
  let used = 0;
  for (const row of rows) {
    const unit = row.fileType === "pptx" ? "Slide" : "Page";
    const body = [
      `[${row.filename} — ${unit} ${row.index}]${row.title ? ` ${row.title}` : ""}`,
      row.text.trim(),
      row.notes?.trim() ? `Speaker notes: ${row.notes.trim()}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    if (used + body.length > budget) {
      parts.push("[The rest of the material was too long to include.]");
      break;
    }
    parts.push(body);
    used += body.length + 2;
  }
  return parts.join("\n\n");
}

/** How much of the flashcard list the tutor reads, in characters. */
const CARD_BUDGET: Record<string, number> = {
  gemini: 200_000,
  anthropic: 150_000,
  openai: 100_000,
  local: 0,
};

/**
 * The deck's flashcards, numbered as the app numbers them (#1 is the first
 * card in lecture order, the same number the card list and study view show),
 * so "explain flashcard 32" means one card and not every slide 32.
 */
export async function flashcardContext(examId: string, providerName: string): Promise<string> {
  const budget = CARD_BUDGET[providerName] ?? 60_000;
  if (budget <= 0) return "";

  const cards = await db.query.flashcards.findMany({
    where: eq(flashcards.examId, examId),
    with: { sourceSlide: { with: { sourceFile: true } } },
    orderBy: chronologicalCardOrder(),
  });

  const parts: string[] = [];
  let used = 0;
  for (const [index, card] of cards.entries()) {
    const slide = card.sourceSlide;
    const source = slide
      ? ` (from [${slide.sourceFile.filename} — ${slide.sourceFile.fileType === "pptx" ? "Slide" : "Page"} ${slide.index}])`
      : "";
    const body = [
      `Flashcard #${index + 1}${card.topic ? ` · ${card.topic}` : ""}${source}`,
      `Q: ${card.question.trim()}`,
      `A: ${card.directAnswer.trim()}`,
    ].join("\n");
    if (used + body.length > budget) {
      parts.push(`[Flashcards #${index + 1}–#${cards.length} were too many to include.]`);
      break;
    }
    parts.push(body);
    used += body.length + 2;
  }
  return parts.join("\n\n");
}

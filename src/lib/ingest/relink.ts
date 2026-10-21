/**
 * Pointing cards back at the right section after a file is re-split.
 *
 * Re-reading a file updates its sections by number (ingestSourceFile), so a
 * transcript that was one section and is now thirty keeps every old card on
 * section 1 — whose text is now only the first two minutes. Each card's
 * excerpt is a verbatim quote, so it can be found again: the card moves to
 * whichever section of the same file contains it. A card whose quote cannot
 * be found stays where it was.
 *
 * `retiring` names sections about to be deleted because the file no longer
 * has them: their cards always look for a new home, and none is chosen as
 * one. Without this a file that shrank left those cards with no source.
 */
import { and, eq, inArray, isNotNull } from "drizzle-orm";

import type { Db } from "@/db/client";
import { flashcards, sourceSlides } from "@/db/schema";

const squash = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();

/** The longest part of an excerpt that was shortened with "...". */
function anchor(excerpt: string): string {
  return excerpt
    .split(/\.{3}|…/)
    .map(squash)
    .sort((a, b) => b.length - a.length)[0] ?? "";
}

export function relinkCards(db: Db, fileId: string, retiring: ReadonlySet<string> = new Set()): number {
  const slides = db
    .select({ id: sourceSlides.id, rawText: sourceSlides.rawText, notes: sourceSlides.speakerNotes })
    .from(sourceSlides)
    .where(eq(sourceSlides.sourceFileId, fileId))
    .all()
    .map((slide) => ({ id: slide.id, text: squash(`${slide.rawText}\n${slide.notes ?? ""}`) }));
  if (slides.length === 0) return 0;

  const cards = db
    .select({ id: flashcards.id, slideId: flashcards.sourceSlideId, excerpt: flashcards.sourceExcerpt })
    .from(flashcards)
    .where(
      and(
        inArray(flashcards.sourceSlideId, slides.map((slide) => slide.id)),
        isNotNull(flashcards.sourceExcerpt),
      ),
    )
    .all();

  let moved = 0;
  db.transaction((tx) => {
    for (const card of cards) {
      const quote = anchor(card.excerpt ?? "");
      if (quote.length < 8) continue;

      const current = slides.find((slide) => slide.id === card.slideId);
      if (current && !retiring.has(current.id) && current.text.includes(quote)) continue;

      const home = slides.find((slide) => !retiring.has(slide.id) && slide.text.includes(quote));
      if (!home) continue;

      tx.update(flashcards).set({ sourceSlideId: home.id }).where(eq(flashcards.id, card.id)).run();
      moved += 1;
    }
  });

  return moved;
}

/**
 * `.meganstudy` — a deck one student hands to another.
 *
 * Plain JSON: the cards, and the study guide only when the sender asks for it.
 * Nothing of the sender's own goes in it — no review history, no ids, no
 * source files, no slide images — so opening one always makes a fresh deck
 * that starts at "new", and never touches a deck the receiver already has.
 *
 * A file comes from anywhere, so reading one checks every field and caps
 * sizes before anything reaches the database.
 */
import { eq } from "drizzle-orm";

import {
  SHARE_FORMAT,
  SHARE_ORIGIN,
  SHARE_VERSION,
  parseShareFile,
  type ShareFile,
} from "@megan/core/share/meganstudy";
import type { Db } from "@/db/client";
import { courses, exams } from "@/db/schema";
import { insertDeck } from "@/lib/decks/insert";
import { snapshotCards, snapshotGuide } from "@/lib/decks/snapshot";

// The format itself — constants, checks and parsing — lives in the shared
// core so the iOS app reads files exactly the same way.
export * from "@megan/core/share/meganstudy";

/** The share file for a deck, or null when there is no such deck. */
export function buildShareFile(
  db: Db,
  examId: string,
  options: { includeGuide?: boolean } = {},
  now = new Date(),
): ShareFile | null {
  const exam = db.select().from(exams).where(eq(exams.id, examId)).get();
  if (!exam) return null;
  const course = db.select().from(courses).where(eq(courses.id, exam.courseId)).get();

  return {
    format: SHARE_FORMAT,
    version: SHARE_VERSION,
    exportedAt: now.toISOString(),
    deck: {
      title: exam.title,
      course: course?.title ?? "Shared decks",
      term: course?.term ?? null,
      cards: snapshotCards(db, examId),
      guide: options.includeGuide ? snapshotGuide(db, examId) : null,
    },
  };
}

/** Reads a file and adds it as a new deck. Returns the new deck's id. */
export function importShareFile(db: Db, raw: string): { examId: string; cardCount: number } {
  const file = parseShareFile(raw);
  const examId = insertDeck(db, { ...file.deck, origin: SHARE_ORIGIN });
  return { examId, cardCount: file.deck.cards.length };
}

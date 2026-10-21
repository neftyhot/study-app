/**
 * Reads for the Lectures tab.
 */
import "server-only";

import { desc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { exams, lectureDeckLinks, lectureTranscripts, sourceFiles } from "@/db/schema";

/** Every transcript, newest first, without the text itself. */
export function listLectures() {
  return db
    .select({
      id: lectureTranscripts.id,
      title: lectureTranscripts.title,
      durationSeconds: lectureTranscripts.durationSeconds,
      createdAt: lectureTranscripts.createdAt,
      hasAudio: sql<number>`${lectureTranscripts.audioPath} is not null`,
      pending: sql<number>`${lectureTranscripts.transcriptStatus} = 'pending'`,
      words: sql<number>`length(${lectureTranscripts.fullText}) - length(replace(${lectureTranscripts.fullText}, ' ', '')) + (${lectureTranscripts.fullText} <> '')`,
      preview: sql<string>`substr(${lectureTranscripts.fullText}, 1, 220)`,
      deckCount: sql<number>`(select count(*) from ${lectureDeckLinks} where ${lectureDeckLinks.lectureId} = ${lectureTranscripts.id})`,
    })
    .from(lectureTranscripts)
    .orderBy(desc(lectureTranscripts.createdAt), desc(lectureTranscripts.id))
    .all();
}

export type LectureSummary = ReturnType<typeof listLectures>[number];

export function getLecture(lectureId: string) {
  return db
    .select()
    .from(lectureTranscripts)
    .where(eq(lectureTranscripts.id, lectureId))
    .get();
}

/**
 * The decks a transcript was added to. `inDeck` is false once the notes it
 * became were removed from that deck, which makes adding it again a fresh add.
 */
export function listLectureDecks(lectureId: string) {
  return db
    .select({
      deckId: lectureDeckLinks.deckId,
      title: exams.title,
      syncedAt: lectureDeckLinks.syncedAt,
      inDeck: sql<number>`${sourceFiles.id} is not null`,
    })
    .from(lectureDeckLinks)
    .innerJoin(exams, eq(exams.id, lectureDeckLinks.deckId))
    .leftJoin(sourceFiles, eq(sourceFiles.id, lectureDeckLinks.sourceFileId))
    .where(eq(lectureDeckLinks.lectureId, lectureId))
    .all()
    .map((row) => ({ ...row, inDeck: Boolean(row.inDeck) }));
}

export type LectureDeck = ReturnType<typeof listLectureDecks>[number];

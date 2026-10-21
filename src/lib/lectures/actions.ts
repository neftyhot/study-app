"use server";

import { createHash, randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { exams, lectureDeckLinks, lectureTranscripts, sourceFiles } from "@/db/schema";
import { ingestSourceFile } from "@/lib/ingest";
import { absolutePathFor, storeUpload } from "@/lib/ingest/storage";

import { toDeckNotes } from "./format";
import { lectureAudioPath } from "./storage";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function renameLectureAction(lectureId: string, title: string): Promise<Result> {
  const next = String(title ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (!next) return { ok: false, error: "A lecture needs a title." };

  const changed = db
    .update(lectureTranscripts)
    .set({ title: next, updatedAt: sql`(current_timestamp)` })
    .where(eq(lectureTranscripts.id, lectureId))
    .run();
  if (changed.changes === 0) return { ok: false, error: "That lecture no longer exists." };

  revalidatePath("/lectures");
  revalidatePath(`/lectures/${lectureId}`);
  return { ok: true };
}

/** The recording is outside the database, so it is removed from disk as well. */
async function removeAudio(audioPath: string | null) {
  if (!audioPath) return;
  // Throws for a stored path that would leave the lectures folder.
  await rm(lectureAudioPath(audioPath), { force: true });
}

/**
 * Deletes a transcript and its audio. Notes already added to a deck stay in
 * that deck: they are the deck's source material now, with cards citing them.
 */
export async function deleteLectureAction(lectureId: string): Promise<Result> {
  const lecture = db
    .select({ audioPath: lectureTranscripts.audioPath })
    .from(lectureTranscripts)
    .where(eq(lectureTranscripts.id, lectureId))
    .get();
  if (!lecture) return { ok: false, error: "That lecture no longer exists." };

  try {
    db.delete(lectureTranscripts).where(eq(lectureTranscripts.id, lectureId)).run();
    await removeAudio(lecture.audioPath);
  } catch (error) {
    return { ok: false, error: message(error) };
  }

  revalidatePath("/lectures");
  return { ok: true };
}

/** Keeps the transcript and frees the disk space its recording takes. */
export async function discardLectureAudioAction(lectureId: string): Promise<Result> {
  const lecture = db
    .select({ audioPath: lectureTranscripts.audioPath })
    .from(lectureTranscripts)
    .where(eq(lectureTranscripts.id, lectureId))
    .get();
  if (!lecture) return { ok: false, error: "That lecture no longer exists." };

  try {
    await removeAudio(lecture.audioPath);
    db.update(lectureTranscripts)
      .set({ audioPath: null, updatedAt: sql`(current_timestamp)` })
      .where(eq(lectureTranscripts.id, lectureId))
      .run();
  } catch (error) {
    return { ok: false, error: message(error) };
  }

  revalidatePath("/lectures");
  revalidatePath(`/lectures/${lectureId}`);
  return { ok: true };
}

/**
 * Adds a transcript to a deck as notes, through the same ingest path as pasted
 * text, so cards can be generated from it and cite it like any other source.
 *
 * Adding it to a deck that still has it updates those notes in place instead
 * of making a second copy: the source file keeps its id, and ingest upserts
 * its sections, so cards already made from it keep pointing at them.
 */
export async function addLectureToDeckAction(
  lectureId: string,
  deckId: string,
): Promise<Result<{ updated: boolean; sections: number; deckTitle: string }>> {
  const lecture = db
    .select()
    .from(lectureTranscripts)
    .where(eq(lectureTranscripts.id, lectureId))
    .get();
  if (!lecture) return { ok: false, error: "That lecture no longer exists." };

  const deck = db.select().from(exams).where(eq(exams.id, deckId)).get();
  if (!deck) return { ok: false, error: "That deck no longer exists." };

  const notes = toDeckNotes(lecture.title, lecture.segments, lecture.fullText);
  if (!notes.trim()) return { ok: false, error: "This transcript has no text to add." };
  const data = Buffer.from(notes, "utf8");

  const link = db
    .select()
    .from(lectureDeckLinks)
    .where(and(eq(lectureDeckLinks.lectureId, lectureId), eq(lectureDeckLinks.deckId, deckId)))
    .get();
  const existing = link?.sourceFileId
    ? db.select().from(sourceFiles).where(eq(sourceFiles.id, link.sourceFileId)).get()
    : undefined;

  try {
    let file;
    if (existing) {
      await writeFile(absolutePathFor(existing.rawPath), data);
      file = db
        .update(sourceFiles)
        .set({ checksum: createHash("sha256").update(data).digest("hex") })
        .where(eq(sourceFiles.id, existing.id))
        .returning()
        .get();
    } else {
      const fileId = randomUUID();
      const filename = `${lecture.title} (lecture transcript).txt`;
      const stored = await storeUpload(deckId, fileId, filename, data);
      file = db
        .insert(sourceFiles)
        .values({
          id: fileId,
          examId: deckId,
          filename,
          fileType: "pasted",
          role: "notes",
          rawPath: stored.rawPath,
          checksum: stored.checksum,
        })
        .returning()
        .get();
    }

    // Linked before ingest: if ingest fails the file is still in the deck,
    // marked failed, and the next attempt should retry it, not add another.
    db.insert(lectureDeckLinks)
      .values({ lectureId, deckId, sourceFileId: file.id })
      .onConflictDoUpdate({
        target: [lectureDeckLinks.lectureId, lectureDeckLinks.deckId],
        set: { sourceFileId: file.id, syncedAt: sql`(current_timestamp)` },
      })
      .run();

    const outcome = await ingestSourceFile(db, file, absolutePathFor(file.rawPath));

    revalidatePath(`/lectures/${lectureId}`);
    revalidatePath("/lectures");
    revalidatePath(`/exams/${deckId}`, "layout");
    return {
      ok: true,
      updated: Boolean(existing),
      sections: outcome.unitCount,
      deckTitle: deck.title,
    };
  } catch (error) {
    revalidatePath(`/lectures/${lectureId}`);
    return { ok: false, error: message(error) };
  }
}

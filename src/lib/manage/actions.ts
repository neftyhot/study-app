"use server";

import { rm } from "node:fs/promises";

import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { eq } from "drizzle-orm";

import { sourceFiles } from "@/db/schema";
import { ingestSourceFile } from "@/lib/ingest";
import { relinkCards } from "@/lib/ingest/relink";
import { absolutePathFor } from "@/lib/ingest/storage";

import {
  createCourse,
  createExam,
  deleteCourse,
  deleteExam,
  deleteSourceFile,
  previewExamDeletion,
  previewSourceFileDeletion,
  renameCourse,
  renameExam,
  renameSourceFile,
  resetProgress,
  updateCourse,
  updateExam,
} from "./index";

/** Uploads live outside the database, so deletions have to reach the disk too. */
async function removeExamUploads(examId: string) {
  // Throws for an id that would leave the uploads root, rather than
  // deleting whatever it names.
  await rm(absolutePathFor(examId), {
    recursive: true,
    force: true,
  });
}

export async function createCourseAction(input: {
  title: string;
  term?: string;
}) {
  const course = createCourse(db, input);
  revalidatePath("/");
  return { id: course.id, title: course.title };
}

export async function createExamAction(input: {
  courseId: string;
  title: string;
  date?: string;
}) {
  const exam = createExam(db, input);
  revalidatePath("/");
  return { id: exam.id, title: exam.title };
}

export async function renameCourseAction(courseId: string, title: string) {
  renameCourse(db, courseId, title);
  revalidatePath("/");
}

export async function renameExamAction(examId: string, title: string) {
  renameExam(db, examId, title);
  revalidatePath("/");
  revalidatePath(`/exams/${examId}`);
}

export async function updateCourseAction(
  courseId: string,
  input: { title: string; term: string },
) {
  updateCourse(db, courseId, input);
  revalidatePath("/", "layout");
}

export async function updateExamAction(
  examId: string,
  input: { title: string; date: string; courseId: string },
) {
  updateExam(db, examId, input);
  revalidatePath("/", "layout");
}

export async function renameSourceFileAction(
  examId: string,
  fileId: string,
  filename: string,
) {
  renameSourceFile(db, fileId, filename);
  revalidatePath("/exams/[examId]", "layout");
}

/**
 * Reads a file again with the current splitting rules, then moves each card
 * to the section its quote is now in. For transcripts and notes uploaded
 * before long sections were split (see lib/ingest/chunk.ts).
 */
export async function resplitSourceFileAction(fileId: string) {
  const file = db.select().from(sourceFiles).where(eq(sourceFiles.id, fileId)).get();
  if (!file) return { ok: false as const, error: "That file no longer exists." };

  const before = file.unitCount ?? 0;
  try {
    const outcome = await ingestSourceFile(db, file, absolutePathFor(file.rawPath));
    const moved = relinkCards(db, file.id);
    revalidatePath("/exams/[examId]", "layout");
    return { ok: true as const, before, after: outcome.unitCount, moved };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Could not re-read the file." };
  }
}

export async function sourceFileImpact(fileId: string) {
  return previewSourceFileDeletion(db, fileId) ?? null;
}

export async function deleteSourceFileAction(examId: string, fileId: string) {
  const result = deleteSourceFile(db, fileId);
  if (!result) return null;

  await rm(absolutePathFor(result.rawPath), { force: true });

  revalidatePath(`/exams/${examId}/sources`);
  revalidatePath(`/exams/${examId}`);
  revalidatePath(`/exams/${examId}/cards`);
  return result;
}

export async function examImpact(examId: string) {
  return previewExamDeletion(db, examId) ?? null;
}

export async function deleteExamAction(examId: string) {
  const deleted = deleteExam(db, examId);
  if (deleted) await removeExamUploads(examId);

  revalidatePath("/");
  return deleted;
}

export async function deleteCourseAction(courseId: string) {
  const examIds = deleteCourse(db, courseId);
  await Promise.all(examIds.map(removeExamUploads));

  revalidatePath("/");
  return examIds.length;
}

/**
 * Clears review history for a deck, keeping the deck itself.
 *
 * Deliberately separate from deletion: "I want to start this material over" is
 * a different request from "I want this material gone", and conflating them is
 * how a student loses a deck they meant to keep.
 */
export async function resetProgressAction(examId: string) {
  const result = resetProgress(db, examId);

  revalidatePath(`/exams/${examId}`);
  revalidatePath(`/exams/${examId}/study`);
  revalidatePath(`/exams/${examId}/learn`);
  return result;
}

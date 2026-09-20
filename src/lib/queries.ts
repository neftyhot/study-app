import "server-only";

import { desc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  courses,
  exams,
  flashcards,
  sourceFiles,
  studyGuideObjectives,
} from "@/db/schema";

/** Courses with their exams, for the dashboard. */
export async function listCoursesWithExams() {
  return db.query.courses.findMany({
    with: { exams: { orderBy: [desc(exams.createdAt)] } },
    orderBy: [desc(courses.createdAt)],
  });
}

export async function getExam(examId: string) {
  return db.query.exams.findFirst({
    where: eq(exams.id, examId),
    with: { course: true },
  });
}

/** Headline counts shown on the exam overview. */
export async function getExamStats(examId: string) {
  const [fileRow] = await db
    .select({ n: sql<number>`count(*)` })
    .from(sourceFiles)
    .where(eq(sourceFiles.examId, examId));
  const [objectiveRow] = await db
    .select({ n: sql<number>`count(*)` })
    .from(studyGuideObjectives)
    .where(eq(studyGuideObjectives.examId, examId));
  const [cardRow] = await db
    .select({ n: sql<number>`count(*)` })
    .from(flashcards)
    .where(eq(flashcards.examId, examId));

  return {
    sourceFiles: fileRow?.n ?? 0,
    objectives: objectiveRow?.n ?? 0,
    flashcards: cardRow?.n ?? 0,
  };
}

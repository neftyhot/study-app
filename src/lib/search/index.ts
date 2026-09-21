/**
 * Search across every subject and deck.
 *
 * Loads once and matches in memory rather than pushing LIKE clauses into
 * SQLite: the whole corpus is a few thousand rows, the matching rules
 * (exact-before-lexical, quoted phrases, highlighting) are already written
 * once in `match.ts`, and keeping them in one place means the deck-level
 * search and this one cannot drift apart.
 *
 * If a library ever grows past tens of thousands of cards this should move to
 * FTS5 — the seam is `loadCorpus`, not the matching.
 */
import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  courses,
  exams,
  flashcards,
  sourceFiles,
  sourceSlides,
  studyGuideObjectives,
  studyProgress,
} from "@/db/schema";

export * from "./match";
export * from "./docs";
export type { SemanticHit } from "./semantic";

import type { SearchDoc } from "./docs";

/** Everything searchable, in one pass. */
export async function loadCorpus(): Promise<SearchDoc[]> {
  const cardRows = await db
    .select({
      id: flashcards.id,
      topic: flashcards.topic,
      question: flashcards.question,
      directAnswer: flashcards.directAnswer,
      fullExplanation: flashcards.fullExplanation,
      sourceExcerpt: flashcards.sourceExcerpt,
      cardType: flashcards.cardType,
      starred: flashcards.starred,
      excluded: flashcards.excluded,
      state: studyProgress.state,
      examId: exams.id,
      examTitle: exams.title,
      courseId: courses.id,
      courseTitle: courses.title,
    })
    .from(flashcards)
    .innerJoin(exams, eq(exams.id, flashcards.examId))
    .innerJoin(courses, eq(courses.id, exams.courseId))
    .leftJoin(studyProgress, eq(studyProgress.flashcardId, flashcards.id));

  const objectiveRows = await db
    .select({
      id: studyGuideObjectives.id,
      label: studyGuideObjectives.label,
      promptText: studyGuideObjectives.promptText,
      examId: exams.id,
      examTitle: exams.title,
      courseId: courses.id,
      courseTitle: courses.title,
    })
    .from(studyGuideObjectives)
    .innerJoin(exams, eq(exams.id, studyGuideObjectives.examId))
    .innerJoin(courses, eq(courses.id, exams.courseId));

  const sourceRows = await db
    .select({
      id: sourceSlides.id,
      index: sourceSlides.index,
      title: sourceSlides.title,
      rawText: sourceSlides.rawText,
      speakerNotes: sourceSlides.speakerNotes,
      filename: sourceFiles.filename,
      fileType: sourceFiles.fileType,
      examId: exams.id,
      examTitle: exams.title,
      courseId: courses.id,
      courseTitle: courses.title,
    })
    .from(sourceSlides)
    .innerJoin(sourceFiles, eq(sourceFiles.id, sourceSlides.sourceFileId))
    .innerJoin(exams, eq(exams.id, sourceFiles.examId))
    .innerJoin(courses, eq(courses.id, exams.courseId));

  const docs: SearchDoc[] = [];

  for (const row of cardRows) {
    if (row.excluded) continue;

    docs.push({
      id: row.id,
      kind: "card",
      haystack: [
        row.topic ?? "",
        row.question,
        row.directAnswer,
        row.fullExplanation ?? "",
        row.sourceExcerpt ?? "",
      ].join("\n"),
      title: row.question,
      body: row.directAnswer,
      courseId: row.courseId,
      courseTitle: row.courseTitle,
      examId: row.examId,
      examTitle: row.examTitle,
      topic: row.topic,
      cardType: row.cardType,
      starred: row.starred,
      state: row.state ?? "unstudied",
      href: `/exams/${row.examId}/cards`,
    });
  }

  for (const row of objectiveRows) {
    docs.push({
      id: row.id,
      kind: "objective",
      haystack: `${row.label ?? ""}\n${row.promptText}`,
      title: row.promptText,
      body: row.label ? `Objective ${row.label}` : "Study-guide objective",
      courseId: row.courseId,
      courseTitle: row.courseTitle,
      examId: row.examId,
      examTitle: row.examTitle,
      topic: null,
      cardType: null,
      starred: false,
      state: null,
      href: `/exams/${row.examId}/coverage`,
    });
  }

  for (const row of sourceRows) {
    const noun =
      row.fileType === "pptx" ? "Slide" : row.fileType === "pdf" ? "Page" : "Section";

    docs.push({
      id: row.id,
      kind: "source",
      haystack: [row.title ?? "", row.rawText, row.speakerNotes ?? ""].join("\n"),
      title: row.title ?? `${noun} ${row.index}`,
      body: `${noun} ${row.index} of ${row.filename}`,
      courseId: row.courseId,
      courseTitle: row.courseTitle,
      examId: row.examId,
      examTitle: row.examTitle,
      topic: null,
      cardType: null,
      starred: false,
      state: null,
      href: `/exams/${row.examId}/sources`,
    });
  }

  return docs;
}

/** Course and deck names, for the filter controls. */
export async function searchScopes() {
  const rows = await db
    .select({
      courseId: courses.id,
      courseTitle: courses.title,
      examId: exams.id,
      examTitle: exams.title,
    })
    .from(exams)
    .innerJoin(courses, eq(courses.id, exams.courseId))
    .where(and());

  const byCourse = new Map<string, { id: string; title: string; exams: { id: string; title: string }[] }>();

  for (const row of rows) {
    const course = byCourse.get(row.courseId) ?? {
      id: row.courseId,
      title: row.courseTitle,
      exams: [],
    };
    course.exams.push({ id: row.examId, title: row.examTitle });
    byCourse.set(row.courseId, course);
  }

  return [...byCourse.values()];
}

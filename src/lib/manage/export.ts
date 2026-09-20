/**
 * Exam export (PRD §15: export/backup).
 *
 * A full, human-readable snapshot of one deck: its sources and the text
 * extracted from them, its cards and rubrics, the coverage matrix, review
 * history, and every typed answer. The point is that a student's work is
 * never trapped in this app's SQLite file — everything they built or wrote
 * comes out, in a format they can read.
 */
import { asc, eq, inArray } from "drizzle-orm";

import type { Db } from "@/db/client";
import {
  answerAttempts,
  cardRubrics,
  contentConflicts,
  courses,
  coverageMappings,
  exams,
  flashcards,
  objectiveCoverage,
  sourceFiles,
  sourceSlides,
  studyGuideObjectives,
  studyProgress,
  studySessions,
} from "@/db/schema";

/** Bumped when the shape changes, so an old file is still identifiable. */
export const EXPORT_VERSION = 1;

export function buildExamExport(db: Db, examId: string) {
  const exam = db.select().from(exams).where(eq(exams.id, examId)).get();
  if (!exam) return undefined;

  const course = db
    .select()
    .from(courses)
    .where(eq(courses.id, exam.courseId))
    .get();

  const files = db
    .select()
    .from(sourceFiles)
    .where(eq(sourceFiles.examId, examId))
    .all();

  const fileIds = files.map((file) => file.id);
  const units =
    fileIds.length === 0
      ? []
      : db
          .select()
          .from(sourceSlides)
          .where(inArray(sourceSlides.sourceFileId, fileIds))
          .orderBy(asc(sourceSlides.sourceFileId), asc(sourceSlides.index))
          .all();

  const objectives = db
    .select()
    .from(studyGuideObjectives)
    .where(eq(studyGuideObjectives.examId, examId))
    .orderBy(asc(studyGuideObjectives.orderIndex))
    .all();

  const objectiveIds = objectives.map((objective) => objective.id);

  const cards = db
    .select()
    .from(flashcards)
    .where(eq(flashcards.examId, examId))
    .all();

  const cardIds = cards.map((card) => card.id);

  const rubrics =
    cardIds.length === 0
      ? []
      : db
          .select()
          .from(cardRubrics)
          .where(inArray(cardRubrics.flashcardId, cardIds))
          .all();

  const progress =
    cardIds.length === 0
      ? []
      : db
          .select()
          .from(studyProgress)
          .where(inArray(studyProgress.flashcardId, cardIds))
          .all();

  const attempts =
    cardIds.length === 0
      ? []
      : db
          .select()
          .from(answerAttempts)
          .where(inArray(answerAttempts.flashcardId, cardIds))
          .all();

  const rubricByCard = new Map(rubrics.map((row) => [row.flashcardId, row]));
  const progressByCard = new Map(progress.map((row) => [row.flashcardId, row]));
  const unitById = new Map(units.map((unit) => [unit.id, unit]));
  const fileById = new Map(files.map((file) => [file.id, file]));

  return {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    course: course
      ? { id: course.id, title: course.title, term: course.term }
      : null,
    exam: {
      id: exam.id,
      title: exam.title,
      date: exam.date,
      scopeMode: exam.scopeMode,
    },
    sourceFiles: files.map((file) => ({
      id: file.id,
      filename: file.filename,
      fileType: file.fileType,
      role: file.role,
      checksum: file.checksum,
      status: file.status,
      units: units
        .filter((unit) => unit.sourceFileId === file.id)
        .map((unit) => ({
          index: unit.index,
          title: unit.title,
          rawText: unit.rawText,
          speakerNotes: unit.speakerNotes,
          tables: unit.tables,
          legibilityFlag: unit.legibilityFlag,
        })),
    })),
    objectives: objectives.map((objective) => ({
      id: objective.id,
      label: objective.label,
      promptText: objective.promptText,
      professorEmphasis: objective.professorEmphasis,
      excluded: objective.excluded,
      verdict:
        db
          .select()
          .from(objectiveCoverage)
          .where(eq(objectiveCoverage.objectiveId, objective.id))
          .get() ?? null,
    })),
    flashcards: cards.map((card) => {
      const unit = card.sourceSlideId
        ? unitById.get(card.sourceSlideId)
        : undefined;
      const file = unit ? fileById.get(unit.sourceFileId) : undefined;

      return {
        id: card.id,
        topic: card.topic,
        question: card.question,
        directAnswer: card.directAnswer,
        fullExplanation: card.fullExplanation,
        cardType: card.cardType,
        isUserEdited: card.isUserEdited,
        starred: card.starred,
        excluded: card.excluded,
        hasAiSupplement: card.hasAiSupplement,
        // Provenance is written out in readable form, not as a foreign key:
        // "slide 7 of lecture.pptx" still means something outside this app.
        source: unit
          ? {
              filename: file?.filename ?? null,
              index: unit.index,
              excerpt: card.sourceExcerpt,
            }
          : null,
        rubric: rubricByCard.get(card.id)
          ? {
              essentialPoints: rubricByCard.get(card.id)!.essentialPoints,
              optionalPoints: rubricByCard.get(card.id)!.optionalPoints,
              commonMisconceptions:
                rubricByCard.get(card.id)!.commonMisconceptions,
            }
          : null,
        progress: progressByCard.get(card.id) ?? null,
      };
    }),
    coverage:
      objectiveIds.length === 0
        ? []
        : db
            .select()
            .from(coverageMappings)
            .where(inArray(coverageMappings.objectiveId, objectiveIds))
            .all(),
    conflicts: db
      .select()
      .from(contentConflicts)
      .where(eq(contentConflicts.examId, examId))
      .all(),
    sessions: db
      .select()
      .from(studySessions)
      .where(eq(studySessions.examId, examId))
      .all()
      .map((session) => ({
        id: session.id,
        mode: session.mode,
        scope: session.scope,
        startedAt: session.startedAt,
        completedAt: session.completedAt,
        missedCount: session.missedCount,
        difficultCount: session.difficultCount,
        easyCount: session.easyCount,
      })),
    attempts: attempts.map((attempt) => ({
      flashcardId: attempt.flashcardId,
      stage: attempt.stage,
      answer: attempt.answer,
      verdict: attempt.verdict,
      errorType: attempt.errorType,
      metPoints: attempt.metPoints,
      missedPoints: attempt.missedPoints,
      overridden: attempt.overridden,
      createdAt: attempt.createdAt,
    })),
  };
}

export type ExamExport = NonNullable<ReturnType<typeof buildExamExport>>;

/** A filename a student will recognise a year from now. */
export function exportFilename(examTitle: string, date = new Date()): string {
  const slug =
    examTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "exam";

  return `${slug}-${date.toISOString().slice(0, 10)}.json`;
}

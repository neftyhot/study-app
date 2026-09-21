import "server-only";

import { and, count, desc, eq, isNotNull, isNull, lte, ne, sql } from "drizzle-orm";

import { db } from "@/db";
import { todayIso } from "@/lib/srs";
import {
  assistEvents,
  coverageMappings,
  cardRevisions,
  contentConflicts,
  errorDiagnoses,
  courses,
  exams,
  flashcards,
  objectiveCoverage,
  sourceFiles,
  sourceSlides,
  studyGuideObjectives,
  studyProgress,
  studySessions,
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

/** Source files for an exam, with their extracted units. */
export async function listSourceFiles(examId: string) {
  return db.query.sourceFiles.findMany({
    where: eq(sourceFiles.examId, examId),
    with: { slides: { orderBy: [sourceSlides.index] } },
    orderBy: [desc(sourceFiles.createdAt)],
  });
}

export async function listObjectives(examId: string) {
  return db
    .select()
    .from(studyGuideObjectives)
    .where(eq(studyGuideObjectives.examId, examId))
    .orderBy(studyGuideObjectives.orderIndex);
}

/** How many extracted units are available as answer material. */
export async function countAnswerSlides(examId: string) {
  const [row] = await db
    .select({ n: count() })
    .from(sourceSlides)
    .innerJoin(sourceFiles, eq(sourceSlides.sourceFileId, sourceFiles.id))
    .where(
      and(
        eq(sourceFiles.examId, examId),
        eq(sourceFiles.status, "ready"),
        ne(sourceFiles.role, "study_guide"),
      ),
    );

  return row?.n ?? 0;
}

/** Cards with the slide each one cites, for the deck view. */
export async function listFlashcards(examId: string) {
  return db.query.flashcards.findMany({
    where: eq(flashcards.examId, examId),
    with: {
      sourceSlide: { with: { sourceFile: true } },
      rubric: true,
    },
    orderBy: [flashcards.topic, flashcards.createdAt],
  });
}

/**
 * The coverage matrix: every objective with its verdict, the cards mapped to
 * it, and the slide each of those cards cites — enough to render
 * "Covered by 6 cards via Slides 15–19" without a second query.
 */
export async function getCoverageMatrix(examId: string) {
  return db.query.studyGuideObjectives.findMany({
    where: eq(studyGuideObjectives.examId, examId),
    orderBy: [studyGuideObjectives.orderIndex],
    with: {
      verdict: { with: { supportingSlide: { with: { sourceFile: true } } } },
      coverage: {
        with: {
          flashcard: {
            with: { sourceSlide: { with: { sourceFile: true } } },
          },
        },
      },
    },
  });
}

export type CoverageRow = Awaited<ReturnType<typeof getCoverageMatrix>>[number];

/** Headline coverage counts for the exam overview. */
export async function getCoverageStats(examId: string) {
  const rows = await db
    .select({ status: objectiveCoverage.status })
    .from(objectiveCoverage)
    .innerJoin(
      studyGuideObjectives,
      eq(objectiveCoverage.objectiveId, studyGuideObjectives.id),
    )
    .where(eq(studyGuideObjectives.examId, examId));

  return {
    analyzed: rows.length,
    covered: rows.filter((r) => r.status === "covered").length,
    partiallyCovered: rows.filter((r) => r.status === "partially_covered")
      .length,
    missing: rows.filter((r) => r.status === "missing").length,
  };
}

export async function listConflicts(examId: string) {
  return db.query.contentConflicts.findMany({
    where: eq(contentConflicts.examId, examId),
    with: {
      slideA: { with: { sourceFile: true } },
      slideB: { with: { sourceFile: true } },
    },
    orderBy: [desc(contentConflicts.createdAt)],
  });
}

/** How many source files can be compared against each other for conflicts. */
export async function countReadyAnswerFiles(examId: string) {
  const [row] = await db
    .select({ n: count() })
    .from(sourceFiles)
    .where(
      and(
        eq(sourceFiles.examId, examId),
        eq(sourceFiles.status, "ready"),
        ne(sourceFiles.role, "study_guide"),
      ),
    );

  return row?.n ?? 0;
}

/** Everything the flip-card UI needs for one exam, in structured order. */
export async function listStudyCards(examId: string) {
  return db.query.flashcards.findMany({
    where: eq(flashcards.examId, examId),
    with: {
      sourceSlide: { with: { sourceFile: true } },
      rubric: true,
      progress: true,
    },
    orderBy: [flashcards.topic, flashcards.createdAt],
  });
}

export type StudyCard = Awaited<ReturnType<typeof listStudyCards>>[number];

/** The session to offer resuming, if one was left open. */
export async function getOpenStudySession(examId: string) {
  return db.query.studySessions.findFirst({
    where: and(
      eq(studySessions.examId, examId),
      eq(studySessions.mode, "flashcards"),
      isNull(studySessions.completedAt),
    ),
    orderBy: [desc(studySessions.updatedAt)],
  });
}

export async function listTopics(examId: string) {
  const rows = await db
    .selectDistinct({ topic: flashcards.topic })
    .from(flashcards)
    .where(eq(flashcards.examId, examId))
    .orderBy(flashcards.topic);

  return rows
    .map((row) => row.topic)
    .filter((topic): topic is string => Boolean(topic));
}

/** Cards whose review is due today or overdue (PRD §6). */
export async function countDueCards(examId: string, today = todayIso()) {
  const [row] = await db
    .select({ n: count() })
    .from(studyProgress)
    .innerJoin(flashcards, eq(flashcards.id, studyProgress.flashcardId))
    .where(
      and(
        eq(flashcards.examId, examId),
        eq(flashcards.excluded, false),
        isNotNull(studyProgress.nextReviewDue),
        lte(studyProgress.nextReviewDue, today),
      ),
    );

  return row?.n ?? 0;
}

/** Cards per mastery tier, for the overview (PRD §6 tracking axes). */
export async function getMasteryBreakdown(examId: string) {
  const rows = await db
    .select({ state: studyProgress.state })
    .from(studyProgress)
    .innerJoin(flashcards, eq(flashcards.id, studyProgress.flashcardId))
    .where(eq(flashcards.examId, examId));

  return {
    studied: rows.length,
    recognition: rows.filter((r) => r.state === "recognition").length,
    immediateRecall: rows.filter((r) => r.state === "immediate_recall").length,
    retained: rows.filter((r) => r.state === "retained").length,
  };
}

/** Cards with an edit that can still be undone (PRD §15). */
export async function listUndoableCards(examId: string) {
  const rows = await db
    .selectDistinct({ flashcardId: cardRevisions.flashcardId })
    .from(cardRevisions)
    .innerJoin(flashcards, eq(flashcards.id, cardRevisions.flashcardId))
    .where(eq(flashcards.examId, examId));

  return new Set(rows.map((row) => row.flashcardId));
}

/**
 * Cards that keep going wrong, with why (PRD §14).
 *
 * Surfaced outside the session as well as inside it: the point of diagnosing
 * a persistent error is to do something about it later, not only to see a note
 * in the moment it happens.
 */
export async function listDiagnosedCards(examId: string) {
  return db
    .select({
      cardId: flashcards.id,
      question: flashcards.question,
      topic: flashcards.topic,
      category: errorDiagnoses.category,
      explanation: errorDiagnoses.explanation,
      suggestion: errorDiagnoses.suggestion,
      attemptsConsidered: errorDiagnoses.attemptsConsidered,
    })
    .from(errorDiagnoses)
    .innerJoin(flashcards, eq(flashcards.id, errorDiagnoses.flashcardId))
    .where(eq(flashcards.examId, examId))
    .orderBy(desc(errorDiagnoses.attemptsConsidered));
}

/** How often help was used, per kind — assisted practice at a glance. */
export async function countAssists(examId: string) {
  const rows = await db
    .select({ kind: assistEvents.kind })
    .from(assistEvents)
    .innerJoin(flashcards, eq(flashcards.id, assistEvents.flashcardId))
    .where(eq(flashcards.examId, examId));

  return rows.length;
}

/**
 * Everything the planner needs, in one pass (PRD §12).
 *
 * Coverage is folded in here rather than queried per card: whether a card
 * answers any objective, and whether any objective it answers is
 * professor-emphasised, are what the triage options are built from.
 */
export async function loadPlanCards(examId: string) {
  const rows = await db
    .select({
      id: flashcards.id,
      cardType: flashcards.cardType,
      excluded: flashcards.excluded,
      state: studyProgress.state,
      lapses: studyProgress.lapses,
      nextReviewDue: studyProgress.nextReviewDue,
    })
    .from(flashcards)
    .leftJoin(studyProgress, eq(studyProgress.flashcardId, flashcards.id))
    .where(eq(flashcards.examId, examId));

  const mappings = await db
    .select({
      flashcardId: coverageMappings.flashcardId,
      emphasis: studyGuideObjectives.professorEmphasis,
    })
    .from(coverageMappings)
    .innerJoin(
      studyGuideObjectives,
      eq(studyGuideObjectives.id, coverageMappings.objectiveId),
    )
    .where(eq(studyGuideObjectives.examId, examId));

  const mapped = new Set<string>();
  const emphasised = new Set<string>();

  for (const row of mappings) {
    if (!row.flashcardId) continue;
    mapped.add(row.flashcardId);
    if (row.emphasis) emphasised.add(row.flashcardId);
  }

  return {
    hasCoverage: mappings.length > 0,
    cards: rows.map((row) => ({
      id: row.id,
      cardType: row.cardType,
      excluded: row.excluded,
      state: row.state,
      lapses: row.lapses ?? 0,
      nextReviewDue: row.nextReviewDue,
      mapsToObjective: mapped.has(row.id),
      emphasised: emphasised.has(row.id),
    })),
  };
}

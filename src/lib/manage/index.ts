/**
 * Course, deck, and source management.
 *
 * Deletion is the operation most likely to lose a student's work, so it is
 * written as plain functions over a `Db` and tested directly: every cascade
 * here is asserted, and every irreversible step is something the UI has
 * already shown the student the consequences of.
 *
 * The rule the destructive paths follow: **generated material may be
 * discarded, edited material may not.** A card the model wrote from a file
 * that no longer exists cannot be verified any more, so it goes with the file.
 * A card the student rewrote is their work, and it is kept — flagged as having
 * lost its source, never silently deleted.
 */
import { eq, inArray } from "drizzle-orm";

import type { Db } from "@/db/client";
import {
  answerAttempts,
  courses,
  exams,
  flashcards,
  sourceFiles,
  sourceSlides,
  studyGuideObjectives,
  studyProgress,
  studySessions,
  type Course,
  type Exam,
} from "@/db/schema";

/* ------------------------------------------------------------------ Create */

export function createCourse(
  db: Db,
  input: { title: string; term?: string | null },
): Course {
  const title = input.title.trim();
  if (!title) throw new Error("A course needs a title.");

  return db
    .insert(courses)
    .values({ title, term: input.term?.trim() || null })
    .returning()
    .get();
}

export function createExam(
  db: Db,
  input: {
    courseId: string;
    title: string;
    date?: string | null;
    scopeMode?: Exam["scopeMode"];
  },
): Exam {
  const title = input.title.trim();
  if (!title) throw new Error("A deck needs a title.");

  const course = db
    .select({ id: courses.id })
    .from(courses)
    .where(eq(courses.id, input.courseId))
    .get();
  if (!course) throw new Error("That course no longer exists.");

  return db
    .insert(exams)
    .values({
      courseId: input.courseId,
      title,
      date: input.date?.trim() || null,
      scopeMode: input.scopeMode ?? "files",
    })
    .returning()
    .get();
}

export function renameCourse(db: Db, courseId: string, title: string) {
  const trimmed = title.trim();
  if (!trimmed) throw new Error("A course needs a title.");

  db.update(courses)
    .set({ title: trimmed })
    .where(eq(courses.id, courseId))
    .run();
}

export function renameExam(db: Db, examId: string, title: string) {
  const trimmed = title.trim();
  if (!trimmed) throw new Error("A deck needs a title.");

  db.update(exams).set({ title: trimmed }).where(eq(exams.id, examId)).run();
}

export function updateCourse(
  db: Db,
  courseId: string,
  input: { title: string; term?: string | null },
) {
  const title = input.title.trim();
  if (!title) throw new Error("A subject needs a name.");

  db.update(courses)
    .set({ title, term: input.term?.trim() || null })
    .where(eq(courses.id, courseId))
    .run();
}

/**
 * Edits a deck's name, date and subject.
 *
 * Moving a deck to another subject moves everything in it: sources, cards and
 * history all hang off the deck, not the subject.
 */
export function updateExam(
  db: Db,
  examId: string,
  input: { title: string; date?: string | null; courseId?: string },
) {
  const title = input.title.trim();
  if (!title) throw new Error("A deck needs a name.");

  const date = input.date?.trim() || null;
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("The exam date should look like 2026-10-14.");
  }

  if (input.courseId) {
    const course = db
      .select({ id: courses.id })
      .from(courses)
      .where(eq(courses.id, input.courseId))
      .get();
    if (!course) throw new Error("That subject no longer exists.");
  }

  db.update(exams)
    .set({ title, date, ...(input.courseId ? { courseId: input.courseId } : {}) })
    .where(eq(exams.id, examId))
    .run();
}

/** The name a file is shown under. The stored file on disk is untouched. */
export function renameSourceFile(db: Db, fileId: string, filename: string) {
  const trimmed = filename.trim();
  if (!trimmed) throw new Error("A file needs a name.");

  db.update(sourceFiles)
    .set({ filename: trimmed })
    .where(eq(sourceFiles.id, fileId))
    .run();
}

/**
 * Copies a deck's sources into a new deck, ready to generate into.
 *
 * Used when a student wants a second generation run kept apart from the first
 * — study-guide focus alongside full coverage, say. The extracted text is
 * duplicated rather than shared so that provenance resolves inside the new
 * deck: a card there cites a slide row that belongs to it, and deleting one
 * deck cannot pull the ground out from under the other.
 *
 * Cards, progress, sessions and coverage are NOT copied. The new deck is the
 * same material with nothing studied yet.
 */
export function duplicateExamSources(
  db: Db,
  examId: string,
  title: string,
): Exam | undefined {
  const source = db.select().from(exams).where(eq(exams.id, examId)).get();
  if (!source) return undefined;

  let created: Exam | undefined;

  db.transaction((tx) => {
    created = tx
      .insert(exams)
      .values({
        courseId: source.courseId,
        title: title.trim() || `${source.title} (copy)`,
        date: source.date,
        scopeMode: source.scopeMode,
      })
      .returning()
      .get();

    const files = tx
      .select()
      .from(sourceFiles)
      .where(eq(sourceFiles.examId, examId))
      .all();

    for (const file of files) {
      const copy = tx
        .insert(sourceFiles)
        .values({
          examId: created.id,
          filename: file.filename,
          fileType: file.fileType,
          role: file.role,
          // The upload on disk is shared; nothing writes to it after ingestion.
          rawPath: file.rawPath,
          checksum: file.checksum,
          status: file.status,
          unitCount: file.unitCount,
          errorMessage: file.errorMessage,
        })
        .returning()
        .get();

      const units = tx
        .select()
        .from(sourceSlides)
        .where(eq(sourceSlides.sourceFileId, file.id))
        .all();

      for (const unit of units) {
        tx.insert(sourceSlides)
          .values({
            sourceFileId: copy.id,
            index: unit.index,
            title: unit.title,
            rawText: unit.rawText,
            speakerNotes: unit.speakerNotes,
            tables: unit.tables,
            imagePath: unit.imagePath,
            hasDiagram: unit.hasDiagram,
            legibilityFlag: unit.legibilityFlag,
          })
          .run();
      }

      for (const objective of tx
        .select()
        .from(studyGuideObjectives)
        .where(eq(studyGuideObjectives.sourceFileId, file.id))
        .all()) {
        tx.insert(studyGuideObjectives)
          .values({
            examId: created.id,
            sourceFileId: copy.id,
            orderIndex: objective.orderIndex,
            label: objective.label,
            promptText: objective.promptText,
            professorEmphasis: objective.professorEmphasis,
            excluded: objective.excluded,
          })
          .run();
      }
    }
  });

  return created;
}

/* ---------------------------------------------------------------- Previews */

export type SourceFileImpact = {
  filename: string;
  units: number;
  /** Generated cards that would go with the file. */
  cardsDeleted: number;
  /** Cards the student edited, which are kept and flagged instead. */
  cardsKept: number;
  /** Study-guide objectives that would go with the file. */
  objectivesDeleted: number;
  /** Objectives the student annotated, which are kept. */
  objectivesKept: number;
};

/** What deleting a source file would take with it, for the confirmation. */
export function previewSourceFileDeletion(
  db: Db,
  fileId: string,
): SourceFileImpact | undefined {
  const file = db
    .select()
    .from(sourceFiles)
    .where(eq(sourceFiles.id, fileId))
    .get();
  if (!file) return undefined;

  const slideIds = db
    .select({ id: sourceSlides.id })
    .from(sourceSlides)
    .where(eq(sourceSlides.sourceFileId, fileId))
    .all()
    .map((row) => row.id);

  const cards =
    slideIds.length === 0
      ? []
      : db
          .select({ isUserEdited: flashcards.isUserEdited })
          .from(flashcards)
          .where(inArray(flashcards.sourceSlideId, slideIds))
          .all();

  const objectives = db
    .select()
    .from(studyGuideObjectives)
    .where(eq(studyGuideObjectives.sourceFileId, fileId))
    .all();

  return {
    filename: file.filename,
    units: slideIds.length,
    cardsDeleted: cards.filter((card) => !card.isUserEdited).length,
    cardsKept: cards.filter((card) => card.isUserEdited).length,
    objectivesDeleted: objectives.filter((o) => !isAnnotated(o)).length,
    objectivesKept: objectives.filter(isAnnotated).length,
  };
}

export type ExamImpact = {
  title: string;
  sourceFiles: number;
  flashcards: number;
  objectives: number;
  sessions: number;
};

/* ---------------------------------------------------------------- Deletion */

/**
 * An objective the student flagged or excluded is a decision they made about
 * the material, not something parsed out of it, so it outlives the file the
 * same way an edited card does.
 */
function isAnnotated(objective: {
  professorEmphasis: boolean;
  excluded: boolean;
}): boolean {
  return objective.professorEmphasis || objective.excluded;
}

export type SourceFileDeletion = {
  /** Relative upload paths the caller should remove from disk. */
  rawPath: string;
  cardsDeleted: number;
  cardsKept: number;
  objectivesDeleted: number;
  objectivesKept: number;
};

/**
 * Deletes a source file, its extracted sections, and the cards that can no
 * longer be verified without it.
 *
 * Objectives parsed from a study guide go with it too; coverage rows follow by
 * cascade. Cards the student edited survive with a null `source_slide_id`,
 * which the deck view surfaces as "source removed" rather than pretending the
 * provenance is still good.
 */
export function deleteSourceFile(
  db: Db,
  fileId: string,
): SourceFileDeletion | undefined {
  const file = db
    .select()
    .from(sourceFiles)
    .where(eq(sourceFiles.id, fileId))
    .get();
  if (!file) return undefined;

  let cardsDeleted = 0;
  let cardsKept = 0;
  let objectivesDeleted = 0;
  let objectivesKept = 0;

  db.transaction((tx) => {
    const slideIds = tx
      .select({ id: sourceSlides.id })
      .from(sourceSlides)
      .where(eq(sourceSlides.sourceFileId, fileId))
      .all()
      .map((row) => row.id);

    if (slideIds.length > 0) {
      const orphans = tx
        .select({ id: flashcards.id, isUserEdited: flashcards.isUserEdited })
        .from(flashcards)
        .where(inArray(flashcards.sourceSlideId, slideIds))
        .all();

      const generated = orphans
        .filter((card) => !card.isUserEdited)
        .map((card) => card.id);

      cardsDeleted = generated.length;
      cardsKept = orphans.length - generated.length;

      if (generated.length > 0) {
        // Rubrics, progress, attempts and coverage rows cascade from here.
        tx.delete(flashcards).where(inArray(flashcards.id, generated)).run();
      }
    }

    // Objectives follow the same rule as cards: parsed ones go with the file,
    // annotated ones survive it. The foreign key is ON DELETE SET NULL, so
    // whatever is left here simply loses its link to the deleted guide.
    const objectives = tx
      .select()
      .from(studyGuideObjectives)
      .where(eq(studyGuideObjectives.sourceFileId, fileId))
      .all();

    const parsed = objectives.filter((o) => !isAnnotated(o)).map((o) => o.id);
    objectivesDeleted = parsed.length;
    objectivesKept = objectives.length - parsed.length;

    if (parsed.length > 0) {
      tx.delete(studyGuideObjectives)
        .where(inArray(studyGuideObjectives.id, parsed))
        .run();
    }

    // Slides cascade from the file; kept cards keep their row and lose only
    // the foreign key.
    tx.delete(sourceFiles).where(eq(sourceFiles.id, fileId)).run();
  });

  return {
    rawPath: file.rawPath,
    cardsDeleted,
    cardsKept,
    objectivesDeleted,
    objectivesKept,
  };
}

/** What deleting a deck would take with it, for the confirmation. */
export function previewExamDeletion(
  db: Db,
  examId: string,
): ExamImpact | undefined {
  const exam = db.select().from(exams).where(eq(exams.id, examId)).get();
  if (!exam) return undefined;

  const count = (rows: unknown[]) => rows.length;

  return {
    title: exam.title,
    sourceFiles: count(
      db
        .select({ id: sourceFiles.id })
        .from(sourceFiles)
        .where(eq(sourceFiles.examId, examId))
        .all(),
    ),
    flashcards: count(
      db
        .select({ id: flashcards.id })
        .from(flashcards)
        .where(eq(flashcards.examId, examId))
        .all(),
    ),
    objectives: count(
      db
        .select({ id: studyGuideObjectives.id })
        .from(studyGuideObjectives)
        .where(eq(studyGuideObjectives.examId, examId))
        .all(),
    ),
    sessions: count(
      db
        .select({ id: studySessions.id })
        .from(studySessions)
        .where(eq(studySessions.examId, examId))
        .all(),
    ),
  };
}

export function deleteExam(db: Db, examId: string): boolean {
  const exam = db.select().from(exams).where(eq(exams.id, examId)).get();
  if (!exam) return false;

  // Everything below an exam is declared ON DELETE CASCADE, so this one
  // statement takes sources, slides, objectives, cards, rubrics, progress,
  // attempts, sessions, coverage and conflicts with it.
  db.delete(exams).where(eq(exams.id, examId)).run();
  return true;
}

export function deleteCourse(db: Db, courseId: string): string[] {
  const examIds = db
    .select({ id: exams.id })
    .from(exams)
    .where(eq(exams.courseId, courseId))
    .all()
    .map((row) => row.id);

  db.delete(courses).where(eq(courses.id, courseId)).run();

  // Returned so the caller can clear each deck's uploads from disk.
  return examIds;
}

/* ------------------------------------------------------------------- Reset */

export type ProgressReset = {
  progressCleared: number;
  attemptsCleared: number;
  sessionsCleared: number;
};

/**
 * Clears review history and SRS state for a deck, keeping the deck.
 *
 * Cards, rubrics, edits, stars, and the coverage matrix are untouched — this
 * puts the student back at the start of the material, not back at the start of
 * building it.
 */
export function resetProgress(db: Db, examId: string): ProgressReset {
  const cardIds = db
    .select({ id: flashcards.id })
    .from(flashcards)
    .where(eq(flashcards.examId, examId))
    .all()
    .map((row) => row.id);

  let progressCleared = 0;
  let attemptsCleared = 0;
  let sessionsCleared = 0;

  db.transaction((tx) => {
    if (cardIds.length > 0) {
      progressCleared = tx
        .delete(studyProgress)
        .where(inArray(studyProgress.flashcardId, cardIds))
        .returning({ id: studyProgress.id })
        .all().length;

      attemptsCleared = tx
        .delete(answerAttempts)
        .where(inArray(answerAttempts.flashcardId, cardIds))
        .returning({ id: answerAttempts.id })
        .all().length;
    }

    sessionsCleared = tx
      .delete(studySessions)
      .where(eq(studySessions.examId, examId))
      .returning({ id: studySessions.id })
      .all().length;
  });

  return { progressCleared, attemptsCleared, sessionsCleared };
}

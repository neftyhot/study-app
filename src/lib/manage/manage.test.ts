/**
 * Management tests.
 *
 * Every assertion here is about what survives a destructive operation, since
 * that is the part a user cannot undo.
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import * as schema from "@/db/schema";
import {
  answerAttempts,
  cardRubrics,
  courses,
  coverageMappings,
  exams,
  flashcards,
  sourceFiles,
  sourceSlides,
  studyGuideObjectives,
  studyProgress,
  studySessions,
} from "@/db/schema";

import { buildExamExport, exportFilename } from "./export";
import {
  createCourse,
  createExam,
  deleteCourse,
  deleteExam,
  deleteSourceFile,
  previewExamDeletion,
  previewSourceFileDeletion,
  renameExam,
  resetProgress,
} from "./index";

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

let db: TestDb;
let courseId: string;
let examId: string;
let deckFileId: string;
let guideFileId: string;
let slideIds: string[];
let generatedCardId: string;
let editedCardId: string;
let otherCardId: string;

beforeEach(() => {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "./drizzle" });

  courseId = db
    .insert(courses)
    .values({ title: "Physiology" })
    .returning()
    .get().id;
  examId = db
    .insert(exams)
    .values({ courseId, title: "Exam 2" })
    .returning()
    .get().id;

  deckFileId = db
    .insert(sourceFiles)
    .values({
      examId,
      filename: "lecture.pptx",
      fileType: "pptx",
      role: "slides",
      rawPath: `${examId}/lecture.pptx`,
      status: "ready",
    })
    .returning()
    .get().id;

  guideFileId = db
    .insert(sourceFiles)
    .values({
      examId,
      filename: "guide.pdf",
      fileType: "pdf",
      role: "study_guide",
      rawPath: `${examId}/guide.pdf`,
      status: "ready",
    })
    .returning()
    .get().id;

  slideIds = db
    .insert(sourceSlides)
    .values([
      { sourceFileId: deckFileId, index: 1, rawText: "Slide one" },
      { sourceFileId: deckFileId, index: 2, rawText: "Slide two" },
    ])
    .returning()
    .all()
    .map((row) => row.id);

  const objectiveId = db
    .insert(studyGuideObjectives)
    .values({
      examId,
      sourceFileId: guideFileId,
      orderIndex: 0,
      promptText: "Describe ADH.",
    })
    .returning()
    .get().id;

  generatedCardId = db
    .insert(flashcards)
    .values({
      examId,
      question: "Generated?",
      directAnswer: "Yes",
      sourceSlideId: slideIds[0],
      sourceExcerpt: "Slide one",
    })
    .returning()
    .get().id;

  editedCardId = db
    .insert(flashcards)
    .values({
      examId,
      question: "Edited by hand?",
      directAnswer: "Yes",
      sourceSlideId: slideIds[1],
      sourceExcerpt: "Slide two",
      isUserEdited: true,
    })
    .returning()
    .get().id;

  otherCardId = db
    .insert(flashcards)
    .values({ examId, question: "Unsourced?", directAnswer: "Yes" })
    .returning()
    .get().id;

  db.insert(cardRubrics)
    .values({ flashcardId: generatedCardId, essentialPoints: ["yes"] })
    .run();
  db.insert(coverageMappings)
    .values({ objectiveId, flashcardId: generatedCardId, status: "covered" })
    .run();
  db.insert(studyProgress)
    .values([
      { flashcardId: generatedCardId, state: "retained", intervalDays: 12 },
      { flashcardId: editedCardId, state: "recognition" },
    ])
    .run();
  db.insert(answerAttempts)
    .values({ flashcardId: editedCardId, answer: "an attempt", verdict: "partial" })
    .run();
  db.insert(studySessions).values({ examId, cardOrder: [generatedCardId] }).run();
});

describe("creating", () => {
  it("creates a course and a deck inside it", () => {
    const course = createCourse(db, { title: "  Biochemistry  ", term: " Fall " });
    expect(course.title).toBe("Biochemistry");
    expect(course.term).toBe("Fall");

    const exam = createExam(db, { courseId: course.id, title: "Midterm 1" });
    expect(exam.courseId).toBe(course.id);
    expect(exam.scopeMode).toBe("files");
  });

  it("refuses a blank title", () => {
    expect(() => createCourse(db, { title: "   " })).toThrow(/needs a title/);
    expect(() => createExam(db, { courseId, title: "" })).toThrow(/needs a title/);
  });

  it("refuses a deck under a course that no longer exists", () => {
    expect(() =>
      createExam(db, { courseId: "missing", title: "Orphan" }),
    ).toThrow(/no longer exists/);
  });

  it("renames a deck without touching anything else", () => {
    renameExam(db, examId, "Renal Exam");
    expect(db.select().from(exams).get()?.title).toBe("Renal Exam");
    expect(db.select().from(flashcards).all()).toHaveLength(3);
  });
});

describe("deleting a source file", () => {
  it("previews exactly what will be lost", () => {
    const impact = previewSourceFileDeletion(db, deckFileId)!;

    expect(impact.filename).toBe("lecture.pptx");
    expect(impact.units).toBe(2);
    expect(impact.cardsDeleted).toBe(1);
    expect(impact.cardsKept).toBe(1);
  });

  it("removes the file, its sections, and the cards generated from it", () => {
    const result = deleteSourceFile(db, deckFileId)!;

    expect(result.cardsDeleted).toBe(1);
    expect(db.select().from(sourceSlides).all()).toHaveLength(0);
    expect(
      db.select().from(flashcards).where(eq(flashcards.id, generatedCardId)).get(),
    ).toBeUndefined();
  });

  it("keeps a card the student edited, flagging it rather than deleting it", () => {
    deleteSourceFile(db, deckFileId);

    const kept = db
      .select()
      .from(flashcards)
      .where(eq(flashcards.id, editedCardId))
      .get();

    // Their work survives; the provenance link does not pretend to be valid.
    expect(kept).toBeDefined();
    expect(kept?.sourceSlideId).toBeNull();
    expect(kept?.sourceExcerpt).toBe("Slide two");
  });

  it("leaves cards from other files alone", () => {
    deleteSourceFile(db, deckFileId);
    expect(
      db.select().from(flashcards).where(eq(flashcards.id, otherCardId)).get(),
    ).toBeDefined();
  });

  it("takes a study guide's parsed objectives with it", () => {
    expect(previewSourceFileDeletion(db, guideFileId)?.objectivesDeleted).toBe(1);

    deleteSourceFile(db, guideFileId);

    expect(db.select().from(studyGuideObjectives).all()).toHaveLength(0);
    // Coverage rows hang off objectives, so they go too.
    expect(db.select().from(coverageMappings).all()).toHaveLength(0);
  });

  it("keeps an objective the student annotated", () => {
    // Flagging an objective is a decision about the material, not something
    // parsed out of the file, so it outlives the file.
    db.update(studyGuideObjectives)
      .set({ professorEmphasis: true })
      .where(eq(studyGuideObjectives.sourceFileId, guideFileId))
      .run();

    const result = deleteSourceFile(db, guideFileId)!;

    expect(result.objectivesKept).toBe(1);
    expect(result.objectivesDeleted).toBe(0);

    const kept = db.select().from(studyGuideObjectives).get();
    expect(kept).toBeDefined();
    expect(kept?.sourceFileId).toBeNull();
  });

  it("returns the stored path so the upload can be removed from disk", () => {
    expect(deleteSourceFile(db, deckFileId)?.rawPath).toBe(
      `${examId}/lecture.pptx`,
    );
  });

  it("reports nothing for a file that is already gone", () => {
    expect(deleteSourceFile(db, "missing")).toBeUndefined();
    expect(previewSourceFileDeletion(db, "missing")).toBeUndefined();
  });
});

describe("deleting a deck", () => {
  it("previews the whole cost", () => {
    const impact = previewExamDeletion(db, examId)!;

    expect(impact.title).toBe("Exam 2");
    expect(impact.sourceFiles).toBe(2);
    expect(impact.flashcards).toBe(3);
    expect(impact.objectives).toBe(1);
    expect(impact.sessions).toBe(1);
  });

  it("cascades to every table that hangs off it", () => {
    expect(deleteExam(db, examId)).toBe(true);

    for (const table of [
      sourceFiles,
      sourceSlides,
      studyGuideObjectives,
      flashcards,
      cardRubrics,
      coverageMappings,
      studyProgress,
      answerAttempts,
      studySessions,
    ]) {
      expect(db.select().from(table).all()).toHaveLength(0);
    }

    // The course itself survives losing one of its decks.
    expect(db.select().from(courses).all()).toHaveLength(1);
  });

  it("reports a deck that was already gone", () => {
    expect(deleteExam(db, "missing")).toBe(false);
  });
});

describe("deleting a course", () => {
  it("takes its decks with it and names them for cleanup", () => {
    const removed = deleteCourse(db, courseId);

    expect(removed).toEqual([examId]);
    expect(db.select().from(exams).all()).toHaveLength(0);
    expect(db.select().from(flashcards).all()).toHaveLength(0);
    expect(db.select().from(courses).all()).toHaveLength(0);
  });

  it("leaves other courses untouched", () => {
    const other = createCourse(db, { title: "Biochemistry" });
    createExam(db, { courseId: other.id, title: "Midterm" });

    deleteCourse(db, courseId);

    expect(db.select().from(courses).all()).toHaveLength(1);
    expect(db.select().from(exams).all()).toHaveLength(1);
  });
});

describe("resetting progress", () => {
  it("clears review history and SRS state", () => {
    const result = resetProgress(db, examId);

    expect(result.progressCleared).toBe(2);
    expect(result.attemptsCleared).toBe(1);
    expect(result.sessionsCleared).toBe(1);

    expect(db.select().from(studyProgress).all()).toHaveLength(0);
    expect(db.select().from(answerAttempts).all()).toHaveLength(0);
    expect(db.select().from(studySessions).all()).toHaveLength(0);
  });

  it("keeps every card, rubric, edit, and coverage row", () => {
    resetProgress(db, examId);

    expect(db.select().from(flashcards).all()).toHaveLength(3);
    expect(db.select().from(cardRubrics).all()).toHaveLength(1);
    expect(db.select().from(coverageMappings).all()).toHaveLength(1);
    expect(db.select().from(sourceSlides).all()).toHaveLength(2);

    // Resetting puts the student back at the start of the material, not back
    // at the start of building it.
    expect(
      db.select().from(flashcards).where(eq(flashcards.id, editedCardId)).get()
        ?.isUserEdited,
    ).toBe(true);
  });

  it("leaves another deck's progress alone", () => {
    const other = createExam(db, { courseId, title: "Exam 3" });
    const card = db
      .insert(flashcards)
      .values({ examId: other.id, question: "Q", directAnswer: "A" })
      .returning()
      .get();
    db.insert(studyProgress)
      .values({ flashcardId: card.id, state: "retained" })
      .run();

    resetProgress(db, examId);

    expect(db.select().from(studyProgress).all()).toHaveLength(1);
  });
});

describe("exporting a deck", () => {
  it("includes everything a student built or wrote", () => {
    const bundle = buildExamExport(db, examId)!;

    expect(bundle.version).toBe(1);
    expect(bundle.course?.title).toBe("Physiology");
    expect(bundle.exam.title).toBe("Exam 2");
    expect(bundle.sourceFiles).toHaveLength(2);
    expect(bundle.flashcards).toHaveLength(3);
    expect(bundle.objectives).toHaveLength(1);
    expect(bundle.coverage).toHaveLength(1);
    expect(bundle.attempts).toHaveLength(1);
  });

  it("writes the extracted text out, not just a reference to it", () => {
    const bundle = buildExamExport(db, examId)!;
    const deck = bundle.sourceFiles.find((f) => f.filename === "lecture.pptx")!;

    expect(deck.units).toHaveLength(2);
    expect(deck.units[0].rawText).toBe("Slide one");
  });

  it("writes provenance in a form that means something outside this app", () => {
    const bundle = buildExamExport(db, examId)!;
    const card = bundle.flashcards.find((c) => c.id === generatedCardId)!;

    // A foreign key is useless in a backup; "slide 1 of lecture.pptx" is not.
    expect(card.source).toEqual({
      filename: "lecture.pptx",
      index: 1,
      excerpt: "Slide one",
    });
    expect(card.rubric?.essentialPoints).toEqual(["yes"]);
  });

  it("carries review history and the student's own answers", () => {
    const bundle = buildExamExport(db, examId)!;

    const studied = bundle.flashcards.find((c) => c.id === generatedCardId)!;
    expect(studied.progress?.state).toBe("retained");
    expect(studied.progress?.intervalDays).toBe(12);
    expect(bundle.attempts[0].answer).toBe("an attempt");
  });

  it("survives a deck with nothing in it", () => {
    const empty = createExam(db, { courseId, title: "Empty" });
    const bundle = buildExamExport(db, empty.id)!;

    expect(bundle.flashcards).toEqual([]);
    expect(bundle.sourceFiles).toEqual([]);
    expect(() => JSON.stringify(bundle)).not.toThrow();
  });

  it("reports nothing for a deck that does not exist", () => {
    expect(buildExamExport(db, "missing")).toBeUndefined();
  });

  it("names the file after the deck and the day", () => {
    expect(exportFilename("Exam 2 — Renal & Endocrine", new Date("2026-03-10"))).toBe(
      "exam-2-renal-endocrine-2026-03-10.json",
    );
  });
});

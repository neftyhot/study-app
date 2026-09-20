/**
 * Covers the guarantee that matters most in ingestion: re-running it must not
 * disturb generated cards or study progress (ARCHITECTURE principle #3).
 */
import { join } from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import * as schema from "@/db/schema";
import {
  courses,
  exams,
  flashcards,
  sourceFiles,
  sourceSlides,
  studyGuideObjectives,
  studyProgress,
} from "@/db/schema";

import { ingestSourceFile } from "./index";

const DECK = join(__dirname, "__fixtures__/sample-deck.pptx");
const GUIDE = join(__dirname, "__fixtures__/study-guide.pdf");

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

let db: TestDb;
let examId: string;

function makeDb(): TestDb {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const client = drizzle(sqlite, { schema });
  migrate(client, { migrationsFolder: "./drizzle" });
  return client;
}

function addDeckFile(role: "slides" | "study_guide" = "slides") {
  return db
    .insert(sourceFiles)
    .values({
      examId,
      filename: "sample-deck.pptx",
      fileType: "pptx",
      role,
      rawPath: DECK,
    })
    .returning()
    .get();
}

beforeEach(() => {
  db = makeDb();
  const course = db
    .insert(courses)
    .values({ title: "Physiology" })
    .returning()
    .get();
  examId = db
    .insert(exams)
    .values({ courseId: course.id, title: "Exam 2" })
    .returning()
    .get().id;
});

describe("ingestSourceFile", () => {
  it("writes one source unit per slide and marks the file ready", async () => {
    const file = addDeckFile();
    const outcome = await ingestSourceFile(db, file, DECK);

    expect(outcome.unitCount).toBe(12);

    const rows = db
      .select()
      .from(sourceSlides)
      .where(eq(sourceSlides.sourceFileId, file.id))
      .all();

    expect(rows).toHaveLength(12);
    expect(rows.map((r) => r.index).sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);

    const updated = db
      .select()
      .from(sourceFiles)
      .where(eq(sourceFiles.id, file.id))
      .get();
    expect(updated?.status).toBe("ready");
    expect(updated?.unitCount).toBe(12);
  });

  it("persists speaker notes and tables", async () => {
    const file = addDeckFile();
    await ingestSourceFile(db, file, DECK);

    const slide5 = db
      .select()
      .from(sourceSlides)
      .where(eq(sourceSlides.sourceFileId, file.id))
      .all()
      .find((r) => r.index === 5);

    expect(slide5?.speakerNotes).toContain("Speaker notes for slide 5.");
    expect(slide5?.tables[0]?.rows[0]).toEqual([
      "Hormone",
      "Origin",
      "Action",
    ]);
  });

  it("preserves source unit IDs, flashcards, and progress on re-ingestion", async () => {
    const file = addDeckFile();
    await ingestSourceFile(db, file, DECK);

    const before = db
      .select()
      .from(sourceSlides)
      .where(eq(sourceSlides.sourceFileId, file.id))
      .all();
    const anchor = before.find((r) => r.index === 3)!;

    // Simulate downstream work: a generated card plus study progress.
    const card = db
      .insert(flashcards)
      .values({
        examId,
        question: "Where is ADH produced?",
        directAnswer: "Hypothalamus",
        sourceSlideId: anchor.id,
        sourceExcerpt: "Body line one for slide 3",
      })
      .returning()
      .get();
    db.insert(studyProgress)
      .values({
        flashcardId: card.id,
        state: "immediate_recall",
        intervalDays: 4,
        nextReviewDue: "2026-10-01",
      })
      .run();

    // Re-ingest the very same file.
    await ingestSourceFile(db, file, DECK);

    const after = db
      .select()
      .from(sourceSlides)
      .where(eq(sourceSlides.sourceFileId, file.id))
      .all();

    // Same rows, same IDs — provenance links stay valid.
    expect(after).toHaveLength(12);
    expect(new Set(after.map((r) => r.id))).toEqual(
      new Set(before.map((r) => r.id)),
    );

    const cardAfter = db
      .select()
      .from(flashcards)
      .where(eq(flashcards.id, card.id))
      .get();
    expect(cardAfter?.sourceSlideId).toBe(anchor.id);
    expect(cardAfter?.question).toBe("Where is ADH produced?");

    const progressAfter = db
      .select()
      .from(studyProgress)
      .where(eq(studyProgress.flashcardId, card.id))
      .get();
    expect(progressAfter?.state).toBe("immediate_recall");
    expect(progressAfter?.intervalDays).toBe(4);
  });

  it("marks the file failed and records the error for an unsupported type", async () => {
    const file = db
      .insert(sourceFiles)
      .values({
        examId,
        filename: "whiteboard.png",
        fileType: "image",
        rawPath: DECK,
      })
      .returning()
      .get();

    await expect(ingestSourceFile(db, file, DECK)).rejects.toThrow(
      /Unsupported file type/,
    );

    const updated = db
      .select()
      .from(sourceFiles)
      .where(eq(sourceFiles.id, file.id))
      .get();
    expect(updated?.status).toBe("failed");
    expect(updated?.errorMessage).toMatch(/Unsupported file type/);
  });

  it("derives numbered objectives from a study guide", async () => {
    const file = db
      .insert(sourceFiles)
      .values({
        examId,
        filename: "study-guide.pdf",
        fileType: "pdf",
        role: "study_guide",
        rawPath: GUIDE,
      })
      .returning()
      .get();

    const outcome = await ingestSourceFile(db, file, GUIDE);
    expect(outcome.objectiveCount).toBe(4);

    const objectives = db
      .select()
      .from(studyGuideObjectives)
      .where(eq(studyGuideObjectives.examId, examId))
      .orderBy(studyGuideObjectives.orderIndex)
      .all();

    expect(objectives.map((o) => o.label)).toEqual(["1", "2", "3", "4"]);
    expect(objectives[0].promptText).toBe(
      "Describe where ADH is produced and released.",
    );
  });

  it("keeps objective IDs stable across re-ingestion so coverage survives", async () => {
    const file = db
      .insert(sourceFiles)
      .values({
        examId,
        filename: "study-guide.pdf",
        fileType: "pdf",
        role: "study_guide",
        rawPath: GUIDE,
      })
      .returning()
      .get();

    await ingestSourceFile(db, file, GUIDE);
    const before = db
      .select()
      .from(studyGuideObjectives)
      .where(eq(studyGuideObjectives.examId, examId))
      .all();

    await ingestSourceFile(db, file, GUIDE);
    const after = db
      .select()
      .from(studyGuideObjectives)
      .where(eq(studyGuideObjectives.examId, examId))
      .all();

    expect(after).toHaveLength(before.length);
    expect(new Set(after.map((o) => o.id))).toEqual(
      new Set(before.map((o) => o.id)),
    );
  });
});

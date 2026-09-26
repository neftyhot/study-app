/**
 * Chronological card order: the triggers that keep the three order columns
 * current (migration 0021), and the queries and sorts that read them.
 */
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { beforeEach, describe, expect, it } from "vitest";

import * as schema from "@/db/schema";
import { courses, exams, flashcards, sourceFiles, sourceSlides } from "@/db/schema";
import { collectDeckCards } from "@/lib/export/cards";
import { loadQueueCards } from "@/lib/study/session";

import {
  chronologicalCardOrder,
  citationLabel,
  compareChronological,
  compareObjectives,
  questionNumber,
  sortObjectives,
} from "./order";

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

let db: TestDb;
let examId: string;

beforeEach(() => {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "./drizzle" });

  const course = db.insert(courses).values({ title: "A&P" }).returning().get();
  examId = db.insert(exams).values({ courseId: course.id, title: "Exam 1" }).returning().get().id;
});

/** A file with `slides` slides; returns slide ids by 1-based number. */
function upload(
  filename: string,
  createdAt: string,
  slides: number,
  role: "slides" | "study_guide" | "notes" = "slides",
) {
  const file = db
    .insert(sourceFiles)
    .values({ examId, filename, fileType: "pptx", role, rawPath: filename, createdAt })
    .returning()
    .get();
  const ids = Array.from(
    { length: slides },
    (_, i) =>
      db.insert(sourceSlides).values({ sourceFileId: file.id, index: i + 1 }).returning().get().id,
  );
  return { fileId: file.id, slide: (n: number) => ids[n - 1] };
}

function card(question: string, sourceSlideId: string | null, topic = "Zzz") {
  return db
    .insert(flashcards)
    .values({ examId, question, directAnswer: "A", topic, sourceSlideId })
    .returning()
    .get().id;
}

function ordered() {
  return db
    .select({ question: flashcards.question })
    .from(flashcards)
    .where(eq(flashcards.examId, examId))
    .orderBy(...chronologicalCardOrder())
    .all()
    .map((row) => row.question);
}

function columns(id: string) {
  return db
    .select({
      doc: flashcards.sourceDocumentIndex,
      page: flashcards.sourcePageNumber,
      seq: flashcards.documentOrderIndex,
    })
    .from(flashcards)
    .where(eq(flashcards.id, id))
    .get();
}

describe("the order columns", () => {
  it("number documents by upload, pages by slide, and cards by extraction", () => {
    const one = upload("one.pptx", "2026-01-01 09:00:00", 20);
    const two = upload("two.pptx", "2026-01-02 09:00:00", 20);

    const a = card("a", two.slide(3));
    const b = card("b", one.slide(14));
    const c = card("c", one.slide(14));

    expect(columns(a)).toEqual({ doc: 2, page: 3, seq: 1 });
    expect(columns(b)).toEqual({ doc: 1, page: 14, seq: 1 });
    expect(columns(c)).toEqual({ doc: 1, page: 14, seq: 2 });
  });

  it("does not count study guides as slideshows", () => {
    upload("guide.pdf", "2026-01-01 08:00:00", 2, "study_guide");
    const deck = upload("deck.pptx", "2026-01-01 09:00:00", 5);

    expect(columns(card("q", deck.slide(2)))?.doc).toBe(1);
  });

  it("breaks an upload-time tie by insertion, so two files never share a number", () => {
    const first = upload("first.pptx", "2026-01-01 09:00:00", 2);
    const second = upload("second.pptx", "2026-01-01 09:00:00", 2);

    expect(columns(card("x", first.slide(1)))?.doc).toBe(1);
    expect(columns(card("y", second.slide(1)))?.doc).toBe(2);
  });

  it("follows a card relinked to another slide", () => {
    const deck = upload("deck.pptx", "2026-01-01 09:00:00", 9);
    const id = card("q", deck.slide(2));

    db.update(flashcards).set({ sourceSlideId: deck.slide(9) }).where(eq(flashcards.id, id)).run();

    expect(columns(id)).toMatchObject({ doc: 1, page: 9 });
  });

  it("renumbers the remaining slideshows when an earlier one is deleted", () => {
    const one = upload("one.pptx", "2026-01-01 09:00:00", 3);
    const two = upload("two.pptx", "2026-01-02 09:00:00", 3);
    const orphan = card("orphan", one.slide(1));
    const kept = card("kept", two.slide(2));

    db.delete(sourceFiles).where(eq(sourceFiles.id, one.fileId)).run();

    expect(columns(kept)).toMatchObject({ doc: 1, page: 2 });
    // Its slide is gone (ON DELETE SET NULL), so it moves to the unsourced tail.
    expect(columns(orphan)).toMatchObject({ doc: null, page: null });
  });
});

describe("chronological order", () => {
  it("is Slideshow 1 → 2, slide by slide, never alphabetical by topic", () => {
    const one = upload("one.pptx", "2026-01-01 09:00:00", 20);
    const two = upload("two.pptx", "2026-01-02 09:00:00", 20);

    card("2·1", two.slide(1), "Action potentials");
    card("1·14 first", one.slide(14), "Zymogens");
    card("unsourced", null, "Aaa");
    card("1·2", one.slide(2), "Myelin");
    card("1·14 second", one.slide(14), "Aaa");

    expect(ordered()).toEqual(["1·2", "1·14 first", "1·14 second", "2·1", "unsourced"]);
  });

  it("is the order the study queue and the exports see", () => {
    const one = upload("one.pptx", "2026-01-01 09:00:00", 5);
    const two = upload("two.pptx", "2026-01-02 09:00:00", 5);
    card("late", two.slide(1), "A");
    card("early", one.slide(5), "B");

    const queue = loadQueueCards(db, examId).map((row) => row.topic);
    expect(queue).toEqual(["B", "A"]);

    const exported = collectDeckCards(db, examId)!.cards.map((row) => row.question);
    expect(exported).toEqual(["early", "late"]);
  });

  it("sorts the same way in memory", () => {
    const rows = [
      { id: "none", sourceDocumentIndex: null, sourcePageNumber: null, documentOrderIndex: 1 },
      { id: "2·1", sourceDocumentIndex: 2, sourcePageNumber: 1, documentOrderIndex: 1 },
      { id: "1·3b", sourceDocumentIndex: 1, sourcePageNumber: 3, documentOrderIndex: 2 },
      { id: "1·3a", sourceDocumentIndex: 1, sourcePageNumber: 3, documentOrderIndex: 1 },
    ];
    expect(rows.sort(compareChronological).map((row) => row.id)).toEqual([
      "1·3a",
      "1·3b",
      "2·1",
      "none",
    ]);
  });
});

describe("study guide items", () => {
  it("reads the number out of a label", () => {
    expect(questionNumber("7")).toBe(7);
    expect(questionNumber("Question 12")).toBe(12);
    expect(questionNumber("Q3b")).toBe(3);
    expect(questionNumber("A")).toBeNull();
    expect(questionNumber(null)).toBeNull();
  });

  it("puts Question 10 after Question 9, not after Question 1", () => {
    const rows = ["Question 10", "Question 9", "Question 1", "Bonus"].map((label, i) => ({
      sourceFileId: "guide",
      label,
      orderIndex: i,
    }));
    expect(sortObjectives(rows).map((row) => row.label)).toEqual([
      "Question 1",
      "Question 9",
      "Question 10",
      "Bonus",
    ]);
  });

  it("keeps each guide together, in upload order", () => {
    expect(
      compareObjectives(
        { fileRank: 0, label: "9", orderIndex: 0 },
        { fileRank: 1, label: "1", orderIndex: 0 },
      ),
    ).toBeLessThan(0);
  });
});

describe("citationLabel", () => {
  it("names a slide the way the rest of the app does", () => {
    expect(citationLabel(1, 14)).toBe("Slideshow 1 · Slide 14");
    expect(citationLabel(2, null)).toBe("Slideshow 2");
    expect(citationLabel(null, null)).toBe("Unsourced");
  });
});

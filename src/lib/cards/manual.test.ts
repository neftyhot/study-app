/**
 * Hand-written cards and bulk operations.
 *
 * The assertions that matter are about what survives: a student's card must
 * survive a regeneration, a moved card must keep the review history it earned,
 * and a copied card must not inherit a history the student never built.
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import * as schema from "@/db/schema";
import {
  cardRubrics,
  courses,
  exams,
  flashcards,
  studyProgress,
} from "@/db/schema";
import { clearGeneratedCards } from "@/lib/generate";

import {
  CardInputError,
  createManualCard,
  createManualCards,
  deleteCards,
  duplicateCards,
  frontOf,
  moveCards,
  retagCards,
  setStarred,
  validateManualCard,
} from "./manual";

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

let db: TestDb;
let examId: string;
let otherExamId: string;

beforeEach(() => {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "./drizzle" });

  const course = db.insert(courses).values({ title: "A&P" }).returning().get();
  examId = db
    .insert(exams)
    .values({ courseId: course.id, title: "Exam 1" })
    .returning()
    .get().id;
  otherExamId = db
    .insert(exams)
    .values({ courseId: course.id, title: "Things I forget" })
    .returning()
    .get().id;
});

describe("validateManualCard", () => {
  it("needs a question and an answer", () => {
    expect(validateManualCard({ examId, question: "", directAnswer: "" })).toEqual([
      "A card needs a question.",
      "A card needs an answer.",
    ]);
  });

  it("lets a cloze card carry its answer inside the sentence", () => {
    expect(
      validateManualCard({
        examId,
        cardType: "cloze",
        question: "ADH comes from the {{posterior pituitary}}.",
      }),
    ).toEqual([]);
  });

  it("rejects a cloze card with nothing deleted", () => {
    expect(
      validateManualCard({
        examId,
        cardType: "cloze",
        question: "ADH comes from the posterior pituitary.",
      }).join(" "),
    ).toMatch(/double braces/);
  });
});

describe("createManualCard", () => {
  it("marks the card as the student's, so regeneration leaves it", () => {
    const card = createManualCard(db, {
      examId,
      topic: "ADH",
      question: "Where is ADH stored?",
      directAnswer: "The posterior pituitary.",
    });

    expect(card.isUserEdited).toBe(true);

    clearGeneratedCards(db, examId);
    expect(db.select().from(flashcards).where(eq(flashcards.id, card.id)).get()).toBeDefined();
  });

  it("falls back to the answer as the rubric, rather than an empty one", () => {
    // An empty rubric would mark every typed answer correct, which is worse
    // than having no typed grading at all.
    const card = createManualCard(db, {
      examId,
      question: "Where is ADH stored?",
      directAnswer: "The posterior pituitary.",
    });

    const rubric = db
      .select()
      .from(cardRubrics)
      .where(eq(cardRubrics.flashcardId, card.id))
      .get();
    expect(rubric?.essentialPoints).toEqual(["The posterior pituitary."]);
  });

  it("derives a cloze card's answer and rubric from its deletions", () => {
    const card = createManualCard(db, {
      examId,
      cardType: "cloze",
      question: "ADH is released from the {{posterior pituitary}} when osmolality {{rises}}.",
    });

    expect(card.directAnswer).toBe("posterior pituitary, rises");

    const rubric = db
      .select()
      .from(cardRubrics)
      .where(eq(cardRubrics.flashcardId, card.id))
      .get();
    expect(rubric?.essentialPoints).toEqual(["posterior pituitary", "rises"]);
  });

  it("hides the deletions on the front of a cloze card", () => {
    const card = createManualCard(db, {
      examId,
      cardType: "cloze",
      question: "ADH comes from the {{posterior pituitary}}.",
    });

    expect(frontOf(card)).not.toContain("posterior pituitary");
  });

  it("refuses an unanswerable card without leaving anything behind", () => {
    expect(() => createManualCard(db, { examId, question: "", directAnswer: "" })).toThrow(
      CardInputError,
    );
    expect(db.select().from(flashcards).all()).toHaveLength(0);
    expect(db.select().from(cardRubrics).all()).toHaveLength(0);
  });

  it("never claims a source excerpt it does not have", () => {
    const card = createManualCard(db, {
      examId,
      question: "Q",
      directAnswer: "A",
    });

    expect(card.sourceExcerpt).toBeNull();
    expect(card.hasAiSupplement).toBe(false);
  });
});

describe("bulk actions", () => {
  function seed(count: number, topic = "ADH") {
    return Array.from({ length: count }, (_, i) =>
      createManualCard(db, {
        examId,
        topic,
        question: `Question ${i}`,
        directAnswer: `Answer ${i}`,
      }),
    );
  }

  it("moves cards and keeps the review history they earned", () => {
    const [card] = seed(1);
    db.insert(studyProgress)
      .values({ flashcardId: card.id, state: "immediate_recall", intervalDays: 7, retentionCount: 2 })
      .run();

    moveCards(db, [card.id], otherExamId);

    const moved = db.select().from(flashcards).where(eq(flashcards.id, card.id)).get();
    expect(moved?.examId).toBe(otherExamId);

    const progress = db
      .select()
      .from(studyProgress)
      .where(eq(studyProgress.flashcardId, card.id))
      .get();
    expect(progress?.retentionCount).toBe(2);
  });

  it("copies cards without copying a history the student never built", () => {
    const [card] = seed(1);
    db.insert(studyProgress)
      .values({ flashcardId: card.id, state: "immediate_recall", intervalDays: 7, retentionCount: 2 })
      .run();

    expect(duplicateCards(db, [card.id], otherExamId)).toEqual({ affected: 1 });

    const copy = db
      .select()
      .from(flashcards)
      .where(eq(flashcards.examId, otherExamId))
      .get()!;
    expect(copy.id).not.toBe(card.id);
    expect(copy.question).toBe(card.question);

    expect(
      db.select().from(studyProgress).where(eq(studyProgress.flashcardId, copy.id)).get(),
    ).toBeUndefined();
  });

  it("copies the rubric with the card, so the copy still grades", () => {
    const [card] = seed(1);
    duplicateCards(db, [card.id], otherExamId);

    const copy = db
      .select()
      .from(flashcards)
      .where(eq(flashcards.examId, otherExamId))
      .get()!;
    const rubric = db
      .select()
      .from(cardRubrics)
      .where(eq(cardRubrics.flashcardId, copy.id))
      .get();

    expect(rubric?.essentialPoints).toEqual(["Answer 0"]);
  });

  it("re-tags a selection", () => {
    const cards = seed(3);
    expect(retagCards(db, cards.map((c) => c.id), "  Adrenal cortex  ")).toEqual({
      affected: 3,
    });

    for (const card of cards) {
      expect(
        db.select().from(flashcards).where(eq(flashcards.id, card.id)).get()?.topic,
      ).toBe("Adrenal cortex");
    }
  });

  it("refuses to re-tag to nothing", () => {
    const cards = seed(2);
    expect(retagCards(db, cards.map((c) => c.id), "   ")).toEqual({ affected: 0 });
    expect(
      db.select().from(flashcards).where(eq(flashcards.id, cards[0].id)).get()?.topic,
    ).toBe("ADH");
  });

  it("deletes a selection and its rubrics", () => {
    const cards = seed(3);
    expect(deleteCards(db, [cards[0].id, cards[1].id])).toEqual({ affected: 2 });

    expect(db.select().from(flashcards).all()).toHaveLength(1);
    expect(db.select().from(cardRubrics).all()).toHaveLength(1);
  });

  it("stars a selection", () => {
    const cards = seed(2);
    setStarred(db, cards.map((c) => c.id), true);

    expect(
      db.select().from(flashcards).all().every((card) => card.starred),
    ).toBe(true);
  });

  it("does nothing, loudly, with an empty selection", () => {
    seed(2);
    expect(deleteCards(db, [])).toEqual({ affected: 0 });
    expect(moveCards(db, [], otherExamId)).toEqual({ affected: 0 });
    expect(duplicateCards(db, [], otherExamId)).toEqual({ affected: 0 });
    expect(db.select().from(flashcards).all()).toHaveLength(2);
  });
});

describe("createManualCards", () => {
  it("writes a whole set and skips the blank row at the end", () => {
    const result = createManualCards(db, examId, [
      { question: "Mitral valve", directAnswer: "Left AV valve" },
      { question: "Tricuspid valve", directAnswer: "Right AV valve" },
      { question: "  ", directAnswer: "" },
    ]);

    expect(result).toEqual({ created: 2 });
    expect(db.select().from(flashcards).where(eq(flashcards.examId, examId)).all()).toHaveLength(2);
  });

  it("writes nothing when any row is incomplete, and says which", () => {
    const result = createManualCards(db, examId, [
      { question: "Mitral valve", directAnswer: "Left AV valve" },
      { question: "Tricuspid valve", directAnswer: "" },
    ]);

    expect("problems" in result && result.problems.map((p) => p.index)).toEqual([1]);
    expect(db.select().from(flashcards).all()).toHaveLength(0);
  });
});

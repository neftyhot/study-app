/**
 * Practice exams (PRD §11).
 *
 * The property that matters most: nothing about correctness escapes before the
 * paper is submitted. An exam that leaks feedback is a study session, and a
 * student who has one cannot find out what they actually know.
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
  practiceExams,
} from "@/db/schema";
import { createKeywordGrader } from "@/lib/learn/typed";

import {
  abandonPaper,
  activePaper,
  assignFormats,
  createPaper,
  diagnostic,
  difference,
  interleave,
  paperQuestions,
  rejectRewrite,
  saveAnswer,
  selectCards,
  submitPaper,
  timeRemaining,
  type PaperCard,
} from "./session";

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

let db: TestDb;
let examId: string;

function paperCard(overrides: Partial<PaperCard> = {}): PaperCard {
  return {
    id: crypto.randomUUID(),
    topic: "ADH",
    question: "Where is ADH released?",
    directAnswer: "The posterior pituitary.",
    essentialPoints: ["posterior pituitary"],
    misconceptions: ["The anterior pituitary."],
    cardType: "atomic",
    state: null,
    excluded: false,
    ...overrides,
  };
}

beforeEach(() => {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "./drizzle" });

  const courseId = db
    .insert(courses)
    .values({ title: "Physiology" })
    .returning()
    .get().id;
  examId = db
    .insert(exams)
    .values({ courseId, title: "Exam 1" })
    .returning()
    .get().id;

  const topics = ["ADH", "Aldosterone", "RAAS", "ANP"];
  const ids = db
    .insert(flashcards)
    .values(
      Array.from({ length: 40 }, (_, i) => ({
        examId,
        topic: topics[i % topics.length],
        question: `Question ${i} about ${topics[i % topics.length]}?`,
        directAnswer: `Answer ${i} mentioning hypothalamus`,
      })),
    )
    .returning()
    .all()
    .map((row) => row.id);

  db.insert(cardRubrics)
    .values(
      ids.map((flashcardId, i) => ({
        flashcardId,
        essentialPoints: i % 2 === 0 ? ["hypothalamus"] : [],
      })),
    )
    .run();
});

describe("choosing what to ask", () => {
  it("favours what is not yet known, without only asking that", () => {
    const cards = [
      ...Array.from({ length: 30 }, () => paperCard({ state: null })),
      ...Array.from({ length: 30 }, () => paperCard({ state: "retained" })),
    ];

    const picked = selectCards(cards, { questionCount: 10, seed: 1 });
    const shaky = picked.filter((card) => card.state === null).length;

    expect(picked).toHaveLength(10);
    expect(shaky).toBeGreaterThan(5);
    // A paper made only of weak material measures morale, not readiness.
    expect(shaky).toBeLessThan(10);
  });

  it("keeps to the chosen topics", () => {
    const cards = [
      ...Array.from({ length: 10 }, () => paperCard({ topic: "ADH" })),
      ...Array.from({ length: 10 }, () => paperCard({ topic: "RAAS" })),
    ];

    const picked = selectCards(cards, { questionCount: 8, topics: ["RAAS"] });
    expect(picked.every((card) => card.topic === "RAAS")).toBe(true);
  });

  it("never asks about excluded cards", () => {
    const cards = Array.from({ length: 10 }, () => paperCard({ excluded: true }));
    expect(selectCards(cards, { questionCount: 5 })).toEqual([]);
  });

  it("asks fewer questions rather than repeating itself", () => {
    const cards = Array.from({ length: 4 }, () => paperCard());
    const picked = selectCards(cards, { questionCount: 20 });

    expect(picked).toHaveLength(4);
    expect(new Set(picked.map((card) => card.id)).size).toBe(4);
  });
});

describe("interleaving", () => {
  it("avoids putting two questions on one topic together", () => {
    const items = [
      ...Array.from({ length: 5 }, () => ({ topic: "ADH" })),
      ...Array.from({ length: 5 }, () => ({ topic: "RAAS" })),
      ...Array.from({ length: 5 }, () => ({ topic: "ANP" })),
    ];

    const ordered = interleave(items, 7);
    let adjacent = 0;
    for (let i = 1; i < ordered.length; i += 1) {
      if (ordered[i].topic === ordered[i - 1].topic) adjacent += 1;
    }

    expect(ordered).toHaveLength(15);
    expect(adjacent).toBe(0);
  });

  it("copes when one topic dominates", () => {
    const items = [
      ...Array.from({ length: 9 }, () => ({ topic: "ADH" })),
      ...Array.from({ length: 2 }, () => ({ topic: "RAAS" })),
    ];

    // Unavoidable repeats, but it should not clump them all at the end.
    expect(interleave(items, 3)).toHaveLength(11);
  });
});

describe("question formats", () => {
  it("gives typed questions to the cards with a real rubric", () => {
    const cards = [
      ...Array.from({ length: 5 }, () => paperCard({ essentialPoints: ["a", "b"] })),
      ...Array.from({ length: 5 }, () => paperCard({ essentialPoints: [] })),
    ];

    const drafts = assignFormats(cards, 0.5, 1);
    const typed = drafts.filter((draft) => draft.format === "typed");

    expect(typed).toHaveLength(5);
    // A card with no rubric can only be marked on recognition.
    expect(typed.every((draft) => draft.card.essentialPoints.length > 0)).toBe(true);
  });
});

describe("rewriting", () => {
  it("measures how much wording actually changed", () => {
    expect(difference("Where is ADH released?", "Where is ADH released?")).toBe(0);
    expect(
      difference("Where is ADH released?", "Name the structure that secretes vasopressin"),
    ).toBeGreaterThan(0.5);
  });

  it("rejects a rewrite that is really the same question", () => {
    expect(rejectRewrite("Where is ADH released?", "Where is ADH released?")).toBe(true);
    expect(rejectRewrite("Where is ADH released?", "")).toBe(true);
  });

  it("accepts a genuine rephrasing", () => {
    expect(
      rejectRewrite(
        "Where is ADH released?",
        "Which structure secretes vasopressin into the blood?",
      ),
    ).toBe(false);
  });

  it("rejects an answer dressed as a question", () => {
    const long = "The posterior pituitary releases it, ".repeat(6);
    expect(rejectRewrite("Where is ADH released?", long)).toBe(true);
  });
});

describe("sitting a paper", () => {
  it("builds a paper of the asked-for size", () => {
    const paper = createPaper(db, examId, { questionCount: 12, seed: 1 })!;

    expect(paper.questionCount).toBe(12);
    expect(paperQuestions(db, paper.id)).toHaveLength(12);
    expect(activePaper(db, examId)?.id).toBe(paper.id);
  });

  it("stores the prompt rather than reading it from the card later", () => {
    const paper = createPaper(db, examId, { questionCount: 3, seed: 2 })!;
    const [question] = paperQuestions(db, paper.id);

    db.update(flashcards)
      .set({ question: "Completely different wording now" })
      .where(eq(flashcards.id, question.flashcardId!))
      .run();

    // Editing a card mid-exam must not change a question being answered.
    expect(paperQuestions(db, paper.id)[0].prompt).toBe(question.prompt);
  });

  it("uses a rewritten prompt when one is supplied", () => {
    const cards = db.select().from(flashcards).all();
    const rephrased = new Map(cards.map((card) => [card.id, `Rewritten: ${card.id.slice(0, 4)}`]));

    const paper = createPaper(db, examId, { questionCount: 4, rephrased, seed: 3 })!;

    expect(paper.rephrased).toBe(true);
    expect(paperQuestions(db, paper.id).every((q) => q.prompt.startsWith("Rewritten:"))).toBe(true);
  });

  it("reveals nothing about correctness while the paper is open", () => {
    const paper = createPaper(db, examId, { questionCount: 6, seed: 4 })!;
    const questions = paperQuestions(db, paper.id);

    saveAnswer(db, questions[0].id, "an answer");

    const after = paperQuestions(db, paper.id);
    // The whole value of an exam is not being told as you go.
    expect(after.every((q) => q.verdict === null)).toBe(true);
    expect(after.every((q) => q.feedback === null)).toBe(true);
  });

  it("counts down a timed paper and never goes negative", () => {
    const paper = createPaper(db, examId, { questionCount: 3, durationMinutes: 30 })!;
    const started = Date.parse(paper.startedAt);

    expect(timeRemaining(paper, started)).toBe(30 * 60_000);
    expect(timeRemaining(paper, started + 29 * 60_000)).toBe(60_000);
    expect(timeRemaining(paper, started + 60 * 60_000)).toBe(0);
  });

  it("has no clock at all when untimed", () => {
    const paper = createPaper(db, examId, { questionCount: 3 })!;
    expect(timeRemaining(paper)).toBeNull();
  });

  it("spreads the correct answers across the options instead of the bottom two", () => {
    const paper = createPaper(db, examId, { questionCount: 12, typedShare: 0 })!;
    const slots = paperQuestions(db, paper.id)
      .filter((q) => q.options.length === 4)
      .map((q) => q.options.indexOf(q.correctOption!));

    const counts = [0, 1, 2, 3].map((slot) => slots.filter((s) => s === slot).length);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });

  it("returns nothing for a deck with no usable cards", () => {
    db.update(flashcards).set({ excluded: true }).run();
    expect(createPaper(db, examId, { questionCount: 5 })).toBeUndefined();
  });
});

describe("marking", () => {
  const grader = createKeywordGrader();

  it("marks multiple choice without a model", async () => {
    const paper = createPaper(db, examId, { questionCount: 8, typedShare: 0, seed: 5 })!;
    const questions = paperQuestions(db, paper.id);

    for (const question of questions.slice(0, 5)) {
      saveAnswer(db, question.id, question.correctOption!);
    }
    for (const question of questions.slice(5)) {
      saveAnswer(db, question.id, "something else entirely");
    }

    const marked = await submitPaper(db, paper.id, grader)!;

    expect(marked?.score).toBe(5);
    expect(marked?.total).toBe(8);
  });

  it("marks a blank answer wrong and says it was blank", async () => {
    const paper = createPaper(db, examId, { questionCount: 4, typedShare: 0, seed: 6 })!;
    await submitPaper(db, paper.id, grader);

    const questions = paperQuestions(db, paper.id);
    expect(questions.every((q) => q.verdict === "incorrect")).toBe(true);
    expect(questions[0].feedback).toContain("blank");
  });

  it("marks typed answers on meaning, through the same grader as practice", async () => {
    const paper = createPaper(db, examId, { questionCount: 6, typedShare: 1, seed: 7 })!;
    const questions = paperQuestions(db, paper.id);

    for (const question of questions) {
      saveAnswer(db, question.id, question.expectedAnswer);
    }

    const marked = await submitPaper(db, paper.id, grader);
    expect(marked?.score).toBeGreaterThan(0);
  });

  it("closes the paper so it cannot be marked twice", async () => {
    const paper = createPaper(db, examId, { questionCount: 3, seed: 8 })!;

    expect(await submitPaper(db, paper.id, grader)).toBeDefined();
    expect(await submitPaper(db, paper.id, grader)).toBeUndefined();
    expect(activePaper(db, examId)).toBeUndefined();
  });

  it("records the score on the paper", async () => {
    const paper = createPaper(db, examId, { questionCount: 5, typedShare: 0, seed: 9 })!;
    for (const question of paperQuestions(db, paper.id)) {
      saveAnswer(db, question.id, question.correctOption!);
    }

    await submitPaper(db, paper.id, grader);

    const stored = db
      .select()
      .from(practiceExams)
      .where(eq(practiceExams.id, paper.id))
      .get()!;

    expect(stored.status).toBe("submitted");
    expect(stored.score).toBe(5);
    expect(stored.submittedAt).not.toBeNull();
  });

  it("lets an abandoned paper be replaced", () => {
    const first = createPaper(db, examId, { questionCount: 3 })!;
    abandonPaper(db, first.id);

    expect(activePaper(db, examId)).toBeUndefined();
    expect(createPaper(db, examId, { questionCount: 3 })).toBeDefined();
  });
});

describe("the diagnostic", () => {
  it("traces every question back to the material it came from", async () => {
    const fileId = db
      .insert(schema.sourceFiles)
      .values({
        examId,
        filename: "lecture.pptx",
        fileType: "pptx",
        role: "slides",
        rawPath: "lecture.pptx",
        status: "ready",
      })
      .returning()
      .get().id;

    const slideId = db
      .insert(schema.sourceSlides)
      .values({ sourceFileId: fileId, index: 7, rawText: "ADH facts" })
      .returning()
      .get().id;

    db.update(flashcards)
      .set({ sourceSlideId: slideId, sourceExcerpt: "ADH facts" })
      .run();

    const paper = createPaper(db, examId, { questionCount: 3, seed: 10 })!;
    await submitPaper(db, paper.id, createKeywordGrader());

    const rows = diagnostic(db, paper.id);

    expect(rows).toHaveLength(3);
    // "You got this wrong" is not useful; "reread slide 7" is.
    expect(rows[0].source?.label).toBe("Slide 7 of lecture.pptx");
    expect(rows[0].verdict).not.toBeNull();
  });

  it("survives a card whose source was deleted", async () => {
    const paper = createPaper(db, examId, { questionCount: 2, seed: 11 })!;
    await submitPaper(db, paper.id, createKeywordGrader());

    db.delete(flashcards).run();

    const rows = diagnostic(db, paper.id);
    expect(rows).toHaveLength(2);
    expect(rows[0].source).toBeNull();
  });
});

/**
 * The sample deck has to work in every mode before a student has a key: it is
 * the first thing a new student studies, and nothing in it may need a model.
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { beforeEach, describe, expect, it } from "vitest";

import * as schema from "@/db/schema";
import { createPaper, paperQuestions, submitPaper } from "@/lib/exam/session";
import { loadLearn, startLearnSession } from "@/lib/learn/session";
import { createKeywordGrader } from "@/lib/learn/typed";
import { getPrimer } from "@/lib/primer";
import { startSession } from "@/lib/study/session";

import { SAMPLE_DECK } from "./memory-deck";
import { ensureSampleDeck, findSampleDeck } from "./open";

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

let db: TestDb;

beforeEach(() => {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "./drizzle" });
});

describe("sample deck", () => {
  it("is added once and reused", () => {
    expect(findSampleDeck(db)).toBeNull();
    const first = ensureSampleDeck(db);
    expect(ensureSampleDeck(db)).toBe(first);
    expect(db.select().from(schema.exams).all()).toHaveLength(1);
  });

  it("gives every card a rubric and wrong answers", () => {
    for (const card of SAMPLE_DECK.cards) {
      expect(card.essentialPoints.length).toBeGreaterThan(0);
      expect(card.misconceptions?.length ?? 0).toBeGreaterThanOrEqual(3);
    }
  });

  it("works in flashcards", () => {
    const examId = ensureSampleDeck(db);
    const session = startSession(db, examId, { scope: "all" });
    expect(session.cardOrder).toHaveLength(SAMPLE_DECK.cards.length);
  });

  it("works in Learn", () => {
    const examId = ensureSampleDeck(db);
    const session = startLearnSession(db, examId, { scope: "all" });
    expect(loadLearn(db, session.id)?.step).not.toBeNull();
  });

  it("sets and marks a practice exam with no model", async () => {
    const examId = ensureSampleDeck(db);
    const paper = createPaper(db, examId, { questionCount: 10, seed: 1 })!;
    const questions = paperQuestions(db, paper.id);
    expect(questions).toHaveLength(10);
    const choice = questions.filter((q) => (q.options?.length ?? 0) > 0);
    expect(choice.length).toBeGreaterThan(0);
    for (const q of choice) expect(q.options!.length).toBeGreaterThanOrEqual(3);
    expect(await submitPaper(db, paper.id, createKeywordGrader())).toBeDefined();
  });

  it("comes with a study guide", () => {
    const examId = ensureSampleDeck(db);
    const guide = getPrimer(db, examId, "balanced");
    expect(guide).not.toBeNull();
  });
});

/**
 * The bundled sample deck, written in the way the catalog and shared files
 * are: it must arrive whole and be usable everywhere with no API key.
 */
import Database from "better-sqlite3";
import { count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { beforeEach, describe, expect, it } from "vitest";

import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import { cardRubrics, exams, flashcards, primerGuides, primerSections } from "@/db/schema";
import { insertDeck } from "@/lib/decks/insert";
import { createPaper } from "@/lib/exam/session";
import { SAMPLE_DECK, SAMPLE_ORIGIN } from "@/lib/sample/memory-deck";
import { ensureSampleDeck, findSampleDeck } from "@/lib/sample/open";

let db: Db;

beforeEach(() => {
  db = drizzle(new Database(":memory:"), { schema }) as unknown as Db;
  migrate(db, { migrationsFolder: "./drizzle" });
});

describe("the sample deck", () => {
  it("is about forty cards, each with a rubric and wrong answers to offer", () => {
    expect(SAMPLE_DECK.cards.length).toBeGreaterThanOrEqual(38);
    expect(SAMPLE_DECK.cards.length).toBeLessThanOrEqual(50);
    for (const card of SAMPLE_DECK.cards) {
      expect(card.question.trim()).not.toBe("");
      expect(card.directAnswer.trim()).not.toBe("");
      expect(card.essentialPoints.length).toBeGreaterThan(0);
      expect(card.misconceptions?.length ?? 0).toBeGreaterThanOrEqual(3);
    }
    const questions = SAMPLE_DECK.cards.map((card) => card.question.toLowerCase());
    expect(new Set(questions).size).toBe(questions.length);
  });

  it("goes in whole: cards, rubrics and a study guide", () => {
    const examId = insertDeck(db, SAMPLE_DECK);
    const cards = db.select({ n: count() }).from(flashcards).where(eq(flashcards.examId, examId)).get()!.n;
    expect(cards).toBe(SAMPLE_DECK.cards.length);
    expect(db.select({ n: count() }).from(cardRubrics).get()!.n).toBe(cards);

    const guide = db.select().from(primerGuides).where(eq(primerGuides.examId, examId)).get();
    expect(guide?.model).toBe(SAMPLE_ORIGIN);
    const sections = db.select({ n: count() }).from(primerSections).where(eq(primerSections.guideId, guide!.id)).get()!.n;
    expect(sections).toBe(SAMPLE_DECK.guide!.topics.reduce((sum, t) => sum + t.sections.length, 0));
  });

  it("makes a practice exam without a model", () => {
    const examId = insertDeck(db, SAMPLE_DECK);
    const paper = createPaper(db, examId, { questionCount: 10, seed: 7 });
    expect(paper).toBeDefined();
  });

  it("refuses an empty deck", () => {
    expect(() => insertDeck(db, { ...SAMPLE_DECK, cards: [] })).toThrow();
  });
});

describe("opening the sample deck", () => {
  it("adds it once and reuses it", () => {
    expect(findSampleDeck(db)).toBeNull();
    const first = ensureSampleDeck(db);
    expect(ensureSampleDeck(db)).toBe(first);
    expect(db.select().from(exams).all()).toHaveLength(1);
  });
});

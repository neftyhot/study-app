/**
 * A shared deck carries the cards and nothing of the sender's own, arrives as
 * a new deck, and a file from anywhere can't get bad data into the database.
 */
import Database from "better-sqlite3";
import { count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { beforeEach, describe, expect, it } from "vitest";

import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import { cardRubrics, exams, flashcards, primerGuides, studyProgress } from "@/db/schema";
import { insertDeck } from "@/lib/decks/insert";
import { SAMPLE_DECK } from "@/lib/sample/memory-deck";
import {
  SHARE_FORMAT,
  SHARE_ORIGIN,
  SHARE_VERSION,
  ShareFileError,
  buildShareFile,
  importShareFile,
  parseShareFile,
  shareFilename,
} from "@/lib/share/meganstudy";

let db: Db;
let examId: string;

beforeEach(() => {
  db = drizzle(new Database(":memory:"), { schema }) as unknown as Db;
  migrate(db, { migrationsFolder: "./drizzle" });
  examId = insertDeck(db, SAMPLE_DECK);
});

const validFile = () => JSON.stringify(buildShareFile(db, examId, { includeGuide: true }));

describe("writing a share file", () => {
  it("carries every card and, when asked, the guide", () => {
    const file = buildShareFile(db, examId, { includeGuide: true })!;
    expect(file.format).toBe(SHARE_FORMAT);
    expect(file.version).toBe(SHARE_VERSION);
    expect(file.deck.title).toBe(SAMPLE_DECK.title);
    expect(file.deck.cards).toHaveLength(SAMPLE_DECK.cards.length);
    expect(file.deck.guide?.topics.length).toBe(SAMPLE_DECK.guide!.topics.length);
  });

  it("leaves the guide out by default", () => {
    expect(buildShareFile(db, examId)!.deck.guide).toBeNull();
  });

  it("has no review history, ids or excluded cards", () => {
    const card = db.select().from(flashcards).where(eq(flashcards.examId, examId)).all();
    db.insert(studyProgress).values({ flashcardId: card[0].id, state: "retained", intervalDays: 30, lapses: 2, nextReviewDue: "2026-12-01" }).run();
    db.update(flashcards).set({ excluded: true }).where(eq(flashcards.id, card[1].id)).run();

    const raw = validFile();
    expect(raw).not.toContain(card[0].id);
    expect(raw).not.toContain(examId);
    expect(raw).not.toMatch(/"(state|intervalDays|nextReviewDue|lastReviewedAt|ease|lapses)"/);
    expect(JSON.parse(raw).deck.cards).toHaveLength(SAMPLE_DECK.cards.length - 1);
  });

  it("is null for a deck that doesn't exist", () => {
    expect(buildShareFile(db, "nope")).toBeNull();
  });

  it("names the file after the deck", () => {
    expect(shareFilename("Midterm 1: Cells!")).toBe("midterm-1-cells.meganstudy");
  });
});

describe("opening a share file", () => {
  it("round-trips into a new deck with fresh progress", () => {
    const card = db.select().from(flashcards).where(eq(flashcards.examId, examId)).get()!;
    db.insert(studyProgress).values({ flashcardId: card.id, state: "retained", intervalDays: 30, lapses: 2, nextReviewDue: "2026-12-01" }).run();

    const { examId: imported, cardCount } = importShareFile(db, validFile());
    expect(imported).not.toBe(examId);
    expect(cardCount).toBe(SAMPLE_DECK.cards.length);
    expect(db.select({ n: count() }).from(exams).get()!.n).toBe(2);

    const cards = db.select().from(flashcards).where(eq(flashcards.examId, imported)).all();
    expect(cards.map((c) => c.question).sort()).toEqual(SAMPLE_DECK.cards.map((c) => c.question).sort());
    const rubric = db.select().from(cardRubrics).where(eq(cardRubrics.flashcardId, cards[0].id)).get();
    expect(rubric?.essentialPoints.length).toBeGreaterThan(0);
    // History stays with the sender: only the original card has a progress row.
    expect(db.select({ n: count() }).from(studyProgress).get()!.n).toBe(1);
    const guide = db.select().from(primerGuides).where(eq(primerGuides.examId, imported)).get();
    expect(guide?.model).toBe(SHARE_ORIGIN);
  });

  it("adds a second copy rather than merging into an existing deck", () => {
    importShareFile(db, validFile());
    importShareFile(db, validFile());
    expect(db.select({ n: count() }).from(exams).get()!.n).toBe(3);
  });

  it("refuses what isn't a deck file", () => {
    for (const raw of ["", "not json", "[]", "{}", JSON.stringify({ format: "other", version: 1 })]) {
      expect(() => parseShareFile(raw)).toThrow(ShareFileError);
    }
  });

  it("refuses a newer version with a reason", () => {
    const file = JSON.parse(validFile());
    file.version = SHARE_VERSION + 1;
    expect(() => parseShareFile(JSON.stringify(file))).toThrow(/newer version/);
  });

  it("refuses malformed cards before touching the database", () => {
    const cases: ((file: { deck: { cards: Record<string, unknown>[]; title: unknown } }) => void)[] = [
      (f) => (f.deck.cards = []),
      (f) => (f.deck.cards[0].question = ""),
      (f) => (f.deck.cards[0].question = 42),
      (f) => (f.deck.cards[0].directAnswer = undefined),
      (f) => (f.deck.cards[0].essentialPoints = "one"),
      (f) => (f.deck.cards[0].question = "x".repeat(50_000)),
      (f) => (f.deck.title = { evil: true }),
    ];
    for (const breakIt of cases) {
      const file = JSON.parse(validFile());
      breakIt(file);
      expect(() => importShareFile(db, JSON.stringify(file))).toThrow(ShareFileError);
    }
    expect(db.select({ n: count() }).from(exams).get()!.n).toBe(1);
  });

  it("ignores fields it doesn't know, and stores unknown card types as plain cards", () => {
    const file = JSON.parse(validFile());
    file.deck.cards[0].cardType = "telepathy";
    file.deck.cards[0].lapses = 99;
    file.deck.history = [{ anything: true }];
    const { examId: imported } = importShareFile(db, JSON.stringify(file));
    const types = db.select({ t: flashcards.cardType }).from(flashcards).where(eq(flashcards.examId, imported)).all();
    expect(types.map((r) => r.t)).toContain("atomic");
    expect(db.select({ n: count() }).from(studyProgress).get()!.n).toBe(0);
  });
});

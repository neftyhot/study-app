/**
 * Card editing and undo.
 *
 * Autosave means the student is not choosing when to save, so these assert
 * that continuous saving cannot quietly destroy a card or flood the history.
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import * as schema from "@/db/schema";
import { cardRevisions, courses, exams, flashcards } from "@/db/schema";

import { COALESCE_WINDOW_MS, editCard, hasRevision, undoCardEdit } from "./edit";

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

let db: TestDb;
let cardId: string;

const START = new Date("2026-03-10T10:00:00.000Z");

function card() {
  return db.select().from(flashcards).where(eq(flashcards.id, cardId)).get();
}

function revisions() {
  return db
    .select()
    .from(cardRevisions)
    .where(eq(cardRevisions.flashcardId, cardId))
    .all();
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
  const examId = db
    .insert(exams)
    .values({ courseId, title: "Exam 2" })
    .returning()
    .get().id;

  cardId = db
    .insert(flashcards)
    .values({
      examId,
      question: "Where is ADH made?",
      directAnswer: "The hypothalamus.",
      fullExplanation: "Supraoptic and paraventricular nuclei.",
    })
    .returning()
    .get().id;
});

describe("editCard", () => {
  it("saves the edit and marks the card as the student's", () => {
    const result = editCard(
      db,
      cardId,
      { question: "Where is ADH synthesized?", directAnswer: "Hypothalamus" },
      START,
    )!;

    expect(result.card.question).toBe("Where is ADH synthesized?");
    expect(card()?.isUserEdited).toBe(true);
    expect(result.undoAvailable).toBe(true);
  });

  it("keeps the previous text so it can be restored exactly", () => {
    editCard(db, cardId, { question: "New?", directAnswer: "New." }, START);

    expect(revisions()).toHaveLength(1);
    expect(revisions()[0].question).toBe("Where is ADH made?");
    expect(revisions()[0].directAnswer).toBe("The hypothalamus.");
    expect(revisions()[0].fullExplanation).toBe(
      "Supraoptic and paraventricular nuclei.",
    );
  });

  it("treats one burst of typing as one undo point", () => {
    // Autosave fires on every pause; forty saves must not mean forty undos.
    for (let i = 1; i <= 8; i += 1) {
      editCard(
        db,
        cardId,
        { question: `Draft ${i}`, directAnswer: "Answer" },
        new Date(START.getTime() + i * 2000),
      );
    }

    expect(revisions()).toHaveLength(1);
    expect(card()?.question).toBe("Draft 8");
  });

  it("starts a new undo point once the student has stopped for a while", () => {
    editCard(db, cardId, { question: "First", directAnswer: "A" }, START);

    const later = new Date(START.getTime() + COALESCE_WINDOW_MS + 1000);
    const result = editCard(
      db,
      cardId,
      { question: "Second", directAnswer: "A" },
      later,
    )!;

    expect(result.revisionCreated).toBe(true);
    expect(revisions()).toHaveLength(2);
  });

  it("does not burn an undo point on a save that changes nothing", () => {
    const result = editCard(
      db,
      cardId,
      {
        question: "Where is ADH made?",
        directAnswer: "The hypothalamus.",
        fullExplanation: "Supraoptic and paraventricular nuclei.",
      },
      START,
    )!;

    expect(result.revisionCreated).toBe(false);
    expect(revisions()).toHaveLength(0);
    expect(card()?.isUserEdited).toBe(false);
  });

  it("refuses to save a card with no question or no answer", () => {
    expect(() =>
      editCard(db, cardId, { question: "  ", directAnswer: "A" }, START),
    ).toThrow(/needs both/);

    expect(card()?.question).toBe("Where is ADH made?");
  });

  it("trims whitespace and empties an explanation that was cleared", () => {
    editCard(
      db,
      cardId,
      { question: "  Q  ", directAnswer: " A ", fullExplanation: "   " },
      START,
    );

    expect(card()?.question).toBe("Q");
    expect(card()?.fullExplanation).toBeNull();
  });
});

describe("undoCardEdit", () => {
  it("restores the exact previous text", () => {
    editCard(
      db,
      cardId,
      { question: "Ruined", directAnswer: "Ruined", fullExplanation: "" },
      START,
    );

    const result = undoCardEdit(db, cardId)!;

    expect(result.card.question).toBe("Where is ADH made?");
    expect(result.card.directAnswer).toBe("The hypothalamus.");
    expect(result.card.fullExplanation).toBe(
      "Supraoptic and paraventricular nuclei.",
    );
  });

  it("puts a never-edited card back to being exactly what was generated", () => {
    editCard(db, cardId, { question: "Mine now", directAnswer: "A" }, START);
    expect(card()?.isUserEdited).toBe(true);

    undoCardEdit(db, cardId);

    // The deletion rules read this flag to decide whose work a card is.
    expect(card()?.isUserEdited).toBe(false);
  });

  it("keeps the edited flag when an earlier edit is still undone-to", () => {
    editCard(db, cardId, { question: "First edit", directAnswer: "A" }, START);
    const later = new Date(START.getTime() + COALESCE_WINDOW_MS + 1000);
    editCard(db, cardId, { question: "Second edit", directAnswer: "A" }, later);

    undoCardEdit(db, cardId);

    expect(card()?.question).toBe("First edit");
    expect(card()?.isUserEdited).toBe(true);
  });

  it("walks back through every undo point in turn", () => {
    const at = (minutes: number) =>
      new Date(START.getTime() + minutes * 60_000);

    editCard(db, cardId, { question: "v2", directAnswer: "A" }, at(0));
    editCard(db, cardId, { question: "v3", directAnswer: "A" }, at(5));
    editCard(db, cardId, { question: "v4", directAnswer: "A" }, at(10));

    expect(undoCardEdit(db, cardId)?.card.question).toBe("v3");
    expect(undoCardEdit(db, cardId)?.card.question).toBe("v2");
    expect(undoCardEdit(db, cardId)?.card.question).toBe("Where is ADH made?");
    expect(undoCardEdit(db, cardId)).toBeUndefined();
  });

  it("reports when there is nothing left to undo", () => {
    expect(hasRevision(db, cardId)).toBe(false);
    expect(undoCardEdit(db, cardId)).toBeUndefined();

    editCard(db, cardId, { question: "x", directAnswer: "y" }, START);
    expect(undoCardEdit(db, cardId)?.undoAvailable).toBe(false);
  });

  it("drops revisions with the card", () => {
    editCard(db, cardId, { question: "x", directAnswer: "y" }, START);
    db.delete(flashcards).where(eq(flashcards.id, cardId)).run();

    expect(db.select().from(cardRevisions).all()).toHaveLength(0);
  });
});

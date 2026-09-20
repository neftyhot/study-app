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
  studyProgress,
  studySessions,
} from "@/db/schema";

import { applyFlashcardGrade } from "./grade";
import { buildQueue, filterCards, shuffle, type QueueCard } from "./queue";
import {
  completeSession,
  gradeCard,
  loadQueueCards,
  openSession,
  setPosition,
  startSession,
} from "./session";

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

let db: TestDb;
let examId: string;
let cardIds: string[];

function queueCard(overrides: Partial<QueueCard> = {}): QueueCard {
  return {
    id: crypto.randomUUID(),
    topic: "ADH",
    starred: false,
    excluded: false,
    lastGrade: null,
    ...overrides,
  };
}

beforeEach(() => {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "./drizzle" });

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

  cardIds = db
    .insert(flashcards)
    .values([
      { examId, topic: "ADH", question: "Q1", directAnswer: "A1" },
      { examId, topic: "ADH", question: "Q2", directAnswer: "A2", starred: true },
      { examId, topic: "Aldosterone", question: "Q3", directAnswer: "A3" },
      { examId, topic: "Aldosterone", question: "Q4", directAnswer: "A4", excluded: true },
    ])
    .returning()
    .all()
    .map((row) => row.id);
});

describe("queue filters", () => {
  it("never includes cards the student excluded from testing", () => {
    const cards = [queueCard(), queueCard({ excluded: true })];
    expect(filterCards(cards, { scope: "all" })).toHaveLength(1);
  });

  it("selects by topic, star, and last grade", () => {
    const cards = [
      queueCard({ topic: "ADH" }),
      queueCard({ topic: "RAAS", starred: true }),
      queueCard({ topic: "RAAS", lastGrade: "missed" }),
      queueCard({ topic: "RAAS", lastGrade: "easy" }),
    ];

    expect(filterCards(cards, { scope: "topic", topic: "RAAS" })).toHaveLength(3);
    expect(filterCards(cards, { scope: "starred" })).toHaveLength(1);
    expect(filterCards(cards, { scope: "missed" })).toHaveLength(1);
  });

  it("keeps the given order when not shuffling", () => {
    const cards = [queueCard(), queueCard(), queueCard()];
    expect(buildQueue(cards, { scope: "all" })).toEqual(cards.map((c) => c.id));
  });

  it("shuffles reproducibly for a given seed and differently across seeds", () => {
    const cards = Array.from({ length: 12 }, () => queueCard());

    const a = buildQueue(cards, { scope: "all", shuffled: true, seed: 7 });
    const b = buildQueue(cards, { scope: "all", shuffled: true, seed: 7 });
    const c = buildQueue(cards, { scope: "all", shuffled: true, seed: 8 });

    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect([...a].sort()).toEqual([...cards.map((x) => x.id)].sort());
  });

  it("keeps every item when shuffling", () => {
    const items = [1, 2, 3, 4, 5];
    expect(shuffle(items, 3).sort()).toEqual(items);
  });
});

describe("applyFlashcardGrade", () => {
  it("promotes an unstudied card only as far as recognition", () => {
    const update = applyFlashcardGrade(undefined, "easy");
    expect(update.state).toBe("recognition");
    expect(update.recognitionCount).toBe(1);
  });

  it("never promotes past the tier already reached", () => {
    const update = applyFlashcardGrade(
      { state: "retained", recognitionCount: 4, lapses: 0 },
      "easy",
    );
    // Recognizing a revealed answer is not evidence of recall, however easy.
    expect(update.state).toBe("retained");
  });

  it("records a miss as a lapse without erasing retention credit", () => {
    const update = applyFlashcardGrade(
      { state: "retained", recognitionCount: 4, lapses: 1 },
      "missed",
    );
    expect(update.state).toBe("retained");
    expect(update.lapses).toBe(2);
    expect(update.recognitionCount).toBe(4);
  });

  it("never returns a scheduling field", () => {
    const update = applyFlashcardGrade(undefined, "easy");
    // PRD §6: post-reveal signals must not drive recall intervals.
    expect(update).not.toHaveProperty("intervalDays");
    expect(update).not.toHaveProperty("nextReviewDue");
  });
});

describe("sessions", () => {
  it("stores the queue so resuming gives the same deck in the same order", () => {
    const session = startSession(db, examId, {
      scope: "all",
      shuffled: true,
      seed: 5,
    });

    expect(session.cardOrder).toHaveLength(3); // the excluded card is out
    expect(session.position).toBe(0);

    setPosition(db, session.id, 2);

    const resumed = openSession(db, examId);
    expect(resumed?.id).toBe(session.id);
    expect(resumed?.position).toBe(2);
    expect(resumed?.cardOrder).toEqual(session.cardOrder);
  });

  it("clamps a position past the end of the queue", () => {
    const session = startSession(db, examId, { scope: "all" });
    const updated = setPosition(db, session.id, 99);
    expect(updated?.position).toBe(session.cardOrder.length);
  });

  it("closes the previous session when a new deck starts", () => {
    const first = startSession(db, examId, { scope: "all" });
    const second = startSession(db, examId, { scope: "starred" });

    expect(openSession(db, examId)?.id).toBe(second.id);

    const closed = db
      .select()
      .from(studySessions)
      .where(eq(studySessions.id, first.id))
      .get();
    expect(closed?.completedAt).not.toBeNull();
  });

  it("stops offering a completed session for resumption", () => {
    const session = startSession(db, examId, { scope: "all" });
    completeSession(db, session.id);
    expect(openSession(db, examId)).toBeUndefined();
  });

  it("records a grade on the card and counts it on the session", () => {
    const session = startSession(db, examId, { scope: "all" });

    gradeCard(db, cardIds[0], "easy", session.id);
    gradeCard(db, cardIds[0], "missed", session.id);

    const progress = db
      .select()
      .from(studyProgress)
      .where(eq(studyProgress.flashcardId, cardIds[0]))
      .all();

    // One progress row per card, not per grade.
    expect(progress).toHaveLength(1);
    expect(progress[0].lastGrade).toBe("missed");
    expect(progress[0].recognitionCount).toBe(1);
    expect(progress[0].lapses).toBe(1);
    expect(progress[0].intervalDays).toBe(0);
    expect(progress[0].nextReviewDue).toBeNull();

    const updated = db
      .select()
      .from(studySessions)
      .where(eq(studySessions.id, session.id))
      .get();
    expect(updated?.easyCount).toBe(1);
    expect(updated?.missedCount).toBe(1);
  });

  it("grades a card with no session attached", () => {
    gradeCard(db, cardIds[1], "difficult");
    const progress = db
      .select()
      .from(studyProgress)
      .where(eq(studyProgress.flashcardId, cardIds[1]))
      .get();
    expect(progress?.lastGrade).toBe("difficult");
  });

  it("builds a missed deck from grades already recorded", () => {
    gradeCard(db, cardIds[0], "missed");
    gradeCard(db, cardIds[2], "easy");

    const session = startSession(db, examId, { scope: "missed" });
    expect(session.cardOrder).toEqual([cardIds[0]]);
  });

  it("reads the last grade per card for filtering", () => {
    gradeCard(db, cardIds[0], "missed");
    const cards = loadQueueCards(db, examId);
    expect(cards).toHaveLength(4);
    expect(cards.find((c) => c.id === cardIds[0])?.lastGrade).toBe("missed");
  });
});

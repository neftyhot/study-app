/**
 * Skip controls (PRD skip controls).
 *
 * The risk with a skip button is that it becomes a way to manufacture
 * progress, so these assert what each one may and may not claim.
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import * as schema from "@/db/schema";
import { courses, exams, flashcards, studyProgress, studySessions } from "@/db/schema";
import {
  loadLearn,
  skipKnown,
  skipUnknown,
  startLearnSession,
} from "@/lib/learn/session";
import { addDays, todayIso } from "@/lib/srs";
import {
  REQUEUE_GAP,
  skipKnownCard,
  skipUnknownCard,
  startSession,
} from "@/lib/study/session";

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

let db: TestDb;
let examId: string;
let cardIds: string[];

function progressFor(cardId: string) {
  return db
    .select()
    .from(studyProgress)
    .where(eq(studyProgress.flashcardId, cardId))
    .get();
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
    .values({ courseId, title: "Exam 2" })
    .returning()
    .get().id;

  cardIds = db
    .insert(flashcards)
    .values(
      Array.from({ length: 12 }, (_, i) => ({
        examId,
        question: `Q${i + 1}`,
        directAnswer: `A${i + 1}`,
      })),
    )
    .returning()
    .all()
    .map((row) => row.id);
});

describe("learn: I know it", () => {
  it("drops the concept from the round and moves on", () => {
    const session = startLearnSession(db, examId, { scope: "all", roundSize: 5 });
    const step = loadLearn(db, session.id)!.step!;

    const result = skipKnown(db, session.id, step.cardId)!;

    expect(result.step?.cardId).not.toBe(step.cardId);
    expect(
      result.state.concepts.find((c) => c.cardId === step.cardId)?.done,
    ).toBe(true);
  });

  it("credits recall and pushes the review out", () => {
    const session = startLearnSession(db, examId, { scope: "all", roundSize: 5 });
    const step = loadLearn(db, session.id)!.step!;

    skipKnown(db, session.id, step.cardId);

    const progress = progressFor(step.cardId)!;
    expect(progress.state).toBe("immediate_recall");
    expect(progress.intervalDays).toBe(1);
    expect(progress.nextReviewDue).toBe(addDays(todayIso(), 1));
  });

  it("cannot claim multi-day retention, however many times it is clicked", () => {
    const session = startLearnSession(db, examId, { scope: "all", roundSize: 5 });
    const step = loadLearn(db, session.id)!.step!;

    skipKnown(db, session.id, step.cardId);
    // Pretend a day passed and the student skipped it again.
    db.update(studyProgress)
      .set({ lastCreditedAt: addDays(todayIso(), -1) })
      .where(eq(studyProgress.flashcardId, step.cardId))
      .run();

    const second = startLearnSession(db, examId, { scope: "all", roundSize: 5 });
    const again = loadLearn(db, second.id)!.step!;
    if (again.cardId === step.cardId) skipKnown(db, second.id, step.cardId);

    // Saying you know something is a claim about today.
    expect(progressFor(step.cardId)?.retentionCount).toBe(0);
    expect(progressFor(step.cardId)?.state).not.toBe("retained");
  });

  it("refuses a skip for a card the round is not asking about", () => {
    const session = startLearnSession(db, examId, { scope: "all", roundSize: 5 });
    expect(skipKnown(db, session.id, cardIds[11])).toBeUndefined();
  });
});

describe("learn: no clue", () => {
  it("counts as a miss and keeps the concept on the same rung", () => {
    const session = startLearnSession(db, examId, { scope: "all", roundSize: 5 });
    const step = loadLearn(db, session.id)!.step!;

    const result = skipUnknown(db, session.id, step.cardId)!;
    const concept = result.state.concepts.find((c) => c.cardId === step.cardId)!;

    expect(concept.done).toBe(false);
    expect(concept.stage).toBe(step.stage);
    expect(concept.errors).toBe(1);
    expect(progressFor(step.cardId)?.lapses).toBe(1);
  });

  it("does not move the review schedule at all", () => {
    const session = startLearnSession(db, examId, { scope: "all", roundSize: 5 });
    const step = loadLearn(db, session.id)!.step!;

    skipUnknown(db, session.id, step.cardId);

    // Giving up is not a review, in either direction.
    const progress = progressFor(step.cardId)!;
    expect(progress.intervalDays).toBe(0);
    expect(progress.nextReviewDue).toBeNull();
  });

  it("brings the concept back later in the round", () => {
    const session = startLearnSession(db, examId, { scope: "all", roundSize: 5 });
    const step = loadLearn(db, session.id)!.step!;

    const result = skipUnknown(db, session.id, step.cardId)!;
    const concept = result.state.concepts.find((c) => c.cardId === step.cardId)!;

    expect(result.step?.cardId).not.toBe(step.cardId);
    expect(concept.dueAt).toBeGreaterThan(result.state.step);
    expect(concept.answerShown).toBe(true);
  });

  it("parks a concept given up on repeatedly instead of looping", () => {
    const session = startLearnSession(db, examId, { scope: "all", roundSize: 5 });
    const target = loadLearn(db, session.id)!.step!.cardId;

    for (let i = 0; i < 6; i += 1) {
      const step = loadLearn(db, session.id)!.step;
      if (!step || step.cardId !== target) break;
      skipUnknown(db, session.id, target);
    }

    let guard = 0;
    while (guard++ < 40) {
      const step = loadLearn(db, session.id)!.step;
      if (!step) break;
      if (step.cardId === target) skipUnknown(db, session.id, target);
      else break;
    }

    const state = loadLearn(db, session.id)!.state!;
    const concept = state.concepts.find((c) => c.cardId === target)!;
    expect(concept.errors).toBeLessThanOrEqual(4);
  });
});

describe("flashcards: skips", () => {
  it("credits a known card and schedules it, without claiming retention", () => {
    skipKnownCard(db, cardIds[0]);

    const progress = progressFor(cardIds[0])!;
    expect(progress.state).toBe("immediate_recall");
    expect(progress.intervalDays).toBe(1);
    expect(progress.retentionCount).toBe(0);
  });

  it("re-queues a card the student had no clue about, inside the session", () => {
    const session = startSession(db, examId, { scope: "all" });
    const first = session.cardOrder[0];

    skipUnknownCard(db, first, session.id);

    const updated = db
      .select()
      .from(studySessions)
      .where(eq(studySessions.id, session.id))
      .get()!;

    expect(updated.cardOrder).toHaveLength(session.cardOrder.length + 1);
    expect(updated.cardOrder[1 + REQUEUE_GAP]).toBe(first);
    expect(updated.missedCount).toBe(1);
  });

  it("records the miss without touching the due date", () => {
    const session = startSession(db, examId, { scope: "all" });
    skipUnknownCard(db, session.cardOrder[0], session.id);

    const progress = progressFor(session.cardOrder[0])!;
    expect(progress.lastGrade).toBe("missed");
    expect(progress.lapses).toBe(1);
    expect(progress.nextReviewDue).toBeNull();
  });

  it("works outside a session too", () => {
    expect(skipUnknownCard(db, cardIds[0])).toBeUndefined();
    expect(progressFor(cardIds[0])?.lastGrade).toBe("missed");
  });
});

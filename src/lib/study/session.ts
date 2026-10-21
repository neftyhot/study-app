/**
 * Study session persistence (PRD §4: exact session resumption).
 *
 * Plain functions over a `Db`, like ingestion and generation, so the server
 * actions stay thin and the behavior is testable without Next's action
 * machinery.
 */
import { and, desc, eq, isNull } from "drizzle-orm";

import type { Db } from "@/db/client";
import {
  exams,
  flashcards,
  studyProgress,
  studySessions,
  type StudySession,
} from "@/db/schema";
import { MINUTES } from "@/lib/plan/estimate";

import { qualityForGrade, scheduleFor } from "@/lib/srs";

import { applyFlashcardGrade, type Grade } from "./grade";
import { buildQueue, type QueueCard, type QueueFilter } from "./queue";
import { chronologicalCardOrder } from "@/lib/order";

export function loadQueueCards(db: Db, examId: string): QueueCard[] {
  return db
    .select({
      id: flashcards.id,
      topic: flashcards.topic,
      starred: flashcards.starred,
      excluded: flashcards.excluded,
      lastGrade: studyProgress.lastGrade,
      nextReviewDue: studyProgress.nextReviewDue,
      cardType: flashcards.cardType,
    })
    .from(flashcards)
    .leftJoin(studyProgress, eq(studyProgress.flashcardId, flashcards.id))
    .where(eq(flashcards.examId, examId))
    .orderBy(...chronologicalCardOrder())
    .all();
}

/**
 * How many reviews one sitting should hold.
 *
 * Only applies to a due queue: a backlog is the normal state of a spaced deck,
 * and a session of four hundred cards is one nobody finishes. The cap comes
 * from the time the student said they have, so it is their number rather than
 * an arbitrary one. Without a stated budget there is no cap, because guessing
 * one would be worse than showing everything.
 */
export function reviewCap(
  db: Db,
  examId: string,
  filter: QueueFilter,
): number | undefined {
  if (filter.scope !== "due") return undefined;

  const exam = db
    .select({ dailyMinutes: exams.dailyMinutes })
    .from(exams)
    .where(eq(exams.id, examId))
    .get();

  if (!exam?.dailyMinutes) return undefined;

  // Reviews get the whole budget here; the plan page is where the day is
  // split between reviews and new material.
  return Math.max(1, Math.floor(exam.dailyMinutes / MINUTES.typedReview));
}

export function openSession(db: Db, examId: string): StudySession | undefined {
  return db
    .select()
    .from(studySessions)
    .where(
      and(
        eq(studySessions.examId, examId),
        eq(studySessions.mode, "flashcards"),
        isNull(studySessions.completedAt),
      ),
    )
    .orderBy(desc(studySessions.updatedAt))
    .get();
}

/**
 * Starts a new run, closing any session still open for this exam.
 *
 * Closing rather than deleting: a finished or abandoned run is a record of
 * what was studied, and PRD §13 wants explicit session completion markers.
 */
export function startSession(
  db: Db,
  examId: string,
  filter: QueueFilter,
): StudySession {
  const order = buildQueue(loadQueueCards(db, examId), {
    ...filter,
    limit: filter.limit ?? reviewCap(db, examId, filter),
  });

  const existing = openSession(db, examId);
  if (existing) completeSession(db, existing.id);

  return db
    .insert(studySessions)
    .values({
      examId,
      mode: "flashcards",
      scope: filter.scope,
      topic: filter.scope === "topic" ? (filter.topic ?? null) : null,
      shuffled: filter.shuffled ?? false,
      cardOrder: order,
      position: 0,
    })
    .returning()
    .get();
}

export function setPosition(
  db: Db,
  sessionId: string,
  position: number,
): StudySession | undefined {
  const session = db
    .select()
    .from(studySessions)
    .where(eq(studySessions.id, sessionId))
    .get();
  if (!session) return undefined;

  // Clamping to the queue length keeps a stale client from parking the
  // session past its end, which would resume on a blank card.
  const clamped = Math.min(
    Math.max(position, 0),
    Math.max(session.cardOrder.length, 0),
  );

  return db
    .update(studySessions)
    .set({ position: clamped, updatedAt: new Date().toISOString() })
    .where(eq(studySessions.id, sessionId))
    .returning()
    .get();
}

export function completeSession(db: Db, sessionId: string) {
  const now = new Date().toISOString();
  db.update(studySessions)
    .set({ completedAt: now, updatedAt: now })
    .where(eq(studySessions.id, sessionId))
    .run();
}

/**
 * "I know it" in flashcard mode: credit it and push the review out.
 *
 * Self-declared, like the Learn equivalent, so it promotes no further than
 * immediate recall and is never retention-eligible.
 */
export function skipKnownCard(
  db: Db,
  cardId: string,
  sessionId?: string | null,
) {
  const current = db
    .select()
    .from(studyProgress)
    .where(eq(studyProgress.flashcardId, cardId))
    .get();

  const state = current?.state === "retained" ? "retained" : "immediate_recall";
  const schedule = scheduleFor(current, state, {
    quality: "pass",
    retentionEligible: false,
  });

  const row = {
    lastGrade: "easy" as const,
    lastReviewedAt: new Date().toISOString(),
    ...schedule,
  };

  if (current) {
    db.update(studyProgress)
      .set(row)
      .where(eq(studyProgress.flashcardId, cardId))
      .run();
  } else {
    db.insert(studyProgress).values({ flashcardId: cardId, ...row }).run();
  }

  if (sessionId) recordSessionGrade(db, sessionId, cardId, "easy");
}

/** How far ahead a skipped card is re-queued within the same session. */
export const REQUEUE_GAP = 5;

/**
 * "No clue" in flashcard mode: reveal it, mark it missed, and see it again
 * before the session ends.
 *
 * The card is re-inserted a few positions ahead rather than appended, so it
 * comes back inside this sitting — and its due date is left alone, because
 * giving up is not a review.
 */
export function skipUnknownCard(
  db: Db,
  cardId: string,
  sessionId?: string | null,
  position?: number,
) {
  const current = db
    .select()
    .from(studyProgress)
    .where(eq(studyProgress.flashcardId, cardId))
    .get();

  const update = applyFlashcardGrade(current, "missed");

  // Missing the same card twice in one session is one lapse, not two: the
  // second "No clue" is the requeue doing its job.
  if (sessionId && current) {
    const before = db
      .select({ cardGrades: studySessions.cardGrades })
      .from(studySessions)
      .where(eq(studySessions.id, sessionId))
      .get();
    if (before?.cardGrades?.[cardId] === "missed") update.lapses = current.lapses;
  }

  if (current) {
    db.update(studyProgress)
      .set(update)
      .where(eq(studyProgress.flashcardId, cardId))
      .run();
  } else {
    db.insert(studyProgress).values({ flashcardId: cardId, ...update }).run();
  }

  if (!sessionId) return undefined;

  recordSessionGrade(db, sessionId, cardId, "missed");

  const session = db
    .select()
    .from(studySessions)
    .where(eq(studySessions.id, sessionId))
    .get();
  if (!session) return undefined;

  const order = [...session.cardOrder];
  // The card can already be in the queue twice, once where it was first met
  // and once where it came back, so place the new copy after the one being
  // looked at rather than after the first.
  const at =
    position !== undefined && order[position] === cardId
      ? position
      : order.indexOf(cardId);
  if (at === -1) return undefined;

  // Pressing "No clue" again on the same card, after going back to it, must
  // not queue it a second time: it is already coming back.
  if (order.indexOf(cardId, at + 1) !== -1) return order;

  order.splice(Math.min(at + 1 + REQUEUE_GAP, order.length), 0, cardId);

  db.update(studySessions)
    .set({ cardOrder: order, updatedAt: new Date().toISOString() })
    .where(eq(studySessions.id, sessionId))
    .run();

  return order;
}

/**
 * Undoes the pile-up an older "No clue" left in saved queues.
 *
 * It re-inserted a card every time the button was pressed, always at the
 * same spot, so a card pressed four times sat there four times in a row. A
 * card is never meant to follow itself, so runs of one card collapse to one,
 * and the saved position moves back by however many copies before it went.
 */
export function collapseRequeues(
  order: string[],
  position: number,
): { order: string[]; position: number } {
  const kept: string[] = [];
  let shift = 0;
  order.forEach((id, index) => {
    // The copy at `position` is the requeue the student is about to meet
    // again after seeing the card just before it; that one stays.
    if (kept.length > 0 && kept[kept.length - 1] === id && index !== position) {
      if (index < position) shift += 1;
      return;
    }
    kept.push(id);
  });
  return { order: kept, position: Math.max(position - shift, 0) };
}

/** Repairs a saved session's queue if it holds a pile-up; see above. */
export function repairSessionQueue(db: Db, session: StudySession): StudySession {
  const repaired = collapseRequeues(session.cardOrder, session.position);
  if (repaired.order.length === session.cardOrder.length) return session;
  db.update(studySessions)
    .set({ cardOrder: repaired.order, position: repaired.position })
    .where(eq(studySessions.id, session.id))
    .run();
  return { ...session, cardOrder: repaired.order, position: repaired.position };
}

const COUNTER: Record<Grade, "missedCount" | "difficultCount" | "easyCount"> = {
  missed: "missedCount",
  difficult: "difficultCount",
  easy: "easyCount",
};

/**
 * Notes a card's grade on the session.
 *
 * A session counts cards, not button presses: a card graded again, after the
 * student goes back to it or meets it a second time, moves from its old
 * counter to the new one instead of being counted twice. Counters are adjusted
 * rather than recomputed so a session started before grades were tracked per
 * card keeps the totals it already had.
 */
export function recordSessionGrade(
  db: Db,
  sessionId: string,
  cardId: string,
  grade: Grade,
) {
  const session = db
    .select()
    .from(studySessions)
    .where(eq(studySessions.id, sessionId))
    .get();
  if (!session) return;

  const grades = { ...(session.cardGrades ?? {}) };
  const previous = grades[cardId];
  grades[cardId] = grade;

  const counters = {
    missedCount: session.missedCount,
    difficultCount: session.difficultCount,
    easyCount: session.easyCount,
  };
  if (previous) {
    counters[COUNTER[previous]] = Math.max(0, counters[COUNTER[previous]] - 1);
  }
  counters[COUNTER[grade]] += 1;

  db.update(studySessions)
    .set({ ...counters, cardGrades: grades, updatedAt: new Date().toISOString() })
    .where(eq(studySessions.id, sessionId))
    .run();
}

/**
 * Records a grade against a card, and against the session if one is running.
 *
 * Progress is keyed by card, not by session: a card graded in any session is
 * the same card, and its history has to survive the session that produced it.
 */
export function gradeCard(
  db: Db,
  cardId: string,
  grade: Grade,
  sessionId?: string | null,
) {
  const current = db
    .select()
    .from(studyProgress)
    .where(eq(studyProgress.flashcardId, cardId))
    .get();

  const update = applyFlashcardGrade(current, grade);

  // A flip-card grade is given after the answer was revealed, so it moves the
  // review schedule but can never establish multi-day retention (PRD §6).
  const schedule = scheduleFor(current, update.state, {
    quality: qualityForGrade(grade),
    retentionEligible: false,
  });

  const row = { ...update, ...schedule };

  if (current) {
    db.update(studyProgress)
      .set(row)
      .where(eq(studyProgress.flashcardId, cardId))
      .run();
  } else {
    db.insert(studyProgress)
      .values({ flashcardId: cardId, ...row })
      .run();
  }

  if (sessionId) recordSessionGrade(db, sessionId, cardId, grade);
}

/**
 * Study session persistence (PRD §4: exact session resumption).
 *
 * Plain functions over a `Db`, like ingestion and generation, so the server
 * actions stay thin and the behaviour is testable without Next's action
 * machinery.
 */
import { and, desc, eq, isNull } from "drizzle-orm";

import type { Db } from "@/db/client";
import {
  flashcards,
  studyProgress,
  studySessions,
  type StudySession,
} from "@/db/schema";

import { qualityForGrade, scheduleFor } from "@/lib/srs";

import { applyFlashcardGrade, type Grade } from "./grade";
import { buildQueue, type QueueCard, type QueueFilter } from "./queue";

export function loadQueueCards(db: Db, examId: string): QueueCard[] {
  return db
    .select({
      id: flashcards.id,
      topic: flashcards.topic,
      starred: flashcards.starred,
      excluded: flashcards.excluded,
      lastGrade: studyProgress.lastGrade,
      nextReviewDue: studyProgress.nextReviewDue,
    })
    .from(flashcards)
    .leftJoin(studyProgress, eq(studyProgress.flashcardId, flashcards.id))
    .where(eq(flashcards.examId, examId))
    .orderBy(flashcards.topic, flashcards.createdAt)
    .all();
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
  const order = buildQueue(loadQueueCards(db, examId), filter);

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

  if (!sessionId) return;

  const session = db
    .select()
    .from(studySessions)
    .where(eq(studySessions.id, sessionId))
    .get();
  if (!session) return;

  const counters = {
    missed: { missedCount: session.missedCount + 1 },
    difficult: { difficultCount: session.difficultCount + 1 },
    easy: { easyCount: session.easyCount + 1 },
  }[grade];

  db.update(studySessions)
    .set({ ...counters, updatedAt: new Date().toISOString() })
    .where(eq(studySessions.id, sessionId))
    .run();
}

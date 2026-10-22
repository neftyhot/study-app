/**
 * A deck's cards and the student's progress on them.
 *
 * Every grade goes through the shared `study/record` functions, the same ones
 * the desktop uses, so a card is scheduled identically on either device.
 */
import type { Step } from "@megan/core/learn/ladder";
import type { SqlDriver } from "@megan/core/platform/types";
import type { Grade } from "@megan/core/study/grade";
import { flipGradeRow, learnOutcomeRow, type LearnAnswer } from "@megan/core/study/record";
import type { LearnMode } from "@megan/core/learn/ladder";
import type { CardType, ProgressState, StudyProgress } from "@megan/core/types";

import { bool, json, newId, nowIso } from "./db";

export type Card = {
  id: string;
  examId: string;
  topic: string | null;
  question: string;
  directAnswer: string;
  fullExplanation: string | null;
  cardType: CardType;
  sourceExcerpt: string | null;
  starred: boolean;
  excluded: boolean;
  fromScan: boolean;
  essentialPoints: string[];
  optionalPoints: string[];
  misconceptions: string[];
  progress: StudyProgress | undefined;
};

type ProgressRow = {
  id: string;
  flashcard_id: string;
  state: string;
  interval_days: number;
  next_review_due: string | null;
  ease: number;
  last_credited_at: string | null;
  last_grade: string | null;
  last_reviewed_at: string | null;
  recognition_count: number;
  immediate_recall_count: number;
  retention_count: number;
  lapses: number;
  mastered_points: string;
  updated_at: string | null;
  deleted_at: string | null;
};

export function toProgress(row: ProgressRow): StudyProgress {
  return {
    id: row.id,
    flashcardId: row.flashcard_id,
    state: row.state as ProgressState,
    intervalDays: row.interval_days,
    nextReviewDue: row.next_review_due,
    ease: row.ease,
    lastCreditedAt: row.last_credited_at,
    lastGrade: row.last_grade as StudyProgress["lastGrade"],
    lastReviewedAt: row.last_reviewed_at,
    recognitionCount: row.recognition_count,
    immediateRecallCount: row.immediate_recall_count,
    retentionCount: row.retention_count,
    lapses: row.lapses,
    masteredPoints: json<string[]>(row.mastered_points, []),
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

const CARD_COLUMNS = `
  f.id, f.exam_id, f.topic, f.question, f.direct_answer, f.full_explanation, f.card_type,
  f.source_excerpt, f.starred, f.excluded, f.from_scan,
  r.essential_points, r.optional_points, r.common_misconceptions,
  p.id AS p_id, p.state AS p_state, p.interval_days AS p_interval_days,
  p.next_review_due AS p_next_review_due, p.ease AS p_ease, p.last_credited_at AS p_last_credited_at,
  p.last_grade AS p_last_grade, p.last_reviewed_at AS p_last_reviewed_at,
  p.recognition_count AS p_recognition_count, p.immediate_recall_count AS p_immediate_recall_count,
  p.retention_count AS p_retention_count, p.lapses AS p_lapses, p.mastered_points AS p_mastered_points,
  p.updated_at AS p_updated_at, p.deleted_at AS p_deleted_at`;

const CARD_FROM = `
  FROM flashcards f
  LEFT JOIN card_rubrics r ON r.flashcard_id = f.id
  LEFT JOIN study_progress p ON p.flashcard_id = f.id`;

/** The desktop's `chronologicalCardOrder`: the order the material taught it in. */
const CARD_ORDER = `
  ORDER BY f.source_document_index ASC NULLS LAST, f.source_page_number ASC NULLS LAST,
    f.document_order_index ASC, f.created_at ASC`;

type CardRow = Record<string, unknown>;

function toCard(row: CardRow): Card {
  const progress =
    row.p_id == null
      ? undefined
      : toProgress({
          id: row.p_id as string,
          flashcard_id: row.id as string,
          state: row.p_state as string,
          interval_days: row.p_interval_days as number,
          next_review_due: row.p_next_review_due as string | null,
          ease: row.p_ease as number,
          last_credited_at: row.p_last_credited_at as string | null,
          last_grade: row.p_last_grade as string | null,
          last_reviewed_at: row.p_last_reviewed_at as string | null,
          recognition_count: row.p_recognition_count as number,
          immediate_recall_count: row.p_immediate_recall_count as number,
          retention_count: row.p_retention_count as number,
          lapses: row.p_lapses as number,
          mastered_points: row.p_mastered_points as string,
          updated_at: row.p_updated_at as string | null,
          deleted_at: row.p_deleted_at as string | null,
        });
  return {
    id: row.id as string,
    examId: row.exam_id as string,
    topic: (row.topic as string | null) ?? null,
    question: row.question as string,
    directAnswer: row.direct_answer as string,
    fullExplanation: (row.full_explanation as string | null) ?? null,
    cardType: row.card_type as CardType,
    sourceExcerpt: (row.source_excerpt as string | null) ?? null,
    starred: bool(row.starred),
    excluded: bool(row.excluded),
    fromScan: bool(row.from_scan),
    essentialPoints: json<string[]>(row.essential_points, []),
    optionalPoints: json<string[]>(row.optional_points, []),
    misconceptions: json<string[]>(row.common_misconceptions, []),
    progress,
  };
}

/** Every live card in a deck, in teaching order. Excluded cards are included and flagged. */
export async function loadCards(db: SqlDriver, examId: string): Promise<Card[]> {
  const rows = await db.all<CardRow>(
    `SELECT ${CARD_COLUMNS} ${CARD_FROM} WHERE f.exam_id = ? AND f.deleted_at IS NULL ${CARD_ORDER}`,
    [examId],
  );
  return rows.map(toCard);
}

export async function loadCard(db: SqlDriver, cardId: string): Promise<Card | null> {
  const [row] = await db.all<CardRow>(`SELECT ${CARD_COLUMNS} ${CARD_FROM} WHERE f.id = ?`, [cardId]);
  return row ? toCard(row) : null;
}

/** Starred cards across every deck. */
export async function loadStarred(db: SqlDriver): Promise<Card[]> {
  const rows = await db.all<CardRow>(
    `SELECT ${CARD_COLUMNS} ${CARD_FROM} WHERE f.starred = 1 AND f.deleted_at IS NULL ${CARD_ORDER}`,
  );
  return rows.map(toCard);
}

/** Every card due by `today`, across all decks, longest overdue first. */
export async function loadDueCards(db: SqlDriver, today: string, limit = 50): Promise<Card[]> {
  const rows = await db.all<CardRow>(
    `SELECT ${CARD_COLUMNS} ${CARD_FROM}
     JOIN exams e ON e.id = f.exam_id AND e.deleted_at IS NULL
     WHERE f.deleted_at IS NULL AND f.excluded = 0
       AND p.next_review_due IS NOT NULL AND p.next_review_due <= ?
     ORDER BY p.next_review_due ASC LIMIT ?`,
    [today, limit],
  );
  return rows.map(toCard);
}

export async function setStarred(db: SqlDriver, cardId: string, starred: boolean): Promise<void> {
  await db.run("UPDATE flashcards SET starred = ?, updated_at = ? WHERE id = ?", [starred ? 1 : 0, nowIso(), cardId]);
}

async function currentProgress(db: SqlDriver, cardId: string): Promise<StudyProgress | undefined> {
  const [row] = await db.all<ProgressRow>("SELECT * FROM study_progress WHERE flashcard_id = ?", [cardId]);
  return row ? toProgress(row) : undefined;
}

type ProgressPatch = Partial<Omit<StudyProgress, "id" | "flashcardId" | "updatedAt" | "deletedAt">>;

async function writeProgress(db: SqlDriver, cardId: string, current: StudyProgress | undefined, patch: ProgressPatch) {
  const next = {
    state: "unstudied",
    intervalDays: 0,
    nextReviewDue: null,
    ease: 2.3,
    lastCreditedAt: null,
    lastGrade: null,
    lastReviewedAt: null,
    recognitionCount: 0,
    immediateRecallCount: 0,
    retentionCount: 0,
    lapses: 0,
    masteredPoints: [],
    ...current,
    ...patch,
  };
  await db.run(
    `INSERT INTO study_progress (id, flashcard_id, state, interval_days, next_review_due, ease, last_credited_at,
       last_grade, last_reviewed_at, recognition_count, immediate_recall_count, retention_count, lapses,
       mastered_points, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(flashcard_id) DO UPDATE SET
       state = excluded.state, interval_days = excluded.interval_days, next_review_due = excluded.next_review_due,
       ease = excluded.ease, last_credited_at = excluded.last_credited_at, last_grade = excluded.last_grade,
       last_reviewed_at = excluded.last_reviewed_at, recognition_count = excluded.recognition_count,
       immediate_recall_count = excluded.immediate_recall_count, retention_count = excluded.retention_count,
       lapses = excluded.lapses, mastered_points = excluded.mastered_points, updated_at = excluded.updated_at`,
    [
      current?.id ?? newId(),
      cardId,
      next.state,
      next.intervalDays,
      next.nextReviewDue,
      next.ease,
      next.lastCreditedAt,
      next.lastGrade,
      next.lastReviewedAt,
      next.recognitionCount,
      next.immediateRecallCount,
      next.retentionCount,
      next.lapses,
      JSON.stringify(next.masteredPoints),
      nowIso(),
    ],
  );
}

/** What a grade replaced, so a swipe can be undone exactly. */
export type Undo = { cardId: string; previous: StudyProgress | undefined };

/** A flip-card grade (Swipe or the grade buttons). */
export async function recordFlip(db: SqlDriver, cardId: string, grade: Grade): Promise<Undo> {
  const previous = await currentProgress(db, cardId);
  await writeProgress(db, cardId, previous, flipGradeRow(previous, grade));
  return { cardId, previous };
}

/** One Learn answer. */
export async function recordLearn(
  db: SqlDriver,
  cardId: string,
  step: Pick<Step, "stage" | "countsTowardMastery">,
  answer: LearnAnswer,
  mode: LearnMode,
): Promise<Undo> {
  const previous = await currentProgress(db, cardId);
  await writeProgress(db, cardId, previous, learnOutcomeRow(previous, step, answer, mode));
  return { cardId, previous };
}

/** Puts a card's progress back as it was before a grade. */
export async function undoGrade(db: SqlDriver, undo: Undo): Promise<void> {
  if (!undo.previous) {
    await db.run("DELETE FROM study_progress WHERE flashcard_id = ?", [undo.cardId]);
    return;
  }
  const current = await currentProgress(db, undo.cardId);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- picked out so only the progress fields are written back
  const { id: _id, flashcardId: _card, updatedAt: _u, deletedAt: _d, ...rest } = undo.previous;
  await writeProgress(db, undo.cardId, current, rest);
}
